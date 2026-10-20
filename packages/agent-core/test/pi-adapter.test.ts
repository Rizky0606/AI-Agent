import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import test from 'node:test';
import { PermissionEngine } from '@personal-ai-os/permissions';
import {
  PiRuntimeAdapter,
  PiJsonlParser,
  type PiRpcResponse,
} from '../src/index.ts';

function createMockChildProcess(): {
  child: ChildProcess;
  stdinStream: PassThrough;
  stdoutStream: PassThrough;
  stderrStream: PassThrough;
} {
  const stdinStream = new PassThrough();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();

  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdin: stdinStream,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 99999,
    killed: false,
    kill: (signal?: NodeJS.Signals) => {
      child.killed = true;
      emitter.emit('close', 0, signal ?? 'SIGTERM');
      return true;
    },
  }) as unknown as ChildProcess;

  return { child, stdinStream, stdoutStream, stderrStream };
}

test('PiRuntimeAdapter: Feature flag is strictly default OFF and fails closed', async () => {
  // Clear any ambient environment variable
  const oldEnv = process.env.PI_RUNTIME_ENABLED;
  delete process.env.PI_RUNTIME_ENABLED;

  try {
    const adapter = new PiRuntimeAdapter();

    assert.equal(adapter.isEnabled(), false, 'Pi adapter must be disabled by default');
    assert.equal(adapter.getStatus(), 'uninitialized');

    const health = await adapter.healthCheck();
    assert.equal(health.healthy, false);
    assert.ok(health.error?.includes('disabled by feature flag'));

    // Direct execution must fail with clear error
    const result = await adapter.execute({
      taskId: 'task-test-ff-off',
      prompt: 'Refactor code',
    });

    assert.equal(result.status, 'failed');
    assert.ok(result.error?.includes('PI_RUNTIME_ENABLED=false'));
    assert.equal(result.untrustedOutputWarning, true);
  } finally {
    if (oldEnv !== undefined) {
      process.env.PI_RUNTIME_ENABLED = oldEnv;
    }
  }
});

test('PiRuntimeAdapter: Missing binary detection reports unhealthy and fails execution', async () => {
  const adapter = new PiRuntimeAdapter({
    enabled: true,
    binPath: 'nonexistent-pi-binary-12345',
    checkBinaryFn: () => false,
  });

  assert.equal(adapter.isEnabled(), true);
  assert.equal(adapter.getStatus(), 'stopped');

  const health = await adapter.healthCheck();
  assert.equal(health.healthy, false);
  assert.ok(health.error?.includes('not available on this host'));

  const result = await adapter.execute({
    taskId: 'task-missing-bin',
    prompt: 'Fix tests',
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.error?.includes('not found on host'));
});

test('PiRuntimeAdapter: Successfully initializes when enabled and binary present', async () => {
  const adapter = new PiRuntimeAdapter({
    enabled: true,
    binPath: 'pi',
    checkBinaryFn: () => true,
  });

  const health = await adapter.healthCheck();
  assert.equal(health.healthy, true);
  assert.ok(health.details?.includes('Pi Coding Agent v1.1.0 ready'));

  await adapter.initialize();
  assert.equal(adapter.getStatus(), 'idle');
});

test('PiRuntimeAdapter: Executes RPC turn with handshake, get_state, and text streaming', async () => {
  let spawnedArgs: string[] = [];

  const mock = createMockChildProcess();

  // Handle incoming stdin from the adapter
  mock.stdinStream.on('data', (data: Buffer) => {
    const lines = data.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const cmd = JSON.parse(line) as { id: string; type: string; prompt?: string };

        if (cmd.type === 'get_state') {
          // Correlate get_state response matching authentic ADR 0035 fixture
          const resp: PiRpcResponse = {
            id: cmd.id,
            type: 'response',
            command: 'get_state',
            success: true,
            data: {
              model: {
                id: 'Gratisan',
                name: 'Gratisan',
                baseUrl: 'https://9router.ojixx.my.id/v1',
                provider: 'openai',
              },
              sessionId: 'sess-test-uuid',
              isStreaming: false,
            },
          };
          mock.stdoutStream.write(JSON.stringify(resp) + '\n');
        }

        if (cmd.type === 'prompt') {
          // Stream token delta events
          mock.stdoutStream.write(
            JSON.stringify({
              type: 'message_update',
              delta: { type: 'text_delta', text: 'Hello, I will refactor your code.' },
            }) + '\n',
          );

          // Emit plan items
          mock.stdoutStream.write(
            JSON.stringify({
              type: 'plan',
              planItems: ['1. Read source', '2. Apply changes', '3. Run tests'],
            }) + '\n',
          );

          // Prompt completion response
          const resp: PiRpcResponse = {
            id: cmd.id,
            type: 'response',
            command: 'prompt',
            success: true,
            data: { finishReason: 'stop' },
          };
          mock.stdoutStream.write(JSON.stringify(resp) + '\n');
        }
      } catch {
        // malformed line
      }
    }
  });

  const adapter = new PiRuntimeAdapter({
    enabled: true,
    binPath: 'pi',
    checkBinaryFn: () => true,
    spawnFn: ((file: string, args: string[]) => {
      spawnedArgs = args;
      // Emit initial frames: extension request and ready frame
      setImmediate(() => {
        mock.stdoutStream.write(
          JSON.stringify({
            type: 'extension_ui_request',
            id: 'ext-req-1',
            method: 'setWidget',
            widgetKey: 'subagent-async',
          }) + '\n',
        );

        mock.stdoutStream.write(
          JSON.stringify({
            type: 'ready',
            protocolVersion: 1,
            supportedProtocolVersions: [1, 2],
            maxFrameBytes: 1048576,
            maxReassembledFrameBytes: 67108864,
          }) + '\n',
        );
      });
      return mock.child;
    }) as unknown as typeof spawn,
  });

  const eventsReceived: Array<Record<string, unknown>> = [];
  const result = await adapter.execute({
    taskId: 'task-rpc-turn-1',
    prompt: 'Refactor database queries',
    onEvent: (evt) => eventsReceived.push(evt),
  });

  // Verify command line arguments enforce strict policies
  assert.ok(spawnedArgs.includes('--mode'));
  assert.ok(spawnedArgs.includes('rpc'));
  assert.ok(spawnedArgs.includes('--no-extensions'), 'Must enforce --no-extensions');
  assert.ok(spawnedArgs.includes('--no-session'));

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Hello, I will refactor your code.');
  assert.equal(result.untrustedOutputWarning, true);
  assert.ok(result.events && result.events.length >= 2);
  assert.equal(eventsReceived.length, result.events?.length);
});

test('PiRuntimeAdapter: PermissionEngine blocks HIGH/CRITICAL untrusted actions from Pi', async () => {
  const permissions = new PermissionEngine([
    {
      pattern: /^file:read$/i,
      baseRisk: 'LOW',
      consequence: 'Read file',
      allowWithoutApproval: true,
    },
    {
      pattern: /^shell:exec$/i,
      baseRisk: 'HIGH',
      consequence: 'Execute terminal command',
      allowWithoutApproval: false,
    },
  ]);

  const mock = createMockChildProcess();

  mock.stdinStream.on('data', (data: Buffer) => {
    const lines = data.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const cmd = JSON.parse(line) as { id: string; type: string };
        if (cmd.type === 'get_state') {
          mock.stdoutStream.write(
            JSON.stringify({
              id: cmd.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: {
                model: { id: 'Gratisan', baseUrl: 'https://9router.ojixx.my.id/v1' },
              },
            }) + '\n',
          );
        }
        if (cmd.type === 'prompt') {
          // 1. Tool start for low-risk read
          mock.stdoutStream.write(
            JSON.stringify({
              type: 'tool_start',
              toolName: 'read',
              input: { path: 'src/index.ts' },
            }) + '\n',
          );
          mock.stdoutStream.write(
            JSON.stringify({
              type: 'tool_end',
              toolName: 'read',
              output: 'content of index.ts',
            }) + '\n',
          );

          // 2. Tool start for high-risk terminal execution
          mock.stdoutStream.write(
            JSON.stringify({
              type: 'tool_start',
              toolName: 'bash',
              input: { command: 'rm -rf /var/data' },
            }) + '\n',
          );

          // Complete prompt
          mock.stdoutStream.write(
            JSON.stringify({
              id: cmd.id,
              type: 'response',
              command: 'prompt',
              success: true,
            }) + '\n',
          );
        }
      } catch {
        // ignore
      }
    }
  });

  const adapter = new PiRuntimeAdapter(
    {
      enabled: true,
      binPath: 'pi',
      checkBinaryFn: () => true,
      spawnFn: (() => {
        setImmediate(() => {
          mock.stdoutStream.write(
            JSON.stringify({
              type: 'ready',
              protocolVersion: 1,
              supportedProtocolVersions: [1],
              maxFrameBytes: 1048576,
              maxReassembledFrameBytes: 67108864,
            }) + '\n',
          );
        });
        return mock.child;
      }) as unknown as typeof spawn,
    },
    permissions,
  );

  const result = await adapter.execute({
    taskId: 'task-perm-engine-test',
    prompt: 'Read file and execute cleanup',
  });

  // Since HIGH risk shell:exec was proposed without approval, task execution is flagged
  assert.equal(result.status, 'failed');
  assert.equal(result.untrustedOutputWarning, true);
  assert.equal(result.proposedActions?.length, 2);

  // Proposed Action 1 (read) -> Allowed
  assert.equal(result.appliedActions?.[0]?.action.action, 'file:read');
  assert.equal(result.appliedActions?.[0]?.permissionGranted, true);
  assert.equal(result.appliedActions?.[0]?.executed, true);

  // Proposed Action 2 (bash) -> Blocked
  assert.equal(result.appliedActions?.[1]?.action.action, 'shell:exec');
  assert.equal(result.appliedActions?.[1]?.permissionGranted, false);
  assert.equal(result.appliedActions?.[1]?.executed, false);
});

test('PiRuntimeAdapter: Gateway policy strictly rejects non-9Router base URLs', async () => {
  const mock = createMockChildProcess();

  mock.stdinStream.on('data', (data: Buffer) => {
    const lines = data.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const cmd = JSON.parse(line) as { id: string; type: string };
        if (cmd.type === 'get_state') {
          // Model reports unauthorized foreign endpoint!
          mock.stdoutStream.write(
            JSON.stringify({
              id: cmd.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: {
                model: {
                  id: 'rogue-model',
                  baseUrl: 'https://unauthorized-gateway.evil.com/v1',
                },
              },
            }) + '\n',
          );
        }
      } catch {
        // ignore
      }
    }
  });

  const adapter = new PiRuntimeAdapter({
    enabled: true,
    binPath: 'pi',
    checkBinaryFn: () => true,
    spawnFn: (() => {
      setImmediate(() => {
        mock.stdoutStream.write(
          JSON.stringify({
            type: 'ready',
            protocolVersion: 1,
            supportedProtocolVersions: [1],
            maxFrameBytes: 1048576,
            maxReassembledFrameBytes: 67108864,
          }) + '\n',
        );
      });
      return mock.child;
    }) as unknown as typeof spawn,
  });

  const result = await adapter.execute({
    taskId: 'task-rogue-gateway',
    prompt: 'Query foreign API',
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.error?.includes('Security Policy Violation'));
  assert.ok(result.error?.includes('unauthorized gateway'));
});

test('PiRuntimeAdapter: Cancellation triggers abort command and cleans up process', async () => {
  const mock = createMockChildProcess();
  let abortCommandReceived = false;

  mock.stdinStream.on('data', (data: Buffer) => {
    const lines = data.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const cmd = JSON.parse(line) as { id: string; type: string };
        if (cmd.type === 'get_state') {
          mock.stdoutStream.write(
            JSON.stringify({
              id: cmd.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: {
                model: { id: 'Gratisan', baseUrl: 'https://9router.ojixx.my.id/v1' },
              },
            }) + '\n',
          );
        }
        if (cmd.type === 'abort') {
          abortCommandReceived = true;
          mock.stdoutStream.write(
            JSON.stringify({
              id: cmd.id,
              type: 'response',
              command: 'abort',
              success: true,
            }) + '\n',
          );
          setImmediate(() => {
            (mock.child as unknown as EventEmitter).emit('close', 0, 'SIGTERM');
          });
        }
      } catch {
        // ignore
      }
    }
  });

  const adapter = new PiRuntimeAdapter({
    enabled: true,
    binPath: 'pi',
    checkBinaryFn: () => true,
    spawnFn: (() => {
      setImmediate(() => {
        mock.stdoutStream.write(
          JSON.stringify({
            type: 'ready',
            protocolVersion: 1,
            supportedProtocolVersions: [1],
            maxFrameBytes: 1048576,
            maxReassembledFrameBytes: 67108864,
          }) + '\n',
        );
      });
      return mock.child;
    }) as unknown as typeof spawn,
  });

  // Start execution
  const execPromise = adapter.execute({
    taskId: 'task-cancel-me',
    prompt: 'Long running task',
  });

  // Allow adapter to start prompt and become active, then cancel
  await new Promise((r) => setTimeout(r, 30));
  await adapter.cancel('task-cancel-me');

  const result = await execPromise;

  assert.equal(result.status, 'cancelled');
  assert.equal(abortCommandReceived, true);
});

test('PiRuntimeAdapter: Pre-cancelled task terminates immediately without spawning', async () => {
  const adapter = new PiRuntimeAdapter({
    enabled: true,
    binPath: 'pi',
    checkBinaryFn: () => true,
  });

  await adapter.cancel('task-pre-cancelled');
  const result = await adapter.execute({
    taskId: 'task-pre-cancelled',
    prompt: 'Should not run',
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.durationMs, 0);
  assert.ok(result.error?.includes('cancelled prior to execution'));
});

test('PiJsonlParser: Safely bounds memory and discards oversized lines without crashing', () => {
  const parser = new PiJsonlParser(100);

  // Normal chunk
  const r1 = parser.feed('{"type":"ready","version":1}\n');
  assert.equal(r1.length, 1);
  assert.equal(r1[0]?.parsed?.['type'], 'ready');

  // Oversized chunk exceeding 100 bytes
  const giant = 'x'.repeat(150) + '\n';
  const r2 = parser.feed(giant);
  assert.equal(r2.length, 0);
  assert.equal(parser.isTruncated(), true);

  // Non-JSON line
  const r3 = parser.feed('plain log line\n');
  assert.equal(r3.length, 1);
  assert.equal(r3[0]?.raw, 'plain log line');
  assert.equal(r3[0]?.parsed, undefined);
});
