import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryTaskRepository } from '../src/db/task-repository.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { InMemoryTaskQueue } from '../src/services/task-queue.ts';
import { TaskExecutor } from '../../agent-worker/src/task-executor.ts';
import { RemoteRuntimeAdapter } from '../../../packages/agent-core/src/runtimes/remote-adapter.ts';
import { RuntimeManager } from '../../../packages/agent-core/src/runtimes/runtime-manager.ts';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'aios-runtime-e2e-'));
const binaryDir = join(temporaryRoot, 'bin');
const token = 'isolated-runtime-bridge-test-token-0123456789';
await mkdir(binaryDir);
await writeFile(join(temporaryRoot, 'token'), token, { mode: 0o600 });
await writeFile(join(binaryDir, 'omp'), '#!/bin/sh\nprintf "isolated-runtime-output\\n"\n');
await chmod(join(binaryDir, 'omp'), 0o755);

const env = {
  bind: process.env.RUNTIME_BRIDGE_BIND,
  port: process.env.RUNTIME_BRIDGE_PORT,
  tokenFile: process.env.RUNTIME_BRIDGE_TOKEN_FILE,
  workspaceRoot: process.env.RUNTIME_WORKSPACE_ROOT,
  auditFile: process.env.RUNTIME_AUDIT_FILE,
  binDir: process.env.RUNTIME_BIN_DIR,
};
process.env.RUNTIME_BRIDGE_BIND = '127.0.0.1';
process.env.RUNTIME_BRIDGE_PORT = '0';
process.env.RUNTIME_BRIDGE_TOKEN_FILE = join(temporaryRoot, 'token');
process.env.RUNTIME_WORKSPACE_ROOT = join(temporaryRoot, 'workspaces');
process.env.RUNTIME_AUDIT_FILE = join(temporaryRoot, 'audit.jsonl');
process.env.RUNTIME_BIN_DIR = binaryDir;

// Bridge captures environment at import time; configure a fake binary and isolated state first.
const { server } = await import('../../runtime-bridge/src/index.ts');
const listening = Promise.withResolvers<void>();
server.once('error', listening.reject);
server.listen(0, '127.0.0.1', listening.resolve);
await listening.promise;
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test bridge failed to bind');
const bridgeUrl = `http://127.0.0.1:${address.port}`;

const auth = createAuthService(new InMemoryAuthRepository(), 'isolated-test-secret-long-enough-for-hmac');
const projectRepo = new InMemoryProjectRepository();
const taskRepo = new InMemoryTaskRepository();
const broadcaster = new InMemoryTaskEventBroadcaster();
const events: TaskEventEnvelope[] = [];
broadcaster.subscribe((event) => events.push(event));
const queue = new InMemoryTaskQueue();
const manager = new RuntimeManager();
manager.register(new RemoteRuntimeAdapter({ id: 'omp', name: 'test OMP bridge', version: 'test', baseUrl: bridgeUrl, token }));
await manager.initializeAll();
const executionFinished = Promise.withResolvers<void>();
const executor = new TaskExecutor(taskRepo, broadcaster, { runtimeManager: manager, preferredRuntimeId: 'omp' });
queue.setHandler(async (job) => {
  try { await executor.execute(job); } finally { executionFinished.resolve(); }
});
const app = await buildApp({ auth, task: { projectRepo, taskRepo, taskQueue: queue, broadcaster } });
const user = await auth.register('runtime-e2e@example.test', 'local-test-password');
const project = await projectRepo.createProject(user.user.id, 'Runtime e2e');

test('authenticated task creation executes through worker adapter and isolated runtime bridge', async () => {
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: {
        projectId: project.id,
        kind: 'coding_runtime',
        payload: { useRuntime: true, runtime: 'omp', prompt: 'return isolated output', workspaceId: `${project.id}/e2e` },
      },
    });
    assert.equal(response.statusCode, 201);
    const { task: created } = response.json() as { task: { id: string } };
    await executionFinished.promise;
    const result = await app.inject({ method: 'GET', url: `/v1/tasks/${created.id}`, headers: { authorization: `Bearer ${user.accessToken}` } });
    assert.equal(result.statusCode, 200);
    const task = result.json() as { status: string; artifacts?: Array<unknown> };
    assert.equal(task.status, 'completed');
    assert.ok(task.artifacts?.some((artifact) => (artifact as Record<string, unknown>).type === 'runtime_output' && String((artifact as Record<string, unknown>).content).includes('isolated-runtime-output')));
    assert.ok(events.some((event) => event.taskId === created.id && event.eventType === 'task.completed'));
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temporaryRoot, { recursive: true, force: true });
    if (env.bind === undefined) delete process.env.RUNTIME_BRIDGE_BIND; else process.env.RUNTIME_BRIDGE_BIND = env.bind;
    if (env.port === undefined) delete process.env.RUNTIME_BRIDGE_PORT; else process.env.RUNTIME_BRIDGE_PORT = env.port;
    if (env.tokenFile === undefined) delete process.env.RUNTIME_BRIDGE_TOKEN_FILE; else process.env.RUNTIME_BRIDGE_TOKEN_FILE = env.tokenFile;
    if (env.workspaceRoot === undefined) delete process.env.RUNTIME_WORKSPACE_ROOT; else process.env.RUNTIME_WORKSPACE_ROOT = env.workspaceRoot;
    if (env.auditFile === undefined) delete process.env.RUNTIME_AUDIT_FILE; else process.env.RUNTIME_AUDIT_FILE = env.auditFile;
    if (env.binDir === undefined) delete process.env.RUNTIME_BIN_DIR; else process.env.RUNTIME_BIN_DIR = env.binDir;
  }
});
