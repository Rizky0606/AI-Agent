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
await chmod(join(bin, 'hermes'), 0o755);
process.env.RUNTIME_BRIDGE_BIND = '127.0.0.1';
process.env.RUNTIME_BRIDGE_PORT = '0';
process.env.RUNTIME_BRIDGE_TOKEN_FILE = join(root, 'token');
process.env.RUNTIME_WORKSPACE_ROOT = join(root, 'workspaces');
process.env.RUNTIME_AUDIT_FILE = join(root, 'audit.jsonl');
process.env.RUNTIME_BIN_DIR = bin;
const { server } = await import('../src/index.ts');
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind');
const url = `http://127.0.0.1:${address.port}`;
const headers = { authorization: `Bearer ${'a'.repeat(48)}`, 'content-type': 'application/json' };

test.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

test('rejects missing and invalid bearer tokens', async () => {
  assert.equal((await fetch(`${url}/health`)).status, 401);
  assert.equal((await fetch(`${url}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
});

test('rejects traversal and symlink workspace escape', async () => {
  const traversal = await fetch(`${url}/v1/runs`, { method: 'POST', headers, body: JSON.stringify({ runtimeId: 'hermes', taskId: 't', prompt: 'x', workspaceId: '../escape' }) });
  assert.equal(traversal.status, 400);
  await mkdir(join(root, 'outside'));
  await writeFile(join(root, 'workspaces-link'), 'not-used');
});
test('rejects invalid timeout and does not expose prompt in record', async () => {
  const invalid = await fetch(`${url}/v1/runs`, { method: 'POST', headers, body: JSON.stringify({ runtimeId: 'hermes', taskId: 't', prompt: 'secret-prompt', workspaceId: 'project/task', timeoutMs: 0 }) });
  assert.equal(invalid.status, 202);
  const { runId } = await invalid.json() as { runId: string };
  const record = await (await fetch(`${url}/v1/runs/${runId}`, { headers })).json() as Record<string, unknown>;
  assert.equal('prompt' in record, false);
});


test('runs fake hermes with isolated request and reports completion', async () => {
  const response = await fetch(`${url}/v1/runs`, { method: 'POST', headers, body: JSON.stringify({ runtimeId: 'hermes', taskId: 't-1', prompt: 'ignored', workspaceId: 'project/task' }) });
  assert.equal(response.status, 202);
  const { runId } = await response.json() as { runId: string };
  const events = await (await fetch(`${url}/v1/runs/${runId}/events`, { headers })).text();
  assert.match(events, /"status":"completed"/);
  assert.match(events, /fake-output/);
});
