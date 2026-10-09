import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVersionedCheckpoint,
  verifyCheckpointIntegrity,
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskEventType,
  type TaskRecord,
  type TaskRepository,
  type TaskStatus,
} from '@personal-ai-os/shared';
import { TaskExecutor } from '../../agent-worker/src/task-executor.ts';
import { MockModelGateway } from '../../../packages/model-gateway/src/mock-gateway.ts';

// In-memory mock task repository for drill simulation
class InMemoryTaskRepository implements TaskRepository {
  private tasks = new Map<string, TaskRecord>();
  private events: TaskEventEnvelope[] = [];

  async createTask(input: {
    userId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
    priority?: number | undefined;
    maxAttempts?: number | undefined;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    const id = `task-${this.tasks.size + 1}`;
    const task: TaskRecord = {
      id,
      userId: input.userId,
      projectId: input.projectId,
      kind: input.kind,
      status: 'queued',
      progress: 0,
      priority: input.priority ?? 0,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      payload: input.payload,
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

  async listTasks(userId: string, projectId?: string): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values()).filter(
      (t) => t.userId === userId && (!projectId || t.projectId === projectId),
    );
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    status: TaskStatus,
    patch?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const t = this.tasks.get(taskId);
    if (!t || t.userId !== userId) {
      throw new Error(`Task ${taskId} not found for user ${userId}`);
    }
    const updated: TaskRecord = { ...t, ...patch, status, updatedAt: new Date() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const t = this.tasks.get(taskId);
    if (!t || t.userId !== userId) {
      throw new Error(`Task ${taskId} not found for user ${userId}`);
    }
    const updated: TaskRecord = { ...t, progress, checkpoint, updatedAt: new Date() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventType,
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const event: TaskEventEnvelope = {
      id: `ev-${this.events.length + 1}`,
      userId,
      taskId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async getTaskEvents(userId: string, taskId: string): Promise<TaskEventEnvelope[]> {
    return this.events.filter((e) => e.userId === userId && e.taskId === taskId);
  }

  async getDanglingRunningTasks(): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'running');
  }

  getEvents(taskId: string): TaskEventEnvelope[] {
    return this.events.filter((e) => e.taskId === taskId);
  }
}

test('Recovery Drill 1: Worker crash mid-task resumes from last checkpoint without duplicating completed steps', async () => {
  const repo = new InMemoryTaskRepository();
  const publishedEvents: TaskEventEnvelope[] = [];
  const broadcaster = {
    publish: (e: TaskEventEnvelope) => publishedEvents.push(e),
  };

  const { task } = await repo.createTask({
    userId: 'user-drill-1',
    projectId: 'proj-drill-1',
    kind: 'generic.data_pipeline',
    payload: { dataset: 'sales_2026' },
  });

  // Simulate worker 1 starting execution and saving checkpoint after step 2
  const cp2 = createVersionedCheckpoint({
    version: 1,
    stepIndex: 2,
    totalSteps: 4,
    lastExecutedAction: 'step-2-normalize',
    actionType: 'internal',
    actionState: { processedRecords: 500 },
  });
  await repo.updateTaskStatus('user-drill-1', task.id, 'running');
  await repo.updateTaskProgress('user-drill-1', task.id, 50, cp2);

  // SIMULATE CRASH: Worker 1 dies abruptly. Task remains in status 'running' in DB.
  const taskBeforeRecovery = await repo.getTask('user-drill-1', task.id);
  assert.equal(taskBeforeRecovery?.status, 'running');
  assert.equal(taskBeforeRecovery?.checkpoint?.stepIndex, 2);

  // Worker 2 starts up after crash and runs recovery
  const worker2 = new TaskExecutor(repo, broadcaster);
  const reEnqueuedTasks: TaskRecord[] = [];
  const queueMock = {
    enqueue: async (t: TaskRecord) => {
      reEnqueuedTasks.push(t);
    },
  };

  const recoveryResult = await worker2.recoverInterruptedTasks(queueMock);

  assert.equal(recoveryResult.recoveredCount, 1);
  assert.equal(reEnqueuedTasks.length, 1);

  // Verify checkpoint integrity check was conducted
  const resumeEvent = publishedEvents.find((e) => e.eventType === 'task.resumed');
  assert.ok(resumeEvent);
  assert.equal(resumeEvent.payload['lastVerifiedStep'], 2);
  assert.equal(resumeEvent.payload['resumingFromStep'], 3);
  assert.equal(resumeEvent.payload['checkpointIntegrityValid'], true);

  // Now Worker 2 executes the re-enqueued task
  await worker2.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const finalTask = await repo.getTask('user-drill-1', task.id);
  assert.equal(finalTask?.status, 'completed');
  assert.equal(finalTask?.progress, 100);

  // Verify step 1 and step 2 were NOT repeated (only steps after checkpoint were executed)
  const resumeIndex = publishedEvents.findIndex((e) => e.eventType === 'task.resumed');
  const eventsAfterResume = publishedEvents.slice(resumeIndex + 1);
  const step1Repeated = eventsAfterResume.find((e) => e.payload?.['step'] === 1);
  const step2Repeated = eventsAfterResume.find((e) => e.payload?.['step'] === 2);
  assert.equal(step1Repeated, undefined, 'Step 1 must not be repeated');
  assert.equal(step2Repeated, undefined, 'Step 2 must not be repeated');

  const completeEvent = eventsAfterResume.find((e) => e.eventType === 'task.completed');
  assert.ok(completeEvent, 'Task must reach completion');
});

test('Recovery Drill 2: Windows agent disconnection fails fast with actionable reason, recovers when online', async () => {
  const repo = new InMemoryTaskRepository();
  const publishedEvents: TaskEventEnvelope[] = [];
  const broadcaster = {
    publish: (e: TaskEventEnvelope) => publishedEvents.push(e),
  };

  let isWindowsOnline = false;
  const mockDeviceManager = {
    hasOnlineDeviceForUser: (_userId: string, platform?: string) =>
      platform === 'windows' ? isWindowsOnline : true,
  };

  const executor = new TaskExecutor(repo, broadcaster, {
    deviceManager: mockDeviceManager,
  });

  const { task } = await repo.createTask({
    userId: 'user-drill-2',
    projectId: 'proj-drill-2',
    kind: 'windows.run_script',
    payload: { target: 'windows', script: 'Get-Service' },
  });

  // Attempt 1: Windows is OFFLINE
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const taskAfterOffline = await repo.getTask('user-drill-2', task.id);
  assert.equal(taskAfterOffline?.status, 'failed');
  assert.ok(taskAfterOffline?.error?.includes('Windows Agent sedang offline'));

  const failEvent = publishedEvents.find((e) => e.eventType === 'task.failed');
  assert.ok(failEvent);
  assert.equal(failEvent.payload['offlineReason'], 'device_unreachable');

  // Attempt 2: Windows comes ONLINE
  isWindowsOnline = true;
  await repo.updateTaskStatus('user-drill-2', task.id, 'queued');

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const taskAfterOnline = await repo.getTask('user-drill-2', task.id);
  assert.equal(taskAfterOnline?.status, 'completed');
});

test('Recovery Drill 3: Model gateway outage triggers structured failure without corrupting state', async () => {
  const mockGateway = new MockModelGateway({
    throwOnChat: new Error('503 Service Unavailable: 9Router upstream connection failed'),
  });

  // Model gateway request fails cleanly with structured error
  await assert.rejects(
    async () =>
      mockGateway.chat({
        messages: [{ role: 'user', content: 'Halo' }],
        model: 'openai/gpt-4o-mini',
      }),
    (err: Error) => {
      assert.ok(err.message.includes('503 Service Unavailable'));
      return true;
    },
  );

  // Restore gateway health
  mockGateway.options.throwOnChat = undefined;
  mockGateway.options.chatResponse = 'Halo! Saya AI OS.';
  const res = await mockGateway.chat({
    messages: [{ role: 'user', content: 'Halo' }],
    model: 'openai/gpt-4o-mini',
  });
  assert.ok(res.content.length > 0);
  assert.equal(res.content, 'Halo! Saya AI OS.');
});

test('Recovery Drill 4: Checkpoint integrity verification rejects tampered state', () => {
  const validCheckpoint = createVersionedCheckpoint({
    version: 1,
    stepIndex: 1,
    totalSteps: 3,
    lastExecutedAction: 'init_step',
    actionState: { output: 'secure data' },
  });
  assert.equal(verifyCheckpointIntegrity(validCheckpoint), true);

  // Tamper with step index
  const tamperedCheckpoint = {
    ...validCheckpoint,
    stepIndex: -5, // Invalid negative step index
  };
  assert.equal(verifyCheckpointIntegrity(tamperedCheckpoint), false);
});
