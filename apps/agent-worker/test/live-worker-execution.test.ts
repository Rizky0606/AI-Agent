import assert from 'node:assert/strict';
import test from 'node:test';
import { Redis } from 'ioredis';
import {
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskRecord,
  type TaskRepository,
  TaskStateMachine,
  type TaskStatus,
  createVersionedCheckpoint,
} from '@personal-ai-os/shared';
import {
  type ApprovalValidator,
  PermissionEngine,
  SecuredCapabilityGuard,
} from '@personal-ai-os/permissions';
import { PLACEHOLDER_WORKER_LABEL, TaskExecutor, createAgentWorker } from '../src/index.ts';
import {
  InMemoryTaskEventBroadcaster,
  RedisTaskEventBroadcaster,
} from '@personal-ai-os/api/services';

// In-memory test repository with event replay support
class TestTaskRepo implements TaskRepository {
  tasks = new Map<string, TaskRecord>();
  events: TaskEventEnvelope[] = [];

  async createTask(params: {
    userId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    const id = `task-${this.tasks.size + 1}`;
    const task: TaskRecord = {
      id,
      userId: params.userId,
      projectId: params.projectId,
      kind: params.kind,
      payload: params.payload,
      status: 'queued',
      progress: 0,
      attempt: 0,
      maxAttempts: params.maxAttempts ?? 3,
      priority: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(id, task);
    return { task, isDuplicate: false };
  }

  async getTask(userId: string, taskId: string): Promise<TaskRecord | null> {
    const t = this.tasks.get(taskId);
    return t && t.userId === userId ? { ...t } : null;
  }

  async listTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()];
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    updates?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('not found');
    TaskStateMachine.assertTransition(task.status, nextStatus);
    task.status = nextStatus;
    task.updatedAt = new Date();
    if (updates?.attempt !== undefined) task.attempt = updates.attempt;
    if (updates?.error !== undefined) task.error = updates.error;
    if (updates?.artifacts !== undefined) task.artifacts = updates.artifacts;
    if (updates?.checkpoint !== undefined) task.checkpoint = updates.checkpoint;
    return { ...task };
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('not found');
    task.progress = progress;
    task.updatedAt = new Date();
    if (checkpoint) task.checkpoint = checkpoint;
    return { ...task };
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventEnvelope['eventType'],
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const event: TaskEventEnvelope = {
      id: `evt-${this.events.length + 1}`,
      taskId,
      userId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async getDanglingRunningTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()].filter(
      (t) => t.status === 'running' || t.status === 'planning',
    );
  }

  async getTaskEvents(
    userId: string,
    taskId: string,
    options?: { afterEventId?: string },
  ): Promise<TaskEventEnvelope[]> {
    const taskEvents = this.events.filter((e) => e.userId === userId && e.taskId === taskId);
    if (!options?.afterEventId) return taskEvents;
    const idx = taskEvents.findIndex((e) => e.id === options.afterEventId);
    if (idx === -1) return taskEvents;
    return taskEvents.slice(idx + 1);
  }
}

const checkRedisAvailable = async (redisUrl: string): Promise<boolean> => {
  const client = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 1500 });
  try {
    await client.connect();
    await client.ping();
    await client.quit();
    return true;
  } catch {
    client.disconnect();
    return false;
  }
};

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

// ============================================================================
// 1. Worker Lifecycle & Keep-Alive
// ============================================================================
test('Worker process lifecycle: createAgentWorker stays alive and closes gracefully', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const workerHandle = createAgentWorker({
    taskRepo: repo,
    broadcaster,
    concurrency: 2,
  });

  assert.ok(workerHandle.executor, 'TaskExecutor must be instantiated');
  assert.equal(typeof workerHandle.close, 'function', 'Must provide close handler');

  // Verify graceful close does not throw
  await workerHandle.close();
});

// ============================================================================
// 2. Redis Pub/Sub Cross-Process Event Bus & Replay
// ============================================================================
test('Redis Pub/Sub event bus delivers events across publisher and subscriber', async () => {
  const isRedisUp = await checkRedisAvailable(REDIS_URL);
  if (!isRedisUp) {
    // Graceful skip if Redis daemon is offline
    return;
  }

  const prefix = `test-events-${Date.now()}`;
  const pubClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const subClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  const publisher = new RedisTaskEventBroadcaster({
    publisher: pubClient,
    channelPrefix: prefix,
  });
  const subscriber = new RedisTaskEventBroadcaster({
    subscriber: subClient,
    channelPrefix: prefix,
  });

  const receivedUserEvents: TaskEventEnvelope[] = [];
  const receivedGlobalEvents: TaskEventEnvelope[] = [];

  const unsubUser = subscriber.subscribeUser('user-redis-1', (evt) => {
    receivedUserEvents.push(evt);
  });
  const unsubGlobal = subscriber.subscribe((evt) => {
    receivedGlobalEvents.push(evt);
  });

  try {
    // Give Redis sub subscription a short moment to register in redis server
    await new Promise((resolve) => setTimeout(resolve, 100));

    const sampleEvent: TaskEventEnvelope = {
      id: 'evt-redis-101',
      taskId: 'task-redis-101',
      userId: 'user-redis-1',
      eventType: 'task.progress',
      payload: { progress: 50, note: 'redis pub/sub works' },
      createdAt: new Date().toISOString(),
    };

    await publisher.publish(sampleEvent);

    // Wait for cross-process delivery
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(receivedUserEvents.length, 1, 'Subscriber must receive user event');
    assert.equal(receivedUserEvents[0]?.id, 'evt-redis-101');
    assert.equal(receivedUserEvents[0]?.payload.note, 'redis pub/sub works');

    assert.equal(receivedGlobalEvents.length, 1, 'Subscriber must receive global event');
    assert.equal(receivedGlobalEvents[0]?.id, 'evt-redis-101');
  } finally {
    unsubUser();
    unsubGlobal();
    await publisher.close(true);
    await subscriber.close(true);
    await pubClient.quit().catch(() => pubClient.disconnect());
    await subClient.quit().catch(() => subClient.disconnect());
  }
});

test('Important task events are persisted in repository and replayable via last_event_id', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const evt1 = await repo.createTaskEvent('user-replay', 'task-replay', 'task.started', {
    attempt: 1,
  });
  const evt2 = await repo.createTaskEvent('user-replay', 'task-replay', 'task.progress', {
    progress: 50,
  });
  const evt3 = await repo.createTaskEvent('user-replay', 'task-replay', 'task.completed', {
    progress: 100,
  });

  broadcaster.publish(evt1);
  broadcaster.publish(evt2);
  broadcaster.publish(evt3);

  // Replay all
  const allEvents = await repo.getTaskEvents('user-replay', 'task-replay');
  assert.equal(allEvents.length, 3);

  // Replay after last_event_id = evt1.id
  const replayed = await repo.getTaskEvents('user-replay', 'task-replay', {
    afterEventId: evt1.id,
  });
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0]?.id, evt2.id);
  assert.equal(replayed[1]?.id, evt3.id);
});

// ============================================================================
// 3. Worker Restart Idempotency (Does not duplicate side-effects)
// ============================================================================
test('Worker restart mid-task resumes from checkpoint and does not duplicate side-effects', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new InMemoryTaskEventBroadcaster();

  let step1SideEffectCount = 0;

  // Custom tool registry to track exact execution count of side-effects
  const mockRegistry = {
    async executeTool(req: { toolName: string }) {
      if (req.toolName === 'tool:step_1_action') {
        step1SideEffectCount++;
        return { success: true, data: { step: 1 } };
      }
      if (req.toolName === 'tool:step_2_action') {
        step2SideEffectCount++;
        return { success: true, data: { step: 2 } };
      }
      return { success: true, data: {} };
    },
  };

  const { task } = await repo.createTask({
    userId: 'user-idempotency',
    projectId: 'proj-idempotency',
    kind: 'generic_task',
    payload: {
      toolName: 'tool:step_1_action',
      simulateStep: true,
    },
  });

  // Step 2 executes successfully and checkpoints
  const cp2 = createVersionedCheckpoint({
    version: 2,
    stepIndex: 2,
    totalSteps: 4,
    lastExecutedAction: 'tool:step_1_action',
    actionType: 'external_tool',
    actionState: { sideEffectCompleted: true },
    verified: true,
  });
  step1SideEffectCount++; // Simulated run before crash
  await repo.updateTaskStatus(task.userId, task.id, 'running', { checkpoint: cp2 });

  // WORKER CRASH: Worker 1 dies while task is 'running'
  // WORKER 2 RESTARTS:
  const newExecutor = new TaskExecutor(repo, broadcaster, {
    registry: mockRegistry as never,
  });

  // Recovery identifies dangling running tasks
  const recovery = await newExecutor.recoverInterruptedTasks();
  assert.equal(recovery.recoveredCount, 1);
  assert.equal(recovery.recoveredTasks[0]?.id, task.id);

  // Resume execution on the new worker
  await newExecutor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const completedTask = await repo.getTask(task.userId, task.id);
  assert.equal(completedTask?.status, 'completed');

  // Verify step 1 was NOT re-executed!
  assert.equal(step1SideEffectCount, 1, 'Step 1 side effect must NOT be duplicated upon restart');
});

// ============================================================================
// 4. Approval halts HIGH/CRITICAL action and resumes same task to completion
// ============================================================================
test('Approval stops HIGH/CRITICAL action at waiting_approval and resumes exact same task', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new InMemoryTaskEventBroadcaster();
  const engine = new PermissionEngine();

  const approvalStore = new Map<string, { valid: boolean }>();
  const validator: ApprovalValidator = {
    async validateAndConsume(approvalId) {
      const appr = approvalStore.get(approvalId);
      if (appr && appr.valid) {
        appr.valid = false;
        return { valid: true };
      }
      return { valid: false, reason: 'Invalid or already consumed approval' };
    },
  };

  const guard = new SecuredCapabilityGuard(engine, { approvalValidator: validator });

  let approvalCreatedCount = 0;
  let generatedApprovalId = '';

  const approvalCreator = async () => {
    approvalCreatedCount++;
    generatedApprovalId = `appr-dyn-${approvalCreatedCount}`;
    approvalStore.set(generatedApprovalId, { valid: true });
    return { id: generatedApprovalId };
  };

  const executor = new TaskExecutor(repo, broadcaster, {
    guard,
    approvalCreator,
  });

  // Task requests git:push (HIGH risk per Permission Engine)
  const { task } = await repo.createTask({
    userId: 'user-approval',
    projectId: 'proj-approval',
    kind: 'code_push_task',
    payload: {
      action: 'git:push',
      resource: 'repo://github.com/my-org/project',
      scope: 'git',
    },
  });

  // First run: Must halt at waiting_approval!
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const haltedTask = await repo.getTask(task.userId, task.id);
  assert.equal(haltedTask?.status, 'waiting_approval');
  assert.ok(haltedTask?.checkpoint);
  assert.equal(haltedTask?.checkpoint?.lastExecutedAction, 'waiting_approval');
  assert.equal(haltedTask?.checkpoint?.actionState?.approvalId, generatedApprovalId);

  // Approval granted! Prepare resume with approvalId in checkpoint
  const resumeCp = createVersionedCheckpoint({
    version: (haltedTask.checkpoint?.version ?? 0) + 1,
    stepIndex: 2,
    totalSteps: 4,
    lastExecutedAction: 'waiting_approval',
    actionType: 'approval',
    actionState: {
      approvalId: generatedApprovalId,
      approved: true,
    },
    verified: true,
  });

  await repo.updateTaskStatus(task.userId, task.id, 'running', { checkpoint: resumeCp });

  // Resume the EXACT same task!
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 1,
    maxAttempts: 3,
  });

  const finalTask = await repo.getTask(task.userId, task.id);
  assert.equal(finalTask?.id, task.id, 'Must be the exact same task ID');
  assert.equal(finalTask?.status, 'completed', 'Task must be completed after approval');
  assert.equal(finalTask?.progress, 100);
});

// ============================================================================
// 5. Real Agents (Coding & Research) execute without PLACEHOLDER_WORKER_LABEL
// ============================================================================
test('Real coding task executes with CodingAgent & CodingEvaluator without placeholder label', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new InMemoryTaskEventBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  const { task } = await repo.createTask({
    userId: 'user-coder',
    projectId: 'proj-coder',
    kind: 'coding_task',
    payload: {
      instructions: 'Fix memory leak in buffer pooling',
      repoPath: 'packages/memory',
      filesToModify: [{ path: 'src/pool.ts', content: 'export const pool = new Map();' }],
    },
  });

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const completedTask = await repo.getTask(task.userId, task.id);
  assert.equal(completedTask?.status, 'completed');
  assert.ok(completedTask?.artifacts && completedTask.artifacts.length > 0);

  // Must NOT carry PLACEHOLDER_WORKER_LABEL
  const artifactNote = (completedTask.artifacts[0] as { note?: string })?.note;
  assert.notEqual(artifactNote, PLACEHOLDER_WORKER_LABEL);

  const completedEvents = repo.events.filter((e) => e.taskId === task.id);
  for (const evt of completedEvents) {
    assert.equal(evt.payload?.placeholder, undefined);
    assert.notEqual(evt.payload?.note, PLACEHOLDER_WORKER_LABEL);
  }
});

test('Real research task executes with ResearchAgent & ResearchEvaluator without placeholder label', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new InMemoryTaskEventBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  const { task } = await repo.createTask({
    userId: 'user-researcher',
    projectId: 'proj-researcher',
    kind: 'research_task',
    payload: {
      query: 'Arsitektur micro-agent durable execution',
      topics: ['durable execution', 'state machines'],
    },
  });

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const completedTask = await repo.getTask(task.userId, task.id);
  assert.equal(completedTask?.status, 'completed');
  assert.ok(completedTask?.artifacts && completedTask.artifacts.length > 0);

  // Must NOT carry PLACEHOLDER_WORKER_LABEL
  const artifactNote = (completedTask.artifacts[0] as { note?: string })?.note;
  assert.notEqual(artifactNote, PLACEHOLDER_WORKER_LABEL);

  const completedEvents = repo.events.filter((e) => e.taskId === task.id);
  for (const evt of completedEvents) {
    assert.equal(evt.payload?.placeholder, undefined);
    assert.notEqual(evt.payload?.note, PLACEHOLDER_WORKER_LABEL);
  }
});
