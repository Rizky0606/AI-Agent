import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryTaskRepository } from '../src/db/task-repository.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { InMemoryTaskQueue } from '../src/services/task-queue.ts';

const setupTaskTest = async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-secret-test-secret-test-secret-32');
  const projectRepo = new InMemoryProjectRepository();
  const chatRepo = new InMemoryChatRepository();
  const taskRepo = new InMemoryTaskRepository();
  const taskQueue = new InMemoryTaskQueue({ autoDispatch: false });
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const app = await buildApp({
    auth,
    health: { database: async () => true, redis: async () => true },
    project: { projectRepo, chatRepo },
    task: { projectRepo, taskRepo, taskQueue, broadcaster },
  });

  const alice = await auth.register('alice@tasks.com', 'password-123456');
  const project = await projectRepo.createProject(alice.user.id, 'Task Project');

  return { app, auth, projectRepo, taskRepo, taskQueue, broadcaster, alice, project };
};

test('Task creation, validation, and idempotency key deduplication', async () => {
  const { app, alice, project, taskQueue } = await setupTaskTest();

  // 1. Create task with idempotencyKey
  const res1 = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: project.id,
      kind: 'generic_task',
      payload: { goal: 'Analisis data' },
      idempotencyKey: 'idem-key-12345',
      priority: 5,
    },
  });
  assert.equal(res1.statusCode, 201);
  const data1 = res1.json();
  assert.equal(data1.isDuplicate, false);
  assert.equal(data1.task.status, 'queued');
  assert.equal(data1.task.idempotencyKey, 'idem-key-12345');
  assert.equal(data1.task.priority, 5);

  // Job should be enqueued in taskQueue
  assert.ok(taskQueue.getEnqueuedJob(data1.task.id));

  // 2. Repeat request with identical idempotencyKey
  const res2 = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: project.id,
      kind: 'generic_task',
      payload: { goal: 'Analisis data duplicate' },
      idempotencyKey: 'idem-key-12345',
    },
  });
  assert.equal(res2.statusCode, 200);
  const data2 = res2.json();
  assert.equal(data2.isDuplicate, true);
  assert.equal(data2.task.id, data1.task.id);

  // 3. Get task details
  const getRes = await app.inject({
    method: 'GET',
    url: `/v1/tasks/${data1.task.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json().id, data1.task.id);

  await app.close();
});

test('Task lifecycle: pause, resume, cancel, and approval transitions', async () => {
  const { app, alice, project, taskRepo } = await setupTaskTest();

  // Create base task
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: project.id,
      kind: 'generic_task',
      payload: { requiresApproval: true },
    },
  });
  const task = createRes.json().task;
  assert.equal(task.status, 'queued');

  // 1. Pause task
  const pauseRes = await app.inject({
    method: 'POST',
    url: `/v1/tasks/${task.id}/pause`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(pauseRes.statusCode, 200);
  assert.equal(pauseRes.json().status, 'paused');

  // 2. Resume task
  const resumeRes = await app.inject({
    method: 'POST',
    url: `/v1/tasks/${task.id}/resume`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(resumeRes.statusCode, 200);
  assert.equal(resumeRes.json().status, 'queued');

  // Simulate task moving to waiting_approval
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'planning');
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'running');
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'waiting_approval');

  // 3. Approve task
  const approveRes = await app.inject({
    method: 'POST',
    url: `/v1/tasks/${task.id}/approve`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(approveRes.statusCode, 200);
  assert.equal(approveRes.json().status, 'running');

  // 4. Cancel task
  const cancelRes = await app.inject({
    method: 'POST',
    url: `/v1/tasks/${task.id}/cancel`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.json().status, 'cancelled');

  await app.close();
});

test('Realtime WebSocket event streaming and replay on reconnect', async () => {
  const { app, alice, project, taskRepo, broadcaster } = await setupTaskTest();

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;

  // 1. Create a task and record events in repo
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/tasks',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: project.id,
      kind: 'stream_test_task',
      payload: {},
    },
  });
  const task = createRes.json().task;

  // Simulate worker publishing several events
  const evt1 = await taskRepo.createTaskEvent(alice.user.id, task.id, 'task.started', { step: 1 });
  const evt2 = await taskRepo.createTaskEvent(alice.user.id, task.id, 'task.progress', {
    progress: 50,
  });
  const evt3 = await taskRepo.createTaskEvent(alice.user.id, task.id, 'task.tool_call', {
    tool: 'search',
  });
  const evt4 = await taskRepo.createTaskEvent(alice.user.id, task.id, 'task.completed', {
    progress: 100,
  });

  // 2. Connect client providing last_event_id = evt1.id to request replay of evt2, evt3, evt4
  const wsUrl = `ws://127.0.0.1:${port}/v1/events/ws?token=${alice.accessToken}&taskId=${task.id}&last_event_id=${evt1.id}`;
  const ws = new WebSocket(wsUrl);

  const receivedEvents: Array<Record<string, unknown>> = [];
  const replayPromise = new Promise<void>((resolve) => {
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data.toString()) as Record<string, unknown>;
      receivedEvents.push(data);
      if (data.eventType === 'task.completed') {
        resolve();
      }
    };
  });

  await replayPromise;

  // Verify replayed events
  const replayed = receivedEvents.filter((e) => e.replayed === true);
  assert.equal(replayed.length, 3);
  assert.equal(replayed[0]?.id, evt2.id);
  assert.equal(replayed[1]?.id, evt3.id);
  assert.equal(replayed[2]?.id, evt4.id);

  // 3. Test live event broadcast on the same connection
  const livePromise = new Promise<Record<string, unknown>>((resolve) => {
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data.toString()) as Record<string, unknown>;
      if (data.eventType === 'task.resumed') {
        resolve(data);
      }
    };
  });

  const liveEvt = await taskRepo.createTaskEvent(alice.user.id, task.id, 'task.resumed', {
    live: true,
  });
  broadcaster.publish(liveEvt);

  const liveReceived = await livePromise;
  assert.equal(liveReceived.eventType, 'task.resumed');
  assert.equal(liveReceived.replayed, false);

  ws.close();
  await app.close();
});
