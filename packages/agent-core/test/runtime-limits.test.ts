import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeManager, type AgentRuntime } from '../src/index.ts';

function gateRuntime(gate: Promise<void>): AgentRuntime {
  return {
    id: 'omp',
    name: 'fake omp',
    version: '18.6.1',
    capabilities: [{ name: 'coding', level: 'execute' }],
    getStatus: () => 'idle',
    initialize: async () => undefined,
    execute: async (input) => {
      await gate;
      return { taskId: input.taskId, status: 'completed', output: 'selesai', durationMs: 1 };
    },
    pause: async () => undefined,
    resume: async () => undefined,
    cancel: async () => undefined,
    healthCheck: async () => ({ healthy: true, lastChecked: new Date().toISOString() }),
  };
}

test('RuntimeManager caps concurrent bridge executions per runtime and frees the slot', async () => {
  process.env['RUNTIME_MAX_IN_FLIGHT'] = '1';
  try {
    const manager = new RuntimeManager();
    const gate = Promise.withResolvers<void>();
    manager.register(gateRuntime(gate.promise));

    const first = manager.execute('omp', { taskId: 'task-1', prompt: 'satu' });
    const blocked = await manager.execute('omp', { taskId: 'task-2', prompt: 'dua' });

    assert.equal(blocked.status, 'failed');
    assert.match(blocked.error ?? '', /Batas eksekusi bersamaan untuk 'runtime:omp'/);
    assert.equal(blocked.untrustedOutputWarning, true);

    gate.resolve();
    assert.equal((await first).status, 'completed');

    // The slot was released, so the next task is admitted again.
    assert.equal((await manager.execute('omp', { taskId: 'task-3', prompt: 'tiga' })).status, 'completed');
  } finally {
    delete process.env['RUNTIME_MAX_IN_FLIGHT'];
  }
});

test('RuntimeManager fails a task for an unregistered runtime instead of driving it', async () => {
  const manager = new RuntimeManager();
  const result = await manager.execute('hermes', { taskId: 'task-1', prompt: 'satu' });

  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /Selected runtime "hermes" is not registered/);
});
