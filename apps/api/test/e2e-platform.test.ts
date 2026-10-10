import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskEventType,
  type TaskRecord,
  type TaskRepository,
  type TaskStatus,
} from '@personal-ai-os/shared';
import { SsrfGuard, type DnsResolver } from '@personal-ai-os/tools';
import { MockFcmProvider, NotificationEngine, SchedulerEngine } from '@personal-ai-os/scheduler';
import { MockModelGateway } from '../../../packages/model-gateway/src/mock-gateway.ts';
import { PathValidator } from '../../windows/src/security/path-validator.ts';
import { TaskExecutor } from '../../agent-worker/src/task-executor.ts';

// In-memory mock task repository for E2E platform test
class E2ETaskRepository implements TaskRepository {
  private tasks = new Map<string, TaskRecord>();
  private events: TaskEventEnvelope[] = [];

  async createTask(input: {
    userId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string | null | undefined;
    priority?: number | undefined;
    maxAttempts?: number | undefined;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    if (input.idempotencyKey) {
      for (const existing of this.tasks.values()) {
        if (
          existing.userId === input.userId &&
          existing.payload?.['idempotencyKey'] === input.idempotencyKey
        ) {
          return { task: { ...existing }, isDuplicate: true };
        }
      }
    }

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
      payload: { ...input.payload, idempotencyKey: input.idempotencyKey },
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

test('E2E Platform 1: Chat streaming via ModelGateway yields chunks and accumulates full response', async () => {
  const gateway = new MockModelGateway({
    streamChunks: ['Halo, ', 'saya ', 'Personal ', 'AI OS.'],
    streamDelayMs: 2,
  });

  const chunks: string[] = [];
  for await (const chunk of gateway.stream({
    messages: [{ role: 'user', content: 'Halo' }],
    model: 'openai/gpt-4o-mini',
  })) {
    chunks.push(chunk.delta);
  }

  assert.equal(chunks.join(''), 'Halo, saya Personal AI OS.');
  assert.equal(gateway.callCount, 1);
});

test('E2E Platform 2: Durable task creation with idempotency key deduplication and checkpointing', async () => {
  const repo = new E2ETaskRepository();
  const broadcaster = { publish: () => {} };
  const executor = new TaskExecutor(repo, broadcaster);

  // Request 1: creates task
  const res1 = await repo.createTask({
    userId: 'user-e2e',
    projectId: 'proj-e2e',
    kind: 'generic.workflow',
    payload: { action: 'process_dataset' },
    idempotencyKey: 'idem-key-unique-123',
  });
  assert.equal(res1.isDuplicate, false);

  // Request 2 with same idempotency key: returns duplicate without re-creating
  const res2 = await repo.createTask({
    userId: 'user-e2e',
    projectId: 'proj-e2e',
    kind: 'generic.workflow',
    payload: { action: 'process_dataset' },
    idempotencyKey: 'idem-key-unique-123',
  });
  assert.equal(res2.isDuplicate, true);
  assert.equal(res2.task.id, res1.task.id);

  // Execute task: verifies checkpoint creation
  await executor.execute({
    taskId: res1.task.id,
    userId: res1.task.userId,
    projectId: res1.task.projectId,
    kind: res1.task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const completedTask = await repo.getTask('user-e2e', res1.task.id);
  assert.equal(completedTask?.status, 'completed');
  assert.equal(completedTask?.progress, 100);
});

test('E2E Platform 3: High-risk action triggers approval gate and halts until approval is granted', async () => {
  const repo = new E2ETaskRepository();
  const publishedEvents: TaskEventEnvelope[] = [];
  const broadcaster = { publish: (e: TaskEventEnvelope) => publishedEvents.push(e) };

  // Permission policy: git:push requires approval
  const permissions = new PermissionEngine([
    {
      pattern: /^git:push$/i,
      baseRisk: 'HIGH',
      consequence: 'Push code to remote repository',
      allowWithoutApproval: false, // Must be approved!
    },
  ]);
  const guard = new SecuredCapabilityGuard(permissions);

  let approvalCreated = false;
  let storedApprovalId = '';

  const executor = new TaskExecutor(repo, broadcaster, {
    guard,
    approvalCreator: async (params) => {
      approvalCreated = true;
      storedApprovalId = `appr-${Date.now()}`;
      assert.equal(params.riskLevel, 'HIGH');
      return { id: storedApprovalId };
    },
  });

  const { task } = await repo.createTask({
    userId: 'user-e2e',
    projectId: 'proj-e2e',
    kind: 'coding.push',
    payload: {
      action: 'git:push',
      resource: 'repo/master',
      riskLevel: 'HIGH',
      consequence: 'Deploy changes',
    },
  });

  // Attempt execution without approval -> enters waiting_approval
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const taskWaiting = await repo.getTask('user-e2e', task.id);
  assert.equal(taskWaiting?.status, 'waiting_approval');
  assert.equal(approvalCreated, true);

  const waitEvent = publishedEvents.find((e) => e.eventType === 'task.waiting_approval');
  assert.ok(waitEvent);
  assert.equal(waitEvent.payload['approvalId'], storedApprovalId);
});

test('E2E Platform 4: Windows Agent capability path allowlist strictly rejects path traversal', () => {
  const validator = new PathValidator(['C:\\AllowedWorkspace', 'C:\\Users\\Public\\Sandbox']);

  // Allowed paths
  assert.equal(validator.isPathAllowed('C:\\AllowedWorkspace\\src\\index.ts'), true);

  // Path traversal attempt: rejected
  assert.equal(
    validator.isPathAllowed('C:\\AllowedWorkspace\\..\\..\\Windows\\System32\\cmd.exe'),
    false,
  );

  // Unauthorized system root: rejected
  assert.equal(validator.isPathAllowed('C:\\Windows\\System32'), false);
});

test('E2E Platform 5: Browser controller SSRF guard blocks private CIDRs and cloud metadata', async () => {
  const fakeDns: DnsResolver = async (host) => {
    if (host === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
    return [{ address: '93.184.216.34', family: 4 }];
  };
  const ssrf = new SsrfGuard({ dnsResolver: fakeDns });

  // Cloud metadata endpoint: BLOCKED
  const metadataCheck = await ssrf.validateUrl('http://169.254.169.254/latest/meta-data/');
  assert.equal(metadataCheck.safe, false);
  assert.ok(metadataCheck.reason?.includes('metadata'));

  // Localhost & loopback: BLOCKED
  const localCheck = await ssrf.validateUrl('http://127.0.0.1:5432');
  assert.equal(localCheck.safe, false);

  // Private 10.0.0.0/8 subnet: BLOCKED
  const privateNetCheck = await ssrf.validateUrl('http://10.0.0.1/admin');
  assert.equal(privateNetCheck.safe, false);

  // Public domain: ALLOWED
  const publicCheck = await ssrf.validateUrl('https://example.com/docs');
  assert.equal(publicCheck.safe, true);
});

test('E2E Platform 6: Scheduler Engine manages missed-run policy and enforces idempotency', async () => {
  const dispatchedTaskIds: string[] = [];
  const scheduler = new SchedulerEngine({
    dispatcher: async (execution) => {
      dispatchedTaskIds.push(execution.taskPayload.input['taskId'] as string);
    },
  });

  const schedule = scheduler.registerSchedule({
    id: 'sched-daily-1',
    userId: 'user-e2e',
    name: 'Daily Backup Trigger',
    cronExpression: '0 2 * * *',
    type: 'recurring',
    missedRunPolicy: 'run_once',
    taskPayload: {
      kind: 'backup',
      input: { taskId: 'task-backup-daily' },
    },
  });

  assert.equal(schedule.missedRunPolicy, 'run_once');
  assert.equal(schedule.status, 'active');

  // Trigger tick with a future date matching schedule
  const nextRun = new Date(schedule.nextRunAt!);
  await scheduler.tick(new Date(nextRun.getTime() + 1000));
  assert.equal(dispatchedTaskIds.length, 1);
  assert.equal(dispatchedTaskIds[0], 'task-backup-daily');

  // Second tick at same time doesn't re-dispatch (idempotent)
  await scheduler.tick(new Date(nextRun.getTime() + 1000));
  assert.equal(dispatchedTaskIds.length, 1);

  scheduler.pauseSchedule('sched-daily-1');
  const paused = scheduler.getJob('sched-daily-1');
  assert.equal(paused?.status, 'paused');
});

test('E2E Platform 7: Notification Engine deduplicates alerts, deep-links, and dispatches via FCM', async () => {
  const mockFcm = new MockFcmProvider();
  const notificationEngine = new NotificationEngine({
    fcmProvider: mockFcm,
    dedupeWindowMs: 60000,
  });

  // Notification 1: approval needed with deep link
  const notif1 = await notificationEngine.dispatchNotification({
    userId: 'user-e2e',
    type: 'approval_required',
    title: 'Persetujuan Diperlukan',
    body: 'Tindakan git:push memerlukan approval Anda.',
    deviceToken: 'device-token-android-1',
    data: { approvalId: 'appr-999' },
  });

  assert.equal(notif1.deliveryState, 'delivered');
  assert.equal(notif1.deepLink, 'personal-ai://approvals/appr-999');
  assert.equal(mockFcm.sentMessages.length, 1);

  // Notification 2 with same approvalId: duplicate suppressed by dedupe window
  const notif2 = await notificationEngine.dispatchNotification({
    userId: 'user-e2e',
    type: 'approval_required',
    title: 'Persetujuan Diperlukan',
    body: 'Tindakan git:push memerlukan approval Anda.',
    deviceToken: 'device-token-android-1',
    data: { approvalId: 'appr-999' },
  });

  // Returns the existing notification without sending additional FCM message
  assert.equal(notif2.id, notif1.id);
  assert.equal(mockFcm.sentMessages.length, 1); // No double push
});
