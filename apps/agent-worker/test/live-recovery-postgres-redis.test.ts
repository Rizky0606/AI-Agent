import assert from 'node:assert/strict';
import test from 'node:test';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import {
  createVersionedCheckpoint,
  type TaskCheckpoint,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import {
  createDatabase,
  SqlTaskRepository,
  projects,
  users,
} from '@personal-ai-os/api/db';
import {
  BullMqTaskQueue,
  RedisTaskEventBroadcaster,
} from '@personal-ai-os/api/services';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { ToolRegistry, type ToolDefinition } from '@personal-ai-os/tools';
import { createAgentWorker, TaskExecutor } from '../src/index.ts';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://personal_ai_os:personal_ai_secret@127.0.0.1:5432/personal_ai_os';

test('Postgres + Redis Live Recovery Drill: Task running -> Worker crash -> Restart -> Checkpoint resume exactly once', async () => {
  const { client: sqlClient, db } = createDatabase(DATABASE_URL);
  const taskRepo = new SqlTaskRepository(db);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queueName = `recovery-drill-${Date.now()}`;
  const broadcaster = new RedisTaskEventBroadcaster({ redisUrl: REDIS_URL });

  // 1. Create a clean user and project in real Postgres
  const testEmail = `recovery-${Date.now()}@test.local`;
  const [user] = await db
    .insert(users)
    .values({ email: testEmail })
    .returning();
  assert.ok(user, 'User must be created in Postgres');

  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name: 'Recovery Drill Project' })
    .returning();
  assert.ok(project, 'Project must be created in Postgres');

  let toolExecutionCount = 0;
  const probeTool: ToolDefinition<{ value: string }, { echoed: string }> = {
    name: 'probe_action',
    description: 'Probe tool to track execution idempotency',
    capability: 'tool:test',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:read',
    timeoutMs: 2000,
    supportsCancellation: true,
    outputLimitBytes: 4096,
    inputValidator: (input) => {
      if (typeof input !== 'object' || input === null || !('value' in input)) {
        return { valid: false, error: 'value required' };
      }
      return { valid: true, data: { value: String((input as Record<string, unknown>)['value']) } };
    },
    healthCheck: async () => ({ status: 'healthy', latencyMs: 0, timestamp: new Date().toISOString() }),
    execute: async (input) => {
      toolExecutionCount++;
      return { echoed: input.value };
    },
  };

  const registry = new ToolRegistry(new SecuredCapabilityGuard(new PermissionEngine()));
  registry.registerTool(probeTool);

  // 2. Start Worker 1
  const worker1 = createAgentWorker({
    redisUrl: REDIS_URL,
    queueName,
    concurrency: 1,
    taskRepo,
    broadcaster,
    executorOptions: { registry },
  });

  try {
    // 3. Create task in Postgres
    const { task } = await taskRepo.createTask({
      userId: user.id,
      projectId: project.id,
      kind: 'generic_task',
      payload: {
        toolName: 'probe_action',
        toolInput: { value: 'checkpoint_payload' },
      },
    });

    // 4. Simulate task running and creating a verified checkpoint before crash
    const checkpointStep1 = createVersionedCheckpoint({
      version: 1,
      stepIndex: 1,
      totalSteps: 2,
      lastExecutedAction: 'prepare_execution',
      actionType: 'internal',
      verified: true,
    });

    // Valid state transitions: queued -> planning -> running
    await taskRepo.updateTaskStatus(user.id, task.id, 'planning');
    await taskRepo.updateTaskStatus(user.id, task.id, 'running');
    await taskRepo.updateTaskProgress(user.id, task.id, 50, checkpointStep1);

    // 5. Worker 1 "crashes": worker1 closed immediately and any existing job removed
    await worker1.close();
    const tempQueue = new BullMqTaskQueue(redis, { queueName });
    await tempQueue.cancel(task.id);
    await tempQueue.close();

    // Verify task is dangling in Postgres
    const dangling = await taskRepo.getDanglingRunningTasks();
    const foundDangling = dangling.some((t) => t.id === task.id && t.status === 'running');
    assert.ok(foundDangling, 'Task must be dangling as running in real Postgres');

    // 6. Worker 2 boots up and runs recovery
    const worker2 = createAgentWorker({
      redisUrl: REDIS_URL,
      queueName,
      concurrency: 1,
      taskRepo,
      broadcaster,
      executorOptions: { registry },
    });

    const completionPromise = Promise.withResolvers<void>();
    const eventsReceived: TaskEventEnvelope[] = [];

    const unsubscribe = broadcaster.subscribe((event) => {
      if (event.taskId === task.id) {
        eventsReceived.push(event);
        if (event.eventType === 'task.completed') {
          completionPromise.resolve();
        }
      }
    });

    assert.ok(worker2.queue, 'Worker 2 must have active BullMQ queue');
    const recoveryResult = await worker2.executor.recoverInterruptedTasks(worker2.queue);
    assert.ok(recoveryResult.recoveredCount >= 1, 'Worker 2 must recover the dangling task');
    assert.ok(
      recoveryResult.recoveredTasks.some((t) => t.id === task.id),
      'Recovered tasks must contain our task',
    );

    // Wait for resumed execution to finish
    await Promise.race([
      completionPromise.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for recovered task completion')), 10000)),
    ]);

    unsubscribe();
    await worker2.close();

    // 7. Verify exactly-once execution and final status in real Postgres
    const finalTask = await taskRepo.getTask(user.id, task.id);
    assert.ok(finalTask);
    assert.equal(finalTask.status, 'completed', 'Task must be completed in Postgres');
    assert.equal(finalTask.progress, 100, 'Task progress must reach 100%');
    assert.equal(toolExecutionCount, 1, 'Probe tool must execute exactly once without duplication');

    // 8. Verify events recorded in Postgres
    const dbEvents = await taskRepo.getTaskEvents(user.id, task.id);
    const resumedEvent = dbEvents.find((e) => e.eventType === 'task.resumed');
    assert.ok(resumedEvent, 'task.resumed event must be persisted in Postgres');
    assert.equal(resumedEvent.payload['recoveredAfterRestart'], true);
    assert.equal(resumedEvent.payload['checkpointVersion'], 1);

    const completedEvent = dbEvents.find((e) => e.eventType === 'task.completed');
    assert.ok(completedEvent, 'task.completed event must be persisted in Postgres');
  } finally {
    // Cleanup DB records
    await db.delete(users).where(eq(users.id, user.id));
    await broadcaster.close(true);
    await redis.quit();
    await sqlClient.end();
  }
});

test('Postgres Live Recovery Drill: Bounded retries abort crash-looping tasks', async () => {
  const { client: sqlClient, db } = createDatabase(DATABASE_URL);
  const taskRepo = new SqlTaskRepository(db);
  const broadcaster = new RedisTaskEventBroadcaster({ redisUrl: REDIS_URL });

  const testEmail = `recovery-retry-${Date.now()}@test.local`;
  const [user] = await db
    .insert(users)
    .values({ email: testEmail })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name: 'Bounded Retry Project' })
    .returning();

  try {
    const { task } = await taskRepo.createTask({
      userId: user.id,
      projectId: project.id,
      kind: 'exhausted_task',
      payload: { test: true },
      maxAttempts: 3,
    });

    // Valid state transitions: queued -> planning -> running
    await taskRepo.updateTaskStatus(user.id, task.id, 'planning');
    await taskRepo.updateTaskStatus(user.id, task.id, 'running', {
      attempt: 3,
    });

    const enqueuedTasks: unknown[] = [];
    const mockQueue = {
      async enqueue(t: unknown) {
        enqueuedTasks.push(t);
      },
    };

    const executor = new TaskExecutor(taskRepo, broadcaster);
    await executor.recoverInterruptedTasks(mockQueue as never);

    // The exhausted task must NOT be re-enqueued
    assert.equal(enqueuedTasks.length, 0, 'Exhausted task must not be enqueued');

    const updatedTask = await taskRepo.getTask(user.id, task.id);
    assert.ok(updatedTask);
    assert.equal(updatedTask.status, 'failed', 'Exhausted task must be marked failed');
    assert.match(
      String(updatedTask.error),
      /Batas percobaan ulang maksimal tercapai saat pemulihan tugas/,
    );

    const events = await taskRepo.getTaskEvents(user.id, task.id);
    const failEvent = events.find((e) => e.eventType === 'task.failed');
    assert.ok(failEvent, 'task.failed event must be written');
    assert.equal(failEvent.payload['recoveryExhausted'], true);
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
    await broadcaster.close(true);
    await sqlClient.end();
  }
});

test('Postgres Live Recovery Drill: Corrupted checkpoint fails task safely without resuming', async () => {
  const { client: sqlClient, db } = createDatabase(DATABASE_URL);
  const taskRepo = new SqlTaskRepository(db);
  const broadcaster = new RedisTaskEventBroadcaster({ redisUrl: REDIS_URL });

  const testEmail = `recovery-tampered-${Date.now()}@test.local`;
  const [user] = await db
    .insert(users)
    .values({ email: testEmail })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name: 'Tampered Checkpoint Project' })
    .returning();

  try {
    const { task } = await taskRepo.createTask({
      userId: user.id,
      projectId: project.id,
      kind: 'corrupt_task',
      payload: { test: true },
    });

    // Checkpoint with tampered checksum
    const tamperedCheckpoint: TaskCheckpoint = {
      version: 1,
      stepIndex: 2,
      totalSteps: 4,
      lastExecutedAction: 'prepare',
      checksum: 'bogus_tampered_checksum_99999',
      verified: true,
    };

    // Valid state transitions: queued -> planning -> running
    await taskRepo.updateTaskStatus(user.id, task.id, 'planning');
    await taskRepo.updateTaskStatus(user.id, task.id, 'running');
    await taskRepo.updateTaskProgress(user.id, task.id, 50, tamperedCheckpoint);

    const enqueuedTasks: unknown[] = [];
    const mockQueue = {
      async enqueue(t: unknown) {
        enqueuedTasks.push(t);
      },
    };

    const executor = new TaskExecutor(taskRepo, broadcaster);
    await executor.recoverInterruptedTasks(mockQueue as never);

    assert.equal(enqueuedTasks.length, 0, 'Tampered task must not be enqueued');

    const updatedTask = await taskRepo.getTask(user.id, task.id);
    assert.ok(updatedTask);
    assert.equal(updatedTask.status, 'failed', 'Tampered task must be failed');
    assert.match(String(updatedTask.error), /Integritas checkpoint tidak valid/);

    const events = await taskRepo.getTaskEvents(user.id, task.id);
    const failEvent = events.find((e) => e.eventType === 'task.failed');
    assert.ok(failEvent);
    assert.equal(failEvent.payload['checkpointIntegrityValid'], false);
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
    await broadcaster.close(true);
    await sqlClient.end();
  }
});

test('Postgres Live Recovery Drill: PostgreSQL advisory lock prevents concurrent recovery race', async () => {
  const { client: sqlClient, db } = createDatabase(DATABASE_URL);
  const taskRepo = new SqlTaskRepository(db);

  const testEmail = `recovery-advisory-${Date.now()}@test.local`;
  const [user] = await db
    .insert(users)
    .values({ email: testEmail })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name: 'Advisory Lock Project' })
    .returning();

  try {
    const { task } = await taskRepo.createTask({
      userId: user.id,
      projectId: project.id,
      kind: 'lock_race_task',
      payload: {},
    });

    // Worker A claims recovery lock
    const claimedA = await taskRepo.claimTaskForRecovery(task.id);
    assert.equal(claimedA, true, 'Worker A must successfully claim recovery lock');

    // Worker B attempts to claim the same task concurrently
    const claimedB = await taskRepo.claimTaskForRecovery(task.id);
    assert.equal(claimedB, false, 'Worker B must be rejected while lease/lock is active');

    // Worker A releases lock
    await taskRepo.releaseTaskRecovery(task.id);

    // After release, Worker B can claim
    const claimedBAfterRelease = await taskRepo.claimTaskForRecovery(task.id);
    assert.equal(claimedBAfterRelease, true, 'Worker B can claim once released');

    await taskRepo.releaseTaskRecovery(task.id);
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
    await sqlClient.end();
  }
});
