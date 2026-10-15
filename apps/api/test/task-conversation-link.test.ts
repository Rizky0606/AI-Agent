import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryTaskRepository } from '../src/db/task-repository.ts';
import { InMemoryTaskQueue } from '../src/services/task-queue.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';

// End-to-end over a real listening HTTP server: the chat surface's "run draft as task" button
// must link the created task to its conversation, and the link must survive the round trip.
test('chat can launch a task bound to its conversation', { timeout: 15000 }, async (t) => {
  const auth = createAuthService(new InMemoryAuthRepository(), 'task-conversation-secret-at-least-32');
  const alice = await auth.register('task-link@example.com', 'ValidPassword123!');
  const bob = await auth.register('other-task-link@example.com', 'ValidPassword123!');

  const projectRepo = new InMemoryProjectRepository();
  const chatRepo = new InMemoryChatRepository();
  const taskRepo = new InMemoryTaskRepository();
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const aliceProject = await projectRepo.createProject(alice.user.id, 'Alice Project');
  const bobProject = await projectRepo.createProject(bob.user.id, 'Bob Project');
  const aliceConversation = await chatRepo.createConversation(alice.user.id, aliceProject.id, 'Alice chat');
  await chatRepo.createConversation(bob.user.id, bobProject.id, 'Bob chat');

  const published: TaskEventEnvelope[] = [];
  broadcaster.subscribe((event) => published.push(event));

  const app = await buildApp({
    auth,
    task: { projectRepo, chatRepo, taskRepo, taskQueue: new InMemoryTaskQueue(), broadcaster },
  });
  app.log.level = 'silent';
  t.after(async () => { await app.close(); });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const asAlice = { authorization: `Bearer ${alice.accessToken}` };
  const asBob = { authorization: `Bearer ${bob.accessToken}` };

  // 1. Create a task from chat: it is stored with the conversation it came from.
  const created = await fetch(`${base}/v1/tasks`, {
    method: 'POST',
    headers: { ...asAlice, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: aliceProject.id,
      kind: 'generic_task',
      payload: { prompt: 'Summarise the attached notes' },
      conversationId: aliceConversation.id,
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { task: { id: string; conversationId: string | null }; isDuplicate: boolean };
  assert.equal(createdBody.isDuplicate, false);
  assert.equal(createdBody.task.conversationId, aliceConversation.id);

  // 2. The link is durable: reading the task and filtering by conversation both agree.
  const fetched = await fetch(`${base}/v1/tasks/${createdBody.task.id}`, { headers: asAlice });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json() as { conversationId: string | null }).conversationId, aliceConversation.id);

  const filtered = await fetch(`${base}/v1/tasks?conversationId=${aliceConversation.id}`, { headers: asAlice });
  assert.equal(filtered.status, 200);
  const filteredBody = await filtered.json() as { tasks: { id: string }[] };
  assert.deepEqual(filteredBody.tasks.map((task) => task.id), [createdBody.task.id]);

  // 3. Filtering is scoped: another conversation of the same user yields nothing.
  const otherProject = await projectRepo.createProject(alice.user.id, 'Second Project');
  const otherConversation = await chatRepo.createConversation(alice.user.id, otherProject.id, 'Other chat');
  const empty = await fetch(`${base}/v1/tasks?conversationId=${otherConversation.id}`, { headers: asAlice });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json() as { tasks: unknown[] }).tasks, []);

  // 4. A conversation uuid the caller does not own must not accept a task.
  const crossUser = await fetch(`${base}/v1/tasks`, {
    method: 'POST',
    headers: { ...asBob, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: bobProject.id,
      kind: 'generic_task',
      payload: { prompt: 'Peek at someone else' },
      conversationId: aliceConversation.id,
    }),
  });
  assert.equal(crossUser.status, 404);
  assert.equal((await crossUser.json() as { error: { code: string } }).error.code, 'NOT_FOUND');

  // 5. The task.created event carries the link so live subscribers can filter by it.
  const createdEvents = published.filter((event) => event.eventType === 'task.created' && event.taskId === createdBody.task.id);
  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0]?.payload['conversationId'], aliceConversation.id);

  // 6. A task created without a conversationId (the tasks screen path) stays unlinked.
  const projectTask = await fetch(`${base}/v1/tasks`, {
    method: 'POST',
    headers: { ...asAlice, 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: otherProject.id, kind: 'generic_task', payload: { prompt: 'From the tasks screen' } }),
  });
  assert.equal(projectTask.status, 201);
  assert.equal((await projectTask.json() as { task: { conversationId: string | null } }).task.conversationId, null);
});
