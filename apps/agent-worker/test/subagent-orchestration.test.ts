import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskEventType,
  type TaskRecord,
  type TaskRepository,
  TaskStateMachine,
  type TaskStatus,
} from '@personal-ai-os/shared';
import {
  SubagentOrchestrator,
  type ParentTaskPayload,
  type SubagentPlanItem,
  type TaskQueueEnqueuerLike,
} from '@personal-ai-os/agent-core';
import { TaskExecutor } from '../src/task-executor.ts';
import { InMemoryTaskQueue } from '@personal-ai-os/api/services';

// In-memory test repository supporting parentTaskId and listChildTasks
class SubagentTestTaskRepo implements TaskRepository {
  tasks = new Map<string, TaskRecord>();
  events: TaskEventEnvelope[] = [];

  async createTask(params: {
    userId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
    parentTaskId?: string | null | undefined;
    idempotencyKey?: string | null | undefined;
    maxAttempts?: number | undefined;
    priority?: number | undefined;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    if (params.idempotencyKey) {
      const existing = [...this.tasks.values()].find(
        (t) => t.userId === params.userId && t.idempotencyKey === params.idempotencyKey,
      );
      if (existing) {
        return { task: { ...existing }, isDuplicate: true };
      }
    }

    const id = `task-${this.tasks.size + 1}`;
    const now = new Date();
    const task: TaskRecord = {
      id,
      userId: params.userId,
      projectId: params.projectId,
      kind: params.kind,
      payload: params.payload,
      parentTaskId: params.parentTaskId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      status: 'queued',
      progress: 0,
      attempt: 0,
      maxAttempts: params.maxAttempts ?? 3,
      priority: params.priority ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return { task: { ...task }, isDuplicate: false };
  }

  async getTask(userId: string, taskId: string): Promise<TaskRecord | null> {
    const t = this.tasks.get(taskId);
    return t && t.userId === userId ? { ...t } : null;
  }

  async listTasks(
    userId: string,
    filter?: {
      projectId?: string | undefined;
      conversationId?: string | undefined;
      parentTaskId?: string | undefined;
    },
  ): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter(
        (t) =>
          t.userId === userId &&
          (!filter?.projectId || t.projectId === filter.projectId) &&
          (!filter?.parentTaskId || t.parentTaskId === filter.parentTaskId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((t) => ({ ...t }));
  }

  async listChildTasks(userId: string, parentTaskId: string): Promise<TaskRecord[]> {
    return this.listTasks(userId, { parentTaskId });
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    updates?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    TaskStateMachine.assertTransition(task.status, nextStatus);
    task.status = nextStatus;
    task.updatedAt = new Date();
    if (updates?.error !== undefined) task.error = updates.error;
    if (updates?.artifacts !== undefined) task.artifacts = updates.artifacts;
    if (updates?.checkpoint !== undefined) task.checkpoint = updates.checkpoint;
    if (updates?.progress !== undefined) task.progress = updates.progress;
    return { ...task };
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.progress = progress;
    task.updatedAt = new Date();
    if (checkpoint) task.checkpoint = checkpoint;
    return { ...task };
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const event: TaskEventEnvelope = {
      id: `evt-${this.events.length + 1}`,
      taskId,
      userId,
      eventType: eventType as TaskEventType,
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
      (t) => t.status === 'running' || t.status === 'planning' || t.status === 'queued',
    );
  }
}

class TestBroadcaster {
  publishedEvents: TaskEventEnvelope[] = [];
  publish(event: TaskEventEnvelope): void {
    this.publishedEvents.push(event);
  }
}

test('Durable subagent orchestration: parent creates durable child tasks with isolation and least privilege', async () => {
  const repo = new SubagentTestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const orchestrator = new SubagentOrchestrator({
    taskRepo: repo,
    broadcaster,
    codingWorkspaceRoot: 'data/workspaces',
  });

  const parentTask: TaskRecord = {
    id: 'parent-task-1',
    userId: 'user-123',
    projectId: 'proj-456',
    kind: 'orchestrated_task',
    payload: {
      objective: 'Build authentication feature',
      secrets: { DATABASE_PASSWORD: 'super_secret_value' },
      userProfile: { personalEmail: 'user@secret.com' },
    },
    status: 'running',
    progress: 0,
    attempt: 1,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const payload: ParentTaskPayload = {
    objective: 'Build authentication feature',
    successCriteria: ['Token validator implemented', 'Unit tests passing'],
    childPlan: [
      {
        id: 'child-coding',
        name: 'Implement Token Validator',
        goal: 'Write JWT verification function',
        kind: 'coding',
        capabilityAllowlist: ['filesystem:read', 'filesystem:write'],
        required: true,
      },
      {
        id: 'child-research',
        name: 'Investigate Argon2 vs bcrypt',
        goal: 'Benchmark hashing algorithms',
        kind: 'research',
        capabilityAllowlist: ['web:search', 'web:fetch'],
        required: false,
      },
    ],
  };

  const children = await orchestrator.prepareChildTasks(parentTask, payload);

  assert.equal(children.length, 2);

  // 1. Verify parentTaskId is set on child tasks
  assert.equal(children[0]?.parentTaskId, 'parent-task-1');
  assert.equal(children[1]?.parentTaskId, 'parent-task-1');

  // 2. Verify workspace isolation (each child gets separate workspace path)
  const codingWorkspace = children[0]?.payload?.['workspace'] as string;
  assert.ok(codingWorkspace.includes('children'));
  assert.ok(codingWorkspace.includes('child-coding'));

  // 3. Verify least privilege: parent secrets & personal profile must NOT leak to children
  assert.equal(children[0]?.payload?.['secrets'], undefined);
  assert.equal(children[0]?.payload?.['userProfile'], undefined);
  assert.equal(children[1]?.payload?.['secrets'], undefined);

  // 4. Verify capability allowlist is respected
  assert.deepEqual(children[0]?.payload?.['capabilityAllowlist'], ['filesystem:read', 'filesystem:write']);
  assert.deepEqual(children[1]?.payload?.['capabilityAllowlist'], ['web:search', 'web:fetch']);

  // 5. Verify subagent.spawned events are emitted
  const spawnedEvents = broadcaster.publishedEvents.filter((e) => e.eventType === 'subagent.spawned');
  assert.equal(spawnedEvents.length, 2);
  assert.equal(spawnedEvents[0]?.payload['parentTaskId'], 'parent-task-1');
  assert.equal(spawnedEvents[0]?.payload['childTaskId'], children[0]?.id);
});

test('Durable subagent orchestration: worker restart does NOT duplicate child executions (idempotency)', async () => {
  const repo = new SubagentTestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const orchestrator = new SubagentOrchestrator({
    taskRepo: repo,
    broadcaster,
  });

  const parentTask: TaskRecord = {
    id: 'parent-idempotent',
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'orchestrated_task',
    payload: {},
    status: 'running',
    progress: 0,
    attempt: 1,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const plan: SubagentPlanItem[] = [
    {
      id: 'step-1',
      name: 'Step 1',
      goal: 'First goal',
      kind: 'generic',
      capabilityAllowlist: ['tool:read'],
    },
    {
      id: 'step-2',
      name: 'Step 2',
      goal: 'Second goal',
      kind: 'generic',
      capabilityAllowlist: ['tool:read'],
    },
  ];

  const payload: ParentTaskPayload = {
    objective: 'Test recovery',
    successCriteria: ['Completed'],
    childPlan: plan,
  };

  // First run: creates 2 child tasks
  const firstRun = await orchestrator.prepareChildTasks(parentTask, payload);
  assert.equal(firstRun.length, 2);
  const child1Id = firstRun[0]?.id;
  const child2Id = firstRun[1]?.id;

  // Simulate worker crash & restart: re-run preparation
  const secondRun = await orchestrator.prepareChildTasks(parentTask, payload);
  assert.equal(secondRun.length, 2);

  // Exact same tasks returned (no duplication)
  assert.equal(secondRun[0]?.id, child1Id);
  assert.equal(secondRun[1]?.id, child2Id);

  // Repository task count remains 2 (no extra rows in DB)
  const allChildren = await repo.listChildTasks('user-1', 'parent-idempotent');
  assert.equal(allChildren.length, 2);
});

test('Durable subagent orchestration: partial failure produces honest failure/partial status (never fake success)', async () => {
  const repo = new SubagentTestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const orchestrator = new SubagentOrchestrator({
    taskRepo: repo,
    broadcaster,
  });

  const parentTask: TaskRecord = {
    id: 'parent-partial',
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'orchestrated_task',
    payload: {
      successCriteria: ['All mandatory subtasks succeed'],
    },
    status: 'running',
    progress: 20,
    attempt: 1,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const plan: SubagentPlanItem[] = [
    {
      id: 'backend',
      name: 'Backend Task',
      goal: 'API implementation',
      kind: 'coding',
      capabilityAllowlist: ['fs:read'],
      required: true,
    },
    {
      id: 'database',
      name: 'Database Migration',
      goal: 'Run migrations',
      kind: 'coding',
      capabilityAllowlist: ['fs:read'],
      required: true,
    },
  ];

  const children = await orchestrator.prepareChildTasks(parentTask, {
    objective: 'Full stack feature',
    successCriteria: ['All mandatory subtasks succeed'],
    childPlan: plan,
  });

  const child1 = children[0]!;
  const child2 = children[1]!;

  // Child 1 completes with verified artifact
  await repo.updateTaskStatus('user-1', child1.id, 'running');
  await repo.updateTaskStatus('user-1', child1.id, 'completed', {
    artifacts: [{ id: 'art-1', title: 'backend.ts', content: 'export const api = true;' }],
  });

  // Child 2 fails due to syntax error
  await repo.updateTaskStatus('user-1', child2.id, 'running');
  await repo.updateTaskStatus('user-1', child2.id, 'failed', {
    error: 'SyntaxError: unexpected token in migration script',
  });

  // Parent aggregates results
  const summary = await orchestrator.aggregateResults(parentTask, plan);

  // Status must be partial_failure or failed; NEVER completed!
  assert.equal(summary.status, 'partial_failure');
  assert.equal(summary.completedChildren, 1);
  assert.equal(summary.failedChildren, 1);
  assert.equal(summary.totalChildren, 2);

  // Summary child is recorded in untrustedSummaries
  assert.ok(summary.untrustedSummaries.length > 0);
});

test('Durable subagent orchestration: parent cancellation cascades to all active child tasks', async () => {
  const repo = new SubagentTestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const cancelledQueueJobs: string[] = [];

  const fakeQueue: TaskQueueEnqueuerLike = {
    enqueue: async () => {},
    cancel: async (id: string) => {
      cancelledQueueJobs.push(id);
    },
  };

  const orchestrator = new SubagentOrchestrator({
    taskRepo: repo,
    taskQueue: fakeQueue,
    broadcaster,
  });

  const parentTask: TaskRecord = {
    id: 'parent-cancel',
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'orchestrated_task',
    payload: {},
    status: 'running',
    progress: 10,
    attempt: 1,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const plan: SubagentPlanItem[] = [
    { id: 'c-1', name: 'Child 1', goal: 'G1', kind: 'generic', capabilityAllowlist: [] },
    { id: 'c-2', name: 'Child 2', goal: 'G2', kind: 'generic', capabilityAllowlist: [] },
  ];

  const children = await orchestrator.prepareChildTasks(parentTask, {
    objective: 'Cancel test',
    successCriteria: [],
    childPlan: plan,
  });

  // Child 1 is running, Child 2 is queued
  await repo.updateTaskStatus('user-1', children[0]!.id, 'running');

  // Trigger cascade cancellation
  const cancelledCount = await orchestrator.cascadeCancellation('parent-cancel', 'user-1');
  assert.equal(cancelledCount, 2);

  // Both children must now have status 'cancelled' in DB
  const c1After = await repo.getTask('user-1', children[0]!.id);
  const c2After = await repo.getTask('user-1', children[1]!.id);
  assert.equal(c1After?.status, 'cancelled');
  assert.equal(c2After?.status, 'cancelled');

  // Cancel events must be emitted
  const cancelEvents = broadcaster.publishedEvents.filter((e) => e.eventType === 'subagent.cancelled');
  assert.equal(cancelEvents.length, 2);

  // Queue cancel must be invoked
  assert.ok(cancelledQueueJobs.includes(children[0]!.id));
  assert.ok(cancelledQueueJobs.includes(children[1]!.id));
});

test('Durable subagent orchestration: enforces recursion depth and max children limits strictly', async () => {
  const repo = new SubagentTestTaskRepo();
  const orchestrator = new SubagentOrchestrator({
    taskRepo: repo,
    defaultMaxDepth: 1,
    defaultMaxChildren: 5,
  });

  const parentAtMaxDepth: TaskRecord = {
    id: 'deep-child',
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'orchestrated_task',
    payload: {},
    status: 'running',
    progress: 0,
    attempt: 1,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Rejection on delegation depth exceeded (currentDepth 1 >= maxDepth 1)
  assert.throws(
    () =>
      orchestrator.validatePlan(parentAtMaxDepth, {
        objective: 'Illegal deep recursion',
        successCriteria: [],
        currentDepth: 1,
        maxDelegationDepth: 1,
        childPlan: [{ id: 'sub-sub', name: 'Too deep', goal: 'goal', kind: 'generic', capabilityAllowlist: [] }],
      }),
    (err: unknown) => {
      return (
        err instanceof Error &&
        err.message.includes('Batas kedalaman delegasi (maksimum kedalaman 1) telah tercapai')
      );
    },
  );

  // Rejection on max children exceeded (6 children > limit 5)
  const tooManyChildren: SubagentPlanItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: `child-${i + 1}`,
    name: `Child ${i + 1}`,
    goal: `Goal ${i + 1}`,
    kind: 'generic',
    capabilityAllowlist: [],
  }));

  assert.throws(
    () =>
      orchestrator.validatePlan(parentAtMaxDepth, {
        objective: 'Too many subagents',
        successCriteria: [],
        currentDepth: 0,
        maxChildren: 5,
        childPlan: tooManyChildren,
      }),
    (err: unknown) => {
      return (
        err instanceof Error &&
        err.message.includes('melebihi batas maksimum per parent (5)')
      );
    },
  );
});

test('Durable subagent orchestration: evaluator checks concrete artifacts and rejects pure agent self-claim', async () => {
  const repo = new SubagentTestTaskRepo();
  const orchestrator = new SubagentOrchestrator({
    taskRepo: repo,
  });

  const parentTask: TaskRecord = {
    id: 'parent-eval-check',
    userId: 'user-1',
    projectId: 'proj-1',
    kind: 'orchestrated_task',
    payload: {
      successCriteria: ['Feature implementation artifact exists'],
    },
    status: 'running',
    progress: 0,
    attempt: 1,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const plan: SubagentPlanItem[] = [
    {
      id: 'worker-1',
      name: 'Feature Worker',
      goal: 'Deliver code',
      kind: 'coding',
      capabilityAllowlist: ['fs:write'],
    },
  ];

  const children = await orchestrator.prepareChildTasks(parentTask, {
    objective: 'Deliver verified code',
    successCriteria: ['Feature implementation artifact exists'],
    childPlan: plan,
  });

  const child = children[0]!;

  // Case A: Child marks completed with text summary ONLY (no concrete artifacts)
  await repo.updateTaskStatus('user-1', child.id, 'planning');
  await repo.updateTaskStatus('user-1', child.id, 'running');
  await repo.updateTaskStatus('user-1', child.id, 'completed', {
    artifacts: [], // Empty artifacts!
  });

  const summaryWithoutArtifacts = await orchestrator.aggregateResults(parentTask, plan);
  // Evaluator must reject completion without verified artifacts
  assert.equal(summaryWithoutArtifacts.evaluationPassed, false);
  assert.equal(summaryWithoutArtifacts.status, 'partial_failure');

  // Case B: Child provides verified concrete artifact
  const parentTaskB: TaskRecord = {
    ...parentTask,
    id: 'parent-eval-check-b',
  };
  const planB: SubagentPlanItem[] = [
    {
      id: 'worker-2',
      name: 'Feature Worker B',
      goal: 'Deliver code',
      kind: 'coding',
      capabilityAllowlist: ['fs:write'],
    },
  ];
  const childrenB = await orchestrator.prepareChildTasks(parentTaskB, {
    objective: 'Deliver verified code',
    successCriteria: ['Feature implementation artifact exists'],
    childPlan: planB,
  });
  const childB = childrenB[0]!;

  await repo.updateTaskStatus('user-1', childB.id, 'planning');
  await repo.updateTaskStatus('user-1', childB.id, 'running');
  await repo.updateTaskStatus('user-1', childB.id, 'completed', {
    artifacts: [{ id: 'art-code', title: 'Feature implementation artifact exists', content: 'const ok = true;' }],
  });

  const summaryWithArtifacts = await orchestrator.aggregateResults(parentTaskB, planB);
  assert.equal(summaryWithArtifacts.evaluationPassed, true);
  assert.equal(summaryWithArtifacts.status, 'completed');
  assert.equal(summaryWithArtifacts.verifiedArtifactsCount, 1);
});

test('Durable subagent orchestration: coding merge policy strictly prevents auto-merge to main, push, and deploy', () => {
  const repo = new SubagentTestTaskRepo();
  const orchestrator = new SubagentOrchestrator({ taskRepo: repo });

  // 1. Prohibit remote push without approval
  const pushReview = orchestrator.reviewCodingMergePolicy({
    childTaskId: 'c-1',
    diffAvailable: true,
    testsPassed: true,
    lintPassed: true,
    action: 'push',
  });
  assert.equal(pushReview.allowed, false);
  assert.equal(pushReview.requiresApproval, true);
  assert.equal(pushReview.riskLevel, 'HIGH');
  assert.ok(pushReview.reason.includes('git push atau deploy ke remote tidak boleh dilakukan otomatis'));

  // 2. Prohibit auto-merge to main/master without approval
  const mainMergeReview = orchestrator.reviewCodingMergePolicy({
    childTaskId: 'c-1',
    diffAvailable: true,
    testsPassed: true,
    lintPassed: true,
    targetBranch: 'main',
    action: 'merge',
  });
  assert.equal(mainMergeReview.allowed, false);
  assert.equal(mainMergeReview.requiresApproval, true);
  assert.equal(mainMergeReview.autoMergeBlocked, true);
  assert.ok(mainMergeReview.reason.includes('Auto-merge langsung ke branch utama (main) dilarang'));

  // 3. Prohibit merge when tests fail
  const failingTestReview = orchestrator.reviewCodingMergePolicy({
    childTaskId: 'c-1',
    diffAvailable: true,
    testsPassed: false,
    lintPassed: true,
    targetBranch: 'feature/subagent-auth',
  });
  assert.equal(failingTestReview.allowed, false);
  assert.ok(failingTestReview.reason.includes('pengujian (test/lint) pada workspace child gagal'));

  // 4. Allow merge to isolated feature branch when diff & tests pass
  const validReview = orchestrator.reviewCodingMergePolicy({
    childTaskId: 'c-1',
    diffAvailable: true,
    testsPassed: true,
    lintPassed: true,
    targetBranch: 'feature/subagent-auth',
  });
  assert.equal(validReview.allowed, true);
  assert.equal(validReview.requiresApproval, false);
  assert.equal(validReview.autoMergeBlocked, false);
});

test('Durable subagent orchestration: integrates end-to-end with TaskExecutor and TaskQueue', async () => {
  const repo = new SubagentTestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const queue = new InMemoryTaskQueue({ autoDispatch: false });

  const executor = new TaskExecutor(repo, broadcaster, {
    taskQueue: queue,
  });

  // Create orchestrated parent task in queued status
  const parentCreate = await repo.createTask({
    userId: 'user-e2e',
    projectId: 'proj-e2e',
    kind: 'orchestrated_task',
    payload: {
      objective: 'Run parallel subagents',
      successCriteria: ['All done'],
      childPlan: [
        { id: 'sub-1', name: 'Sub 1', goal: 'Goal 1', kind: 'generic', capabilityAllowlist: ['fs:read'] },
        { id: 'sub-2', name: 'Sub 2', goal: 'Goal 2', kind: 'generic', capabilityAllowlist: ['fs:read'] },
      ],
    },
  });

  // Execute parent task via TaskExecutor
  await executor.execute({
    taskId: parentCreate.task.id,
    userId: 'user-e2e',
    projectId: 'proj-e2e',
    kind: 'orchestrated_task',
    attempt: 0,
    maxAttempts: 3,
  });

  // 1. Verify child tasks were persisted in DB with parent_task_id
  const childTasks = await repo.listChildTasks('user-e2e', parentCreate.task.id);
  assert.equal(childTasks.length, 2);
  assert.equal(childTasks[0]?.parentTaskId, parentCreate.task.id);
  assert.equal(childTasks[1]?.parentTaskId, parentCreate.task.id);

  // 2. Verify child tasks were enqueued in the task queue
  assert.ok(queue.getEnqueuedJob(childTasks[0]!.id) !== undefined);
  assert.ok(queue.getEnqueuedJob(childTasks[1]!.id) !== undefined);

  // 3. Verify parent checkpoint recorded child task preparation
  const parentAfter = await repo.getTask('user-e2e', parentCreate.task.id);
  assert.ok(parentAfter?.checkpoint);
  assert.equal(parentAfter.checkpoint.lastExecutedAction, 'prepare_subagents');
  assert.equal(parentAfter.progress, 20);

  // 4. Verify progress event emitted
  const progressEvents = broadcaster.publishedEvents.filter((e) => e.eventType === 'subagent.progress');
  assert.equal(progressEvents.length, 1);
});
