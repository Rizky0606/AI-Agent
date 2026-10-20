import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { OmpJsonlParser, OmpRpcSession } from '../src/omp-rpc-adapter.ts';

test('protocol fixture: parses actual OMP RPC v18.8.4 handshake and get_state response', async () => {
  const candidatePaths = [
    join(process.cwd(), 'docs/fixtures/runtime-probes/omp-rpc-handshake-and-get-state.redacted.jsonl'),
    join(process.cwd(), '../../docs/fixtures/runtime-probes/omp-rpc-handshake-and-get-state.redacted.jsonl'),
  ];
  const fixturePath = candidatePaths.find((p) => existsSync(p)) ?? candidatePaths[0]!;
  const fixtureContent = await readFile(fixturePath, 'utf8');

  const parser = new OmpJsonlParser();
  const records = parser.feed(fixtureContent);

  assert.ok(records.length >= 4);

  // Line 1: Handshake
  const handshakeLine = records.find((r) => r.parsed?.type === 'ready');
  assert.ok(handshakeLine);
  assert.equal(handshakeLine.parsed?.protocolVersion, 1);
  assert.equal(handshakeLine.parsed?.maxFrameBytes, 1_048_576);

  // Line 2: Extension UI request (safe ignore)
  const extLine = records.find((r) => r.parsed?.type === 'extension_ui_request');
  assert.ok(extLine);
  assert.equal(extLine.parsed?.method, 'setWidget');

  // Line 3: Available commands update
  const cmdLine = records.find((r) => r.parsed?.type === 'available_commands_update');
  assert.ok(cmdLine);
  assert.ok(Array.isArray(cmdLine.parsed?.commands));

  // Line 4: Correlated response to probe-1 get_state
  const responseLine = records.find((r) => r.parsed?.id === 'probe-1');
  assert.ok(responseLine);
  assert.equal(responseLine.parsed?.type, 'response');
  assert.equal(responseLine.parsed?.command, 'get_state');
  assert.equal(responseLine.parsed?.success, true);
  assert.ok(typeof responseLine.parsed?.data === 'object');
});

test('parser: incremental chunk handling, split lines, and unknown events', () => {
  const parser = new OmpJsonlParser();

  // 1. Split chunk across boundary
  const chunk1 = '{"type":"message_update","content":[{"type":"text","te';
  const chunk2 = 'xt":"Halo dunia"}]}\n';

  const r1 = parser.feed(chunk1);
  assert.equal(r1.length, 0, 'Incomplete chunk should produce no parsed lines');

  const r2 = parser.feed(chunk2);
  assert.equal(r2.length, 1);
  assert.equal(r2[0]?.parsed?.type, 'message_update');

  // 2. Multiple events in a single chunk
  const multiChunk = '{"type":"tool_start","tool":"read"}\n{"type":"tool_end","tool":"read"}\n';
  const rMulti = parser.feed(multiChunk);
  assert.equal(rMulti.length, 2);
  assert.equal(rMulti[0]?.parsed?.type, 'tool_start');
  assert.equal(rMulti[1]?.parsed?.type, 'tool_end');

  // 3. Malformed JSON followed by valid JSON
  const mixedChunk = 'not-json-line\n{invalid json}\n{"type":"turn_end"}\n';
  const rMixed = parser.feed(mixedChunk);
  assert.equal(rMixed.length, 3);
  assert.equal(rMixed[0]?.parsed, undefined);
  assert.equal(rMixed[1]?.parsed, undefined);
  assert.equal(rMixed[2]?.parsed?.type, 'turn_end');

  // 4. Unknown event with extra fields is safely preserved without crashing
  const unknownChunk = '{"type":"unknown_vendor_event","customPayload":{"x":1},"unsupported":true}\n';
  const rUnknown = parser.feed(unknownChunk);
  assert.equal(rUnknown.length, 1);
  assert.equal(rUnknown[0]?.parsed?.type, 'unknown_vendor_event');
  assert.equal((rUnknown[0]?.parsed?.customPayload as Record<string, unknown>)?.x, 1);
});

test('session: full bi-directional lifecycle with fake OMP RPC CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-rpc-test-'));
  const fakeCliJs = join(root, 'fake-omp-rpc.js');

  await writeFile(
    fakeCliJs,
    `
const readline = require('readline');
// 1. Emit handshake ready and available commands
console.log(JSON.stringify({
  type: 'ready',
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1048576,
  maxReassembledFrameBytes: 67108864
}));
console.log(JSON.stringify({
  type: 'available_commands_update',
  commands: [{ name: 'prompt' }, { name: 'steer' }, { name: 'abort' }, { name: 'get_state' }]
}));

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const cmd = JSON.parse(line.trim());
    if (cmd.type === 'prompt') {
      console.log(JSON.stringify({ type: 'message_update', content: [{ type: 'text', text: 'Analisis tugas: ' + cmd.prompt }] }));
      console.log(JSON.stringify({ type: 'tool_start', tool: 'inspect_workspace', input: { path: 'src' } }));
      console.log(JSON.stringify({ type: 'tool_end', tool: 'inspect_workspace', output: 'ok' }));
      console.log(JSON.stringify({ type: 'turn_end' }));
      console.log(JSON.stringify({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { sessionId: 'rpc-sess-test-99' } }));
    } else if (cmd.type === 'steer') {
      console.log(JSON.stringify({ type: 'message_update', content: [{ type: 'text', text: 'Bimbingan diterima: ' + cmd.message }] }));
      console.log(JSON.stringify({ id: cmd.id, type: 'response', command: 'steer', success: true }));
    } else if (cmd.type === 'abort') {
      console.log(JSON.stringify({ type: 'message_update', content: [{ type: 'text', text: 'Generasi turn dibatalkan' }] }));
      console.log(JSON.stringify({ id: cmd.id, type: 'response', command: 'abort', success: true }));
    } else if (cmd.type === 'get_state') {
      console.log(JSON.stringify({ id: cmd.id, type: 'response', command: 'get_state', success: true, data: { status: 'idle', sessionId: 'rpc-sess-test-99' } }));
    }
  } catch (err) {}
});
`
  );

  const fakeCliCmd = join(root, 'omp.cmd');
  await writeFile(fakeCliCmd, `@node "${fakeCliJs}" %*\r\n`);
  const fakeCliSh = join(root, 'omp');
  await writeFile(fakeCliSh, `#!/usr/bin/env node\nrequire('${fakeCliJs.replace(/\\/g, '/')}');\n`);
  await chmod(fakeCliSh, 0o755);

  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const stateTransitions: string[] = [];

  const session = new OmpRpcSession({
    workspaceDir: root,
    binPath: process.platform === 'win32' ? fakeCliCmd : fakeCliSh,
    commandTimeoutMs: 5000,
    idleTimeoutMs: 60000,
    onEvent: (evt) => {
      events.push({ type: evt.type, data: evt.data as Record<string, unknown> });
    },
    onStateChange: (state) => {
      stateTransitions.push(state);
    },
  });

  // 1. Start session & handshake
  const handshake = await session.start();
  assert.equal(handshake.type, 'ready');
  assert.equal(handshake.protocolVersion, 1);
  assert.equal(session.getState(), 'ready');

  // 2. Send prompt command
  const promptRes = await session.prompt('buat refactoring');
  assert.equal(promptRes.success, true);
  assert.equal(promptRes.command, 'prompt');
  assert.equal(session.getSessionId(), 'rpc-sess-test-99');

  // Verify streaming events collected incrementally
  assert.ok(events.length >= 3);
  const textEvt = events.find((e) => e.type === 'text');
  assert.ok(textEvt);
  assert.ok(String(textEvt.data.text).includes('buat refactoring'));

  const toolStartEvt = events.find((e) => e.type === 'tool_start');
  assert.ok(toolStartEvt);
  assert.equal(toolStartEvt.data.toolName, 'inspect_workspace');

  // 3. Send steer command mid-session
  const steerRes = await session.steer('gunakan arsitektur modular');
  assert.equal(steerRes.success, true);
  assert.equal(steerRes.command, 'steer');

  const steerTextEvt = events.find((e) => e.type === 'text' && String(e.data.text).includes('arsitektur modular'));
  assert.ok(steerTextEvt);

  // 4. Send abort command
  const abortRes = await session.abort();
  assert.equal(abortRes.success, true);
  assert.equal(abortRes.command, 'abort');

  // 5. Send get_state
  const stateRes = await session.getStateDetails();
  assert.equal(stateRes.success, true);
  assert.equal(stateRes.command, 'get_state');

  // 6. Graceful close
  await session.close();
  assert.equal(session.getState(), 'closed');
});

test('session error handling: process crash rejects pending commands without hanging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-rpc-crash-'));
  const crashJs = join(root, 'crash-omp.js');

  await writeFile(
    crashJs,
    `
console.log(JSON.stringify({
  type: 'ready',
  protocolVersion: 1,
  supportedProtocolVersions: [1],
  maxFrameBytes: 1048576,
  maxReassembledFrameBytes: 67108864
}));
// Exit abruptly with code 1 after 50ms
setTimeout(() => process.exit(1), 50);
`
  );

  const crashCmd = join(root, 'omp-crash.cmd');
  await writeFile(crashCmd, `@node "${crashJs}" %*\r\n`);
  const crashSh = join(root, 'omp-crash');
  await writeFile(crashSh, `#!/usr/bin/env node\nrequire('${crashJs.replace(/\\/g, '/')}');\n`);
  await chmod(crashSh, 0o755);

  const session = new OmpRpcSession({
    workspaceDir: root,
    binPath: process.platform === 'win32' ? crashCmd : crashSh,
    commandTimeoutMs: 3000,
  });

  await session.start();
  assert.equal(session.getState(), 'ready');

  // Wait for the crash to occur
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(session.getState(), 'crashed');
  await assert.rejects(
    () => session.prompt('crashed prompt'),
    /Cannot send command in state 'crashed'/
  );

  await session.close();
});

test('session error handling: command timeout rejects when CLI is unresponsive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-rpc-unresponsive-'));
  const hangJs = join(root, 'hang-omp.js');

  await writeFile(
    hangJs,
    `
console.log(JSON.stringify({
  type: 'ready',
  protocolVersion: 1,
  supportedProtocolVersions: [1],
  maxFrameBytes: 1048576,
  maxReassembledFrameBytes: 67108864
}));
// Ignore stdin completely without responding
setInterval(() => {}, 1000);
`
  );

  const hangCmd = join(root, 'omp-hang.cmd');
  await writeFile(hangCmd, `@node "${hangJs}" %*\r\n`);
  const hangSh = join(root, 'omp-hang');
  await writeFile(hangSh, `#!/usr/bin/env node\nrequire('${hangJs.replace(/\\/g, '/')}');\n`);
  await chmod(hangSh, 0o755);

  const session = new OmpRpcSession({
    workspaceDir: root,
    binPath: process.platform === 'win32' ? hangCmd : hangSh,
    commandTimeoutMs: 300, // Short timeout for test
  });

  await session.start();
  assert.equal(session.getState(), 'ready');

  await assert.rejects(
    () => session.prompt('hang prompt'),
    /timed out after 300ms/
  );

  await session.close();
});

test('live probe (real OMP binary): connects to real local omp and executes get_state via RPC', async () => {
  const localOmpPath = 'C:\\Users\\Rizky Fauzi\\.bun\\bin\\omp.exe';
  if (!existsSync(localOmpPath)) {
    // Skip if real binary not in this specific path
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'omp-real-probe-'));
  const session = new OmpRpcSession({
    workspaceDir: root,
    binPath: localOmpPath,
    commandTimeoutMs: 10000,
    idleTimeoutMs: 10000,
  });

  try {
    const handshake = await session.start();
    assert.equal(handshake.type, 'ready');
    assert.equal(handshake.protocolVersion, 1);
    assert.ok(handshake.maxFrameBytes >= 1048576);

    const stateRes = await session.getStateDetails();
    assert.equal(stateRes.success, true);
    assert.equal(stateRes.command, 'get_state');
    assert.ok(typeof stateRes.data === 'object');
    assert.ok(stateRes.data?.['sessionId']);
  } finally {
    await session.close();
  }
});
