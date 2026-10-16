import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'runtime-bridge-test-'));
const bin = join(root, 'bin');
await mkdir(bin);
await writeFile(join(root, 'token'), 'a'.repeat(48), { mode: 0o600 });
await writeFile(join(bin, 'hermes'), '#!/bin/sh\nprintf fake-output\n');
if (process.platform === 'win32') {
  await writeFile(join(bin, 'hermes.cmd'), '@<nul set /p =fake-output & exit /b 0\r\n');
}
await chmod(join(bin, 'hermes'), 0o755);

// Create fake omp CLI
const ompJs = join(bin, 'omp.js');
await writeFile(
  ompJs,
  `
const args = process.argv.slice(2);
if (args.includes('--sleep')) {
  setTimeout(() => process.exit(0), 10000);
} else {
  // Check secret environment isolation
  if (process.env.DATABASE_URL || process.env.NINEROUTER_API_KEY || process.env.JWT_SECRET) {
    console.log(JSON.stringify({ type: 'error', error: 'SECRET_LEAKED' }));
  }
  const sessionIdx = args.indexOf('--session');
  const sessionId = sessionIdx !== -1 ? args[sessionIdx + 1] : undefined;
  if (sessionId) {
    console.log(JSON.stringify({ type: 'session', sessionId }));
  }
  console.log(JSON.stringify({ type: 'message_update', content: [{ type: 'text', text: 'Analisis rencana selesai' }] }));
  console.log(JSON.stringify({ type: 'tool_start', tool: 'inspect_file', input: { path: 'src/main.ts' } }));
  console.log(JSON.stringify({ type: 'tool_end', tool: 'inspect_file', output: 'content: ok' }));
  console.log(JSON.stringify({ type: 'file_edit', path: 'src/main.ts', diff: '@@ -1,1 +1,1 @@\\n-old\\n+new' }));
  console.log(JSON.stringify({ type: 'turn_end' }));
}
`,
);
await writeFile(join(bin, 'omp'), `#!/usr/bin/env node\nrequire('${ompJs.replace(/\\/g, '/')}');\n`);
await chmod(join(bin, 'omp'), 0o755);
if (process.platform === 'win32') {
  await writeFile(join(bin, 'omp.cmd'), `@node "${ompJs}" %*\r\n`);
}

process.env.RUNTIME_BRIDGE_BIND = '127.0.0.1';
process.env.RUNTIME_BRIDGE_PORT = '0';
process.env.RUNTIME_BRIDGE_TOKEN_FILE = join(root, 'token');
process.env.RUNTIME_WORKSPACE_ROOT = join(root, 'workspaces');
process.env.RUNTIME_AUDIT_FILE = join(root, 'audit.jsonl');
process.env.RUNTIME_BIN_DIR = bin;
process.env.RUNTIME_MAX_CONCURRENCY = '2';

// Set dummy project secrets in current process to test that child env isolates them
process.env.DATABASE_URL = 'postgres://user:super-secret-password@localhost:5432/db';
process.env.NINEROUTER_API_KEY = 'sk-secret-key-that-must-not-leak';
process.env.JWT_SECRET = 'jwt-secret-token';

const { server, parseOmpLine } = await import('../src/index.ts');
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind');
const url = `http://127.0.0.1:${address.port}`;
const headers = { authorization: `Bearer ${'a'.repeat(48)}`, 'content-type': 'application/json' };

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('parseOmpLine: normalizes raw omp JSONL events into internal types', () => {
  const textEvt = parseOmpLine(JSON.stringify({ type: 'message_update', content: [{ type: 'text', text: 'Halo asisten' }] }));
  assert.equal(textEvt?.type, 'text');
  assert.equal(textEvt?.data.text, 'Halo asisten');

  const toolStart = parseOmpLine(JSON.stringify({ type: 'tool_start', tool: 'run_tests', input: { timeout: 5000 } }));
  assert.equal(toolStart?.type, 'tool_start');
  assert.equal(toolStart?.data.toolName, 'run_tests');
  assert.deepEqual(toolStart?.data.input, { timeout: 5000 });

  const toolEnd = parseOmpLine(JSON.stringify({ type: 'tool_end', tool: 'run_tests', output: 'PASS' }));
  assert.equal(toolEnd?.type, 'tool_end');
  assert.equal(toolEnd?.data.toolName, 'run_tests');
  assert.equal(toolEnd?.data.output, 'PASS');

  const fileEdit = parseOmpLine(JSON.stringify({ type: 'file_edit', path: 'src/app.ts', diff: '+ const x = 1;' }));
  assert.equal(fileEdit?.type, 'file_edit');
  assert.equal(fileEdit?.data.path, 'src/app.ts');
  assert.equal(fileEdit?.data.diff, '+ const x = 1;');

  const errorEvt = parseOmpLine(JSON.stringify({ type: 'error', error: 'SyntaxError' }));
  assert.equal(errorEvt?.type, 'error');
  assert.equal(errorEvt?.data.error, 'SyntaxError');
});

test('rejects missing and invalid bearer tokens', async () => {
  assert.equal((await fetch(`${url}/health`)).status, 401);
  assert.equal((await fetch(`${url}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
});

test('rejects traversal and symlink workspace escape', async () => {
  const traversal = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ runtimeId: 'hermes', taskId: 't', prompt: 'x', workspaceId: '../escape' }),
  });
  assert.equal(traversal.status, 400);
  await mkdir(join(root, 'outside'));
  await writeFile(join(root, 'workspaces-link'), 'not-used');
});

test('rejects invalid timeout and does not expose prompt in record', async () => {
  const invalid = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ runtimeId: 'hermes', taskId: 't', prompt: 'secret-prompt', workspaceId: 'project/task', timeoutMs: 0 }),
  });
  assert.equal(invalid.status, 202);
  const { runId } = (await invalid.json()) as { runId: string };
  const record = (await (await fetch(`${url}/v1/runs/${runId}`, { headers })).json()) as Record<string, unknown>;
  assert.equal('prompt' in record, false);
});

test('runs fake hermes with isolated request and reports completion', async () => {
  const response = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ runtimeId: 'hermes', taskId: 't-1', prompt: 'ignored', workspaceId: 'project/task-hermes' }),
  });
  assert.equal(response.status, 202);
  const { runId } = (await response.json()) as { runId: string };
  const events = await (await fetch(`${url}/v1/runs/${runId}/events`, { headers })).text();
  assert.match(events, /"status":"completed"/);
  assert.match(events, /fake-output/);
});

test('runs fake omp with persistent session and streams normalized events', async () => {
  const response = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      runtimeId: 'omp',
      taskId: 't-omp-1',
      prompt: 'perbaiki bug',
      workspaceId: 'project/task-omp',
      sessionId: 'sess-persisten-123',
    }),
  });
  assert.equal(response.status, 202);
  const { runId } = (await response.json()) as { runId: string };

  // Wait for run to finish
  let record: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    record = (await (await fetch(`${url}/v1/runs/${runId}`, { headers })).json()) as Record<string, unknown>;
    if (record.status === 'completed' || record.status === 'failed') break;
  }

  assert.equal(record.status, 'completed');
  const events = record.events as Array<{ type: string; data: Record<string, unknown> }>;
  assert.ok(Array.isArray(events));
  assert.ok(events.length >= 4);

  // Verify normalized events
  const textEvt = events.find((e) => e.type === 'text');
  assert.ok(textEvt, 'should contain text event');
  assert.equal(textEvt.data.text, 'Analisis rencana selesai');

  const toolStartEvt = events.find((e) => e.type === 'tool_start');
  assert.ok(toolStartEvt, 'should contain tool_start event');
  assert.equal(toolStartEvt.data.toolName, 'inspect_file');

  const toolEndEvt = events.find((e) => e.type === 'tool_end');
  assert.ok(toolEndEvt, 'should contain tool_end event');
  assert.equal(toolEndEvt.data.toolName, 'inspect_file');

  const fileEditEvt = events.find((e) => e.type === 'file_edit');
  assert.ok(fileEditEvt, 'should contain file_edit event');
  assert.equal(fileEditEvt.data.path, 'src/main.ts');
  assert.ok(String(fileEditEvt.data.diff).includes('+new'));

  // Verify persistent session request property preserved
  const req = record.request as Record<string, unknown>;
  assert.equal(req.sessionId, 'sess-persisten-123');

  // Verify SSE endpoint returns runtime_events
  const sseBody = await (await fetch(`${url}/v1/runs/${runId}/events`, { headers })).text();
  assert.match(sseBody, /event: runtime_event/);
  assert.match(sseBody, /src\/main\.ts/);
});

test('environment isolation: child process never receives project secrets', async () => {
  const response = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      runtimeId: 'omp',
      taskId: 't-omp-env',
      prompt: 'periksa env',
      workspaceId: 'project/task-omp-env',
      environment: {
        DATABASE_URL: 'attempted-leak',
        NINEROUTER_API_KEY: 'attempted-leak-2',
        SAFE_PROJECT_NAME: 'PersonalAI',
      },
    }),
  });
  assert.equal(response.status, 202);
  const { runId } = (await response.json()) as { runId: string };

  let record: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    record = (await (await fetch(`${url}/v1/runs/${runId}`, { headers })).json()) as Record<string, unknown>;
    if (record.status === 'completed' || record.status === 'failed') break;
  }

  assert.equal(record.status, 'completed');
  // If secrets leaked, fake omp would have emitted { type: 'error', error: 'SECRET_LEAKED' }
  const events = (record.events ?? []) as Array<{ type: string; data: Record<string, unknown> }>;
  const secretLeakedEvt = events.find((e) => e.data?.error === 'SECRET_LEAKED');
  assert.equal(secretLeakedEvt, undefined, 'Project secrets must not be leaked into child process environment');
});

test('cancellation: kills process group and transitions status to cancelled', async () => {
  const response = await fetch(`${url}/v1/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      runtimeId: 'omp',
      taskId: 't-omp-cancel',
      prompt: '--sleep',
      workspaceId: 'project/task-omp-cancel',
      timeoutMs: 60000,
    }),
  });
  assert.equal(response.status, 202);
  const { runId } = (await response.json()) as { runId: string };

  // Wait for the run to be active or running
  for (let i = 0; i < 30; i++) {
    const check = (await (await fetch(`${url}/v1/runs/${runId}`, { headers })).json()) as Record<string, unknown>;
    if (check.status === 'running') break;
    await new Promise((r) => setTimeout(r, 50));
  }

  // Cancel the run
  const cancelRes = await fetch(`${url}/v1/runs/${runId}/cancel`, { method: 'POST', headers });
  assert.equal(cancelRes.status, 202);

  // Poll for cancelled status
  let record: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    record = (await (await fetch(`${url}/v1/runs/${runId}`, { headers })).json()) as Record<string, unknown>;
    if (record.status === 'cancelled') break;
  }
  assert.equal(record.status, 'cancelled');
});

test('GET /v1/runtimes/hermes/skills returns read-only Hermes skills list', async () => {
  const response = await fetch(`${url}/v1/runtimes/hermes/skills`, { headers });
  assert.equal(response.status, 200);
  const data = (await response.json()) as { skills: Array<{ name: string; isReadOnly: boolean }> };
  assert.ok(Array.isArray(data.skills));
  assert.ok(data.skills.length >= 4);
  const names = data.skills.map((s) => s.name);
  assert.ok(names.includes('telegram_messenger'));
  assert.ok(names.includes('web_search'));
  assert.ok(names.includes('browser_automation'));
  assert.ok(names.includes('memory_recall'));
  assert.ok(data.skills.every((s) => s.isReadOnly === true));
});

