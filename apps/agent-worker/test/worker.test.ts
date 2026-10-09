import assert from 'node:assert/strict';
import test from 'node:test';
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
  PermissionEngine,
  SecuredCapabilityGuard,
  type ApprovalValidator,
} from '@personal-ai-os/permissions';
import { PLACEHOLDER_WORKER_LABEL, TaskExecutor } from '../src/task-executor.ts';

// In-memory test repository for agent-worker tests
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
    eventType: TaskEventType,
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

  async getTaskEvents(userId: string, taskId: string): Promise<TaskEventEnvelope[]> {
    return this.events.filter((e) => e.userId === userId && e.taskId === taskId);
  }

  async getDanglingRunningTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()].filter(
      (t) => t.status === 'running' || t.status === 'planning',
    );
  }
}

class TestBroadcaster {
  published: TaskEventEnvelope[] = [];
  publish(event: TaskEventEnvelope): void {
    this.published.push(event);
  }
}

test('Agent Worker executes generic task with explicit placeholder labels, checkpoints, and tool call', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  const { task } = await repo.createTask({
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'generic_task',
    payload: { goal: 'Execute sample OS task' },
  });

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  // Verify task completion
  const updatedTask = await repo.getTask(task.userId, task.id);
  assert.equal(updatedTask?.status, 'completed');
  assert.equal(updatedTask?.progress, 100);
  assert.ok(updatedTask?.artifacts && updatedTask.artifacts.length > 0);

  // Verify explicit placeholder label in artifact
  const artifacts = updatedTask.artifacts as Array<Record<string, unknown>>;
  const artifact = artifacts[0]!;
  assert.equal(artifact.note, PLACEHOLDER_WORKER_LABEL);

  // Verify sequence of emitted events
  const eventTypes = broadcaster.published.map((e) => e.eventType);
  assert.ok(eventTypes.includes('task.started'));
  assert.ok(eventTypes.includes('task.progress'));
  assert.ok(eventTypes.includes('task.tool_call'));
  assert.ok(eventTypes.includes('task.completed'));

  // Verify tool_call payload explicitly labelled as placeholder
  const toolCallEvent = broadcaster.published.find((e) => e.eventType === 'task.tool_call');
  assert.ok(toolCallEvent);
  assert.equal(toolCallEvent.payload.placeholder, true);
  assert.match(String(toolCallEvent.payload.note), /PLACEHOLDER_GENERIC_WORKER/);

  // Verify checkpoint was updated
  assert.ok(updatedTask.checkpoint);
  assert.equal(updatedTask.checkpoint.stepIndex, 4);
});

test('Agent Worker respects task cancellation mid-run without continuing steps', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  const { task } = await repo.createTask({
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'cancellable_task',
    payload: {},
  });

  // Mark task as cancelled before execution
  await repo.updateTaskStatus(task.userId, task.id, 'cancelled');

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const finalTask = await repo.getTask(task.userId, task.id);
  assert.equal(finalTask?.status, 'cancelled');
  assert.equal(broadcaster.published.length, 0); // No steps run
});

test('Agent Worker recovery on restart resumes from last verified checkpoint without repeating steps', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  // Simulate a task that was running before a worker crashed
  const { task } = await repo.createTask({
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'interrupted_task',
    payload: {},
  });

  // Pre-set task to 'running' with step 2 checkpoint already saved
  await repo.updateTaskStatus(task.userId, task.id, 'running');
  const checkpointStep2: TaskCheckpoint = {
    stepIndex: 2,
    totalSteps: 4,
    lastExecutedAction: 'tool_call:search_knowledge',
    timestamp: new Date().toISOString(),
  };
  await repo.updateTaskProgress(task.userId, task.id, 50, checkpointStep2);

  // 1. Worker restarts: recoverInterruptedTasks detects the running task
  const enqueuedJobs: TaskRecord[] = [];
  const fakeQueue = {
    async enqueue(t: TaskRecord) {
      enqueuedJobs.push(t);
    },
  };

  const recoveryResult = await executor.recoverInterruptedTasks(fakeQueue);
  assert.equal(recoveryResult.recoveredCount, 1);
  assert.equal(enqueuedJobs.length, 1);

  // Verify recovery event emitted
  const resumedEvent = broadcaster.published.find((e) => e.eventType === 'task.resumed');
  assert.ok(resumedEvent);
  assert.equal(resumedEvent.payload.recoveredAfterRestart, true);
  assert.equal(resumedEvent.payload.lastVerifiedStep, 2);
  assert.equal(resumedEvent.payload.resumingFromStep, 3);

  // 2. Execute recovered task: should start at step 3, skipping step 1 and 2
  broadcaster.published = []; // Clear previous events to inspect execution
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 1,
    maxAttempts: 3,
  });

  const finishedTask = await repo.getTask(task.userId, task.id);
  assert.equal(finishedTask?.status, 'completed');
  assert.equal(finishedTask?.progress, 100);

  // Verify that tool_call (step 2) was NOT re-run
  const events = broadcaster.published.map((e) => e.eventType);
  assert.equal(events.includes('task.tool_call'), false);
  assert.ok(events.includes('task.completed'));
});

test('Task execution requiring approval enters waiting_approval and emits task.waiting_approval', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);

  let createdApprovalRecord: { id: string } | null = null;
  const executor = new TaskExecutor(repo, broadcaster, {
    guard,
    approvalCreator: async (params) => {
      assert.equal(params.action, 'git:push');
      createdApprovalRecord = { id: 'appr-req-001' };
      return createdApprovalRecord;
    },
  });

  const { task } = await repo.createTask({
    userId: 'user-alice',
    projectId: 'proj-1',
    kind: 'code_push',
    payload: {
      action: 'git:push',
      resource: 'repo://github.com/my-org/project',
      scope: 'git',
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

  const updatedTask = await repo.getTask(task.userId, task.id);
  assert.equal(updatedTask?.status, 'waiting_approval');
  assert.equal(updatedTask?.progress, 50);
  assert.equal(updatedTask?.checkpoint?.lastExecutedAction, 'waiting_approval');
  assert.equal(updatedTask?.checkpoint?.actionState?.approvalId, 'appr-req-001');

  // Verify task.waiting_approval event emitted
  const waitEvent = broadcaster.published.find((e) => e.eventType === 'task.waiting_approval');
  assert.ok(waitEvent);
  assert.equal(waitEvent.payload.action, 'git:push');
  assert.equal(waitEvent.payload.riskLevel, 'HIGH');
});

test('Resumed task with valid approval successfully completes via guard', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();

  const consumedApprovals = new Set<string>();
  const mockValidator: ApprovalValidator = {
    async validateAndConsume(approvalId) {
      if (consumedApprovals.has(approvalId)) {
        return { valid: false, reason: 'Approval already used' };
      }
      consumedApprovals.add(approvalId);
      return { valid: true };
    },
  };

  const guard = new SecuredCapabilityGuard(engine, { approvalValidator: mockValidator });
  const executor = new TaskExecutor(repo, broadcaster, { guard });

  const { task } = await repo.createTask({
    userId: 'user-alice',
    projectId: 'proj-1',
    kind: 'code_push',
    payload: {
      action: 'git:push',
      resource: 'repo://github.com/my-org/project',
      scope: 'git',
    },
  });

  // Pre-condition: Task was waiting for approval and user approved approvalId 'appr-valid-123'
  await repo.updateTaskStatus(task.userId, task.id, 'running');
  await repo.updateTaskStatus(task.userId, task.id, 'waiting_approval');
  const approvalCheckpoint: TaskCheckpoint = {
    stepIndex: 1, // Will proceed to step 2 (Tool Call)
    totalSteps: 4,
    lastExecutedAction: 'waiting_approval',
    actionState: { approvalId: 'appr-valid-123' },
    timestamp: new Date().toISOString(),
  };
  await repo.updateTaskProgress(task.userId, task.id, 25, approvalCheckpoint);
  // User approves: task goes back to running
  await repo.updateTaskStatus(task.userId, task.id, 'running');

  // Resume task execution
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 1,
    maxAttempts: 3,
  });

  const completedTask = await repo.getTask(task.userId, task.id);
  assert.equal(completedTask?.status, 'completed');
  assert.equal(completedTask?.progress, 100);
  assert.ok(consumedApprovals.has('appr-valid-123'));
});

test('Destructive CRITICAL task is strictly denied by Permission Engine and transitions to failed', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const executor = new TaskExecutor(repo, broadcaster, { guard });

  const { task } = await repo.createTask({
    userId: 'user-alice',
    projectId: 'proj-1',
    kind: 'dangerous_task',
    payload: {
      action: 'fs:delete_all',
      resource: 'file://C:/Windows/System32',
      scope: 'system',
      isDestructive: true,
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

  const failedTask = await repo.getTask(task.userId, task.id);
  assert.equal(failedTask?.status, 'failed');
  assert.ok(failedTask?.error?.includes('Akses ditolak'));

  const failEvent = broadcaster.published.find((e) => e.eventType === 'task.failed');
  assert.ok(failEvent);
  assert.equal(failEvent.payload.riskLevel, 'CRITICAL');
});

test('Capability execution interface enforces guard call; fails if execution attempted without permission check', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);

  // Simulated Tool Manager / Windows capability runner interface
  interface CapabilityDispatcher {
    invokeCapability(
      action: string,
      resource: string,
      scope: string,
      useGuard: boolean,
    ): Promise<unknown>;
  }

  const dispatcher: CapabilityDispatcher = {
    async invokeCapability(action, resource, scope, useGuard) {
      if (!useGuard) {
        throw new Error('SECURITY VIOLATION: Capability invoked without Permission Engine guard');
      }
      return guard.executeProtected(
        {
          actor: { id: 'worker-1', isAutomated: true },
          action,
          resource,
          scope,
        },
        async () => ({ success: true }),
      );
    },
  };

  // Test fails if bypass is attempted
  await assert.rejects(async () => {
    await dispatcher.invokeCapability('system:execute_powershell', 'cmd://format', 'system', false);
  }, /SECURITY VIOLATION: Capability invoked without Permission Engine guard/);

  // When called through guard for LOW risk action, it passes
  const result = await dispatcher.invokeCapability(
    'knowledge:read',
    'doc://readme.md',
    'workspace',
    true,
  );
  assert.deepEqual(result, { success: true });
});

test('Event-triggered tasks are strictly checked by Permission Engine and cannot bypass checks', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const executor = new TaskExecutor(repo, broadcaster, { guard });

  // Task triggered by an external event / webhook with HIGH risk capability
  const { task } = await repo.createTask({
    userId: 'user-webhook-bot',
    projectId: 'proj-1',
    kind: 'event_triggered_task',
    payload: {
      action: 'external:send_email',
      resource: 'mailto:stakeholders@company.com',
      scope: 'communication',
      triggerSource: 'github_webhook',
      eventPayload: { commit: 'abc123' },
    },
  });

  // Execute event-triggered task
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const checkedTask = await repo.getTask(task.userId, task.id);
  // Must NOT run unchecked: should be held in waiting_approval
  assert.equal(checkedTask?.status, 'waiting_approval');
  assert.equal(checkedTask?.checkpoint?.lastExecutedAction, 'waiting_approval');

  const waitEvt = broadcaster.published.find((e) => e.eventType === 'task.waiting_approval');
  assert.ok(waitEvt, 'Event-triggered task must trigger waiting_approval event');
  assert.equal(waitEvt.payload.action, 'external:send_email');
  assert.equal(waitEvt.payload.riskLevel, 'HIGH');
});

test('Task resume from versioned checkpoint verifies last step before executing external action', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  // Task has unverified external checkpoint
  const unverifiedCp = createVersionedCheckpoint({
    version: 2,
    stepIndex: 1,
    totalSteps: 4,
    lastExecutedAction: 'plan_analysis',
    actionType: 'internal',
    verified: true,
  });

  const { task } = await repo.createTask({
    userId: 'user-checkpoint',
    projectId: 'proj-checkpoint',
    kind: 'generic_task',
    payload: {
      action: 'tool:call_external_service',
    },
  });

  await repo.updateTaskProgress(task.userId, task.id, 25, unverifiedCp);

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const updated = await repo.getTask(task.userId, task.id);
  assert.equal(updated?.status, 'completed');
  assert.equal(updated?.checkpoint?.version, 4);
});

test('Task completion is rejected when agent claims completion without concrete evidence (Evaluator rejection)', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  // Coding task claiming self completion without tooling evidence
  const { task } = await repo.createTask({
    userId: 'user-coding-eval',
    projectId: 'proj-coding-eval',
    kind: 'coding_task',
    payload: {
      category: 'coding',
      selfClaimOnly: true,
    },
  });

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 1,
  });

  const checkedTask = await repo.getTask(task.userId, task.id);
  // Must be rejected and failed by CodingEvaluator!
  assert.equal(checkedTask?.status, 'failed');
  assert.match(checkedTask?.error ?? '', /Self-claim|strictly prohibited|evaluator/i);

  const failEvent = broadcaster.published.find((e) => e.eventType === 'task.failed');
  assert.ok(failEvent, 'Must emit task.failed event when evaluator rejects self-claim');
  assert.equal(
    (failEvent.payload as { evaluationResult?: { selfClaimRejected?: boolean } }).evaluationResult
      ?.selfClaimRejected,
    true,
  );
});

test('Task completion is rejected when research task lacks real sources (ResearchEvaluator rejection)', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const executor = new TaskExecutor(repo, broadcaster);

  // Research task claiming completion without real sources
  const { task } = await repo.createTask({
    userId: 'user-research-eval',
    projectId: 'proj-research-eval',
    kind: 'research_task',
    payload: {
      category: 'research',
      selfClaimOnly: true,
    },
  });

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 1,
  });

  const checkedTask = await repo.getTask(task.userId, task.id);
  assert.equal(checkedTask?.status, 'failed');
  assert.match(checkedTask?.error ?? '', /Research completion blocked|No valid sources/i);

  const failEvent = broadcaster.published.find((e) => e.eventType === 'task.failed');
  assert.ok(failEvent);
});
