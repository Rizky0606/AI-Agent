import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskExecutor } from '../src/task-executor.ts';
import {
  ToolRegistry,
  type ToolDefinition,
} from '@personal-ai-os/tools';
import {
  PermissionEngine,
  SecuredCapabilityGuard,
  type ApprovalValidator,
} from '@personal-ai-os/permissions';
import { MockModelGateway } from '@personal-ai-os/model-gateway';
import type { TaskRecord, TaskCheckpoint, TaskEventRecord } from '@personal-ai-os/shared';

// Test Task Repository
class TestTaskRepo {
  public tasks = new Map<string, TaskRecord>();
  public events: TaskEventRecord[] = [];

  async createTask(params: {
    userId: string;
    projectId: string;
    kind: string;
    payload?: Record<string, unknown>;
  }): Promise<{ task: TaskRecord }> {
    const id = `task-${Math.random().toString(36).slice(2, 9)}`;
    const record: TaskRecord = {
      id,
      userId: params.userId,
      projectId: params.projectId,
      kind: params.kind,
      status: 'pending',
      payload: params.payload ?? {},
      retryCount: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(id, record);
    return { task: record };
  }

  async getTask(userId: string, taskId: string): Promise<TaskRecord | null> {
    const t = this.tasks.get(taskId);
    if (!t || t.userId !== userId) return null;
    return JSON.parse(JSON.stringify(t));
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    status: TaskRecord['status'],
    extras?: { error?: string; artifacts?: unknown[]; attempt?: number },
  ): Promise<TaskRecord> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error('not found');
    t.status = status;
    if (extras?.error !== undefined) t.error = extras.error;
    if (extras?.artifacts !== undefined) t.artifacts = extras.artifacts as unknown[];
    t.updatedAt = new Date().toISOString();
    return JSON.parse(JSON.stringify(t));
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error('not found');
    t.progress = progress;
    if (checkpoint) t.checkpoint = checkpoint;
    t.updatedAt = new Date().toISOString();
    return JSON.parse(JSON.stringify(t));
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<TaskEventRecord> {
    const event: TaskEventRecord = {
      id: `ev-${this.events.length + 1}`,
      taskId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async getDanglingRunningTasks(): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'running');
  }
}

class TestBroadcaster {
  public published: TaskEventRecord[] = [];
  publish(event: TaskEventRecord): void {
    this.published.push(event);
  }
}

function createMockTool(params: {
  name: string;
  description?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  action?: string;
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): ToolDefinition {
  return {
    name: params.name,
    description: params.description ?? params.name,
    capability: 'tool:generic',
    resourceScope: 'workspace',
    riskLevel: params.riskLevel ?? 'LOW',
    action: params.action ?? `tool:${params.name}`,
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 16384,
    healthCheck: async () => ({ status: 'healthy', latencyMs: 0, timestamp: new Date().toISOString() }),
    execute: params.execute,
  };
}

test('Generic execution loop executes tool_calling with web_fetch and completes with verified criteria and telemetry', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  // Register web_fetch tool with untrusted HTML content
  registry.registerTool(
    createMockTool({
      name: 'web_fetch',
      description: 'Fetch web content',
      action: 'web:fetch',
      execute: async (input: Record<string, unknown>) => ({
        url: input.url,
        content: '<script>alert("xss")</script>Status server Personal AI OS versi 2.4 beroperasi normal pada port 8080.',
      }),
    }),
  );

  let stepCallCount = 0;
  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat', 'streaming', 'tool_calling'],
        contextWindow: 200_000,
      },
    ],
    chatHandler: () => {
      stepCallCount++;
      if (stepCallCount === 1) {
        // Model requests web_fetch tool
        return {
          content: 'Saya akan memeriksa status server dengan web_fetch.',
          toolCalls: [
            {
              id: 'call-web-1',
              type: 'function',
              function: {
                name: 'web_fetch',
                arguments: JSON.stringify({ url: 'https://status.personal-os.internal' }),
              },
            },
          ],
        };
      }
      // Step 2: Model receives tool observation and answers
      return {
        content: 'Berdasarkan pemeriksaan web_fetch, server Personal AI OS versi 2.4 beroperasi normal pada port 8080.',
      };
    },
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  const { task } = await repo.createTask({
    userId: 'user-generic-1',
    projectId: 'proj-1',
    kind: 'generic_task',
    payload: {
      prompt: 'Periksa status server Personal AI OS dan pastikan berjalan normal pada port 8080',
      acceptanceCriteria: [
        {
          id: 'status-server',
          description: 'server Personal AI OS beroperasi normal pada port 8080',
          category: 'generic',
          required: true,
        },
      ],
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

  const completed = await repo.getTask(task.userId, task.id);
  assert.equal(completed?.status, 'completed');
  assert.ok(completed?.checkpoint);
  assert.ok(completed.checkpoint.acceptanceCriteria, 'Acceptance criteria must be persisted in checkpoint');
  assert.equal(completed.checkpoint.acceptanceCriteria.length, 1);
  assert.equal(completed.checkpoint.acceptanceCriteria[0].id, 'status-server');

  // Verify tool event output was sanitized into untrusted content block
  const toolEvent = repo.events.find((e) => e.eventType === 'task.tool_call');
  assert.ok(toolEvent, 'tool_call event should be emitted');
  assert.equal(toolEvent.payload.tool, 'web_fetch');
  assert.match(String(toolEvent.payload.output), /<untrusted_content/);
  assert.match(String(toolEvent.payload.output), /<\/untrusted_content>/);
  assert.match(String(toolEvent.payload.output), /versi 2.4 beroperasi normal/);

  // Check telemetry in task.completed event
  const compEvent = repo.events.find((e) => e.eventType === 'task.completed');
  assert.ok(compEvent);
  const telemetry = compEvent.payload.telemetry as Record<string, unknown>;
  assert.ok(telemetry);
  assert.equal(telemetry.stopReason, 'goal_achieved');
  assert.deepEqual(telemetry.toolsUsed, ['web_fetch']);
  assert.equal(telemetry.fallbackUsed, false);
});

test('Generic loop halts and enters waiting_approval when model selects HIGH-risk tool, then resumes upon approval', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();

  const approvalStore = new Map<string, { valid: boolean }>();
  const validator: ApprovalValidator = {
    async validateAndConsume(approvalId) {
      const appr = approvalStore.get(approvalId);
      if (appr && appr.valid) {
        appr.valid = false;
        return { valid: true };
      }
      return { valid: false, reason: 'Invalid or expired approval' };
    },
  };
  const guard = new SecuredCapabilityGuard(engine, { approvalValidator: validator });
  const registry = new ToolRegistry(guard);

  // Register deploy tool (HIGH risk)
  registry.registerTool(
    createMockTool({
      name: 'deploy_service',
      description: 'Deploy service to cluster',
      riskLevel: 'HIGH',
      action: 'deploy:cluster',
      execute: async (input: Record<string, unknown>) => ({ deployed: input.target, status: 'ready' }),
    }),
  );

  let approvalCount = 0;
  let dynamicApprovalId = '';
  const approvalCreator = async () => {
    approvalCount++;
    dynamicApprovalId = `appr-gen-${approvalCount}`;
    approvalStore.set(dynamicApprovalId, { valid: true });
    return { id: dynamicApprovalId };
  };

  let modelStep = 0;
  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat', 'streaming', 'tool_calling'],
        contextWindow: 200_000,
      },
    ],
    chatHandler: () => {
      modelStep++;
      if (modelStep === 1) {
        return {
          content: 'Menjalankan deployment layanan ke produksi.',
          toolCalls: [
            {
              id: 'call-deploy-1',
              type: 'function',
              function: {
                name: 'deploy_service',
                arguments: JSON.stringify({ target: 'api-service' }),
              },
            },
          ],
        };
      }
      return {
        content: 'Deployment layanan api-service berhasil dilakukan dan berstatus ready.',
      };
    },
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    guard,
    approvalCreator,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  const { task } = await repo.createTask({
    userId: 'user-approval-gen',
    projectId: 'proj-gen',
    kind: 'generic_task',
    payload: {
      prompt: 'Deploy layanan api-service ke cluster produksi',
      acceptanceCriteria: [
        {
          id: 'deploy-crit',
          description: 'deployment layanan api-service berhasil',
          category: 'generic',
          required: true,
        },
      ],
    },
  });

  // Run 1: Must halt at waiting_approval!
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  const waitingTask = await repo.getTask(task.userId, task.id);
  assert.equal(waitingTask?.status, 'waiting_approval');
  assert.equal(waitingTask?.checkpoint?.lastExecutedAction, 'waiting_approval');
  assert.equal(waitingTask?.checkpoint?.actionState?.approvalId, dynamicApprovalId);
  const waitingEvent = repo.events.find((e) => e.eventType === 'task.waiting_approval');
  assert.ok(waitingEvent);

  // Resume with approved approvalId
  waitingTask.status = 'running';
  waitingTask.checkpoint.actionState.approved = true;
  await repo.updateTaskStatus(task.userId, task.id, 'running');
  await repo.updateTaskProgress(task.userId, task.id, 50, waitingTask.checkpoint);

  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 1,
    maxAttempts: 3,
  });

  const resumedTask = await repo.getTask(task.userId, task.id);
  assert.equal(resumedTask?.status, 'completed');
  assert.match(String(resumedTask?.artifacts?.[0]?.content), /berhasil/);
});

test('Generic loop stops and falls back to synthesis when maxSteps limit is reached', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  registry.registerTool(
    createMockTool({
      name: 'search_step',
      description: 'Search step',
      action: 'tool:search',
      execute: async (input: Record<string, unknown>) => ({ item: `result-${input.q}` }),
    }),
  );

  let callCount = 0;
  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat', 'streaming', 'tool_calling'],
        contextWindow: 200_000,
      },
    ],
    chatHandler: (req) => {
      callCount++;
      // If loop forces summary when maxSteps exceeded
      const isSummaryRequest = req.messages.some((m) =>
        m.content.includes('Batas langkah tercapai'),
      );
      if (isSummaryRequest) {
        return {
          content: 'Ringkasan akhir analisis: investigasi dihentikan karena batas langkah tercapai.',
        };
      }
      // Keep invoking search_step endlessly
      return {
        content: `Mencari iterasi ${callCount}`,
        toolCalls: [
          {
            id: `call-loop-${callCount}`,
            type: 'function',
            function: {
              name: 'search_step',
              arguments: JSON.stringify({ q: `iter-${callCount}` }),
            },
          },
        ],
      };
    },
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  const { task } = await repo.createTask({
    userId: 'user-bound-step',
    projectId: 'proj-bound',
    kind: 'generic_task',
    payload: {
      prompt: 'Lakukan analisis investigasi',
      maxSteps: 3, // Hard step bound override
      acceptanceCriteria: [
        {
          id: 'analisis',
          description: 'analisis investigasi dihentikan',
          category: 'generic',
          required: true,
        },
      ],
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

  const finalTask = await repo.getTask(task.userId, task.id);
  assert.equal(finalTask?.status, 'completed');
  const compEvent = repo.events.find((e) => e.eventType === 'task.completed');
  const telemetry = compEvent?.payload.telemetry as Record<string, unknown> | undefined;
  assert.ok(telemetry);
  assert.equal(telemetry.stopReason, 'max_steps_exceeded');
  assert.ok(telemetry.stepCount <= 3);
});

test('Generic loop stops when timeoutMs hard bound is reached', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  registry.registerTool(
    createMockTool({
      name: 'slow_tool',
      description: 'Slow tool',
      action: 'tool:read',
      execute: async () => {
        // Small sleep
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { done: true };
      },
    }),
  );

  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat', 'streaming', 'tool_calling'],
        contextWindow: 200_000,
      },
    ],
    chatHandler: (req) => {
      const isSummary = req.messages.some((m) => m.content.includes('Batas langkah tercapai'));
      if (isSummary) {
        return { content: 'Ringkasan ringkas komputasi.' };
      }
      return {
        content: 'Memanggil slow tool',
        toolCalls: [
          {
            id: 'call-slow',
            type: 'function',
            function: { name: 'slow_tool', arguments: '{}' },
          },
        ],
      };
    },
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  const { task } = await repo.createTask({
    userId: 'user-timeout',
    projectId: 'proj-timeout',
    kind: 'generic_task',
    payload: {
      prompt: 'Komputasi durasi panjang',
      timeoutMs: 25, // Ultra-short timeout to trigger hard bound
      acceptanceCriteria: [
        {
          id: 'timeout-crit',
          description: 'komputasi ringkas',
          category: 'generic',
          required: false,
        },
      ],
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

  const compEvent = repo.events.find((e) => e.eventType === 'task.completed');
  const telemetry = compEvent?.payload.telemetry as Record<string, unknown> | undefined;
  assert.ok(telemetry);
  assert.equal(telemetry.stopReason, 'timeout');
});

test('Honest fallback: when model has no verified tool calling, executes single-pass with clear label', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'openai/gpt-4o-mini',
        capabilities: ['chat', 'streaming'], // Notice NO tool_calling!
        contextWindow: 128_000,
      },
    ],
    chatResponse: 'Analisis ringkas: sistem operasional normal.',
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    defaultModel: 'openai/gpt-4o-mini',
  });

  const { task } = await repo.createTask({
    userId: 'user-fallback',
    projectId: 'proj-fallback',
    kind: 'generic_task',
    payload: {
      prompt: 'Analisis ringkas performa',
      acceptanceCriteria: [
        {
          id: 'analisis-performa',
          description: 'sistem operasional normal',
          category: 'generic',
          required: true,
        },
      ],
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

  const completed = await repo.getTask(task.userId, task.id);
  assert.equal(completed?.status, 'completed');
  const compEvent = repo.events.find((e) => e.eventType === 'task.completed');
  assert.equal(compEvent?.payload.fallbackUsed, true);
  assert.match(String(compEvent?.payload.note), /tidak memiliki kapabilitas tool_calling terverifikasi/);

  const artifact = completed?.artifacts?.[0] as { fallbackUsed?: boolean; note?: string } | undefined;
  assert.equal(artifact?.fallbackUsed, true);
  assert.match(String(artifact?.note), /single-pass tanpa tool/);
});

test('Generic loop fails task when invalid or rejected approval is provided on resume', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine, {
    approvalValidator: {
      async validateAndConsume() {
        return { valid: false, reason: 'Persetujuan ditolak oleh pengguna.' };
      },
    },
  });
  const registry = new ToolRegistry(guard);

  registry.registerTool(
    createMockTool({
      name: 'critical_tool',
      description: 'Critical tool',
      riskLevel: 'CRITICAL',
      action: 'deploy:cluster',
      execute: async () => ({ status: 'done' }),
    }),
  );

  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat', 'streaming', 'tool_calling'],
        contextWindow: 200_000,
      },
    ],
    chatHandler: () => ({
      content: 'Mencoba eksekusi',
      toolCalls: [{ id: 'c1', type: 'function', function: { name: 'critical_tool', arguments: '{}' } }],
    }),
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    guard,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  const { task } = await repo.createTask({
    userId: 'user-rej',
    projectId: 'proj-rej',
    kind: 'generic_task',
    payload: { prompt: 'Tindakan kritis' },
  });

  // Pre-seed task at waiting_approval checkpoint with approved = true but validator rejects
  await repo.updateTaskStatus(task.userId, task.id, 'running');
  await repo.updateTaskProgress(task.userId, task.id, 50, {
    version: 1,
    stepIndex: 2,
    totalSteps: 10,
    lastExecutedAction: 'waiting_approval',
    actionType: 'approval',
    actionState: {
      approvalId: 'appr-invalid',
      approved: true,
      pendingToolCall: { name: 'critical_tool', args: {} },
    },
    verified: true,
  });

  // Should fail closed with InvalidApprovalError!
  await assert.rejects(
    async () => {
      await executor.execute({
        taskId: task.id,
        userId: task.userId,
        projectId: task.projectId,
        kind: task.kind,
        attempt: 1,
        maxAttempts: 3,
      });
    },
    /Persetujuan ditolak oleh pengguna/,
  );

  const failedTask = await repo.getTask(task.userId, task.id);
  assert.equal(failedTask?.status, 'failed');
  assert.match(String(failedTask?.error), /Persetujuan ditolak oleh pengguna/);
});

test('Generic loop fails evaluation when on-topic-guard detects severe deviation', async () => {
  const repo = new TestTaskRepo();
  const broadcaster = new TestBroadcaster();
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat', 'streaming', 'tool_calling'],
        contextWindow: 200_000,
      },
    ],
    chatResponse: 'Silakan buy bitcoin sekarang dan transfer dana ke crypto giveaway kami.',
  });

  const executor = new TaskExecutor(repo, broadcaster, {
    modelGateway: gateway,
    registry,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  const { task } = await repo.createTask({
    userId: 'user-deviation',
    projectId: 'proj-dev',
    kind: 'generic_task',
    payload: {
      prompt: 'Analisis metrik performa database server kuartal ini',
      acceptanceCriteria: [
        {
          id: 'metrik-db',
          description: 'laporan performa database server',
          category: 'generic',
          required: true,
        },
      ],
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

  const failedTask = await repo.getTask(task.userId, task.id);
  assert.equal(failedTask?.status, 'failed');
  assert.match(String(failedTask?.error), /Evaluasi generik belum lulus/);
  assert.match(String(failedTask?.error), /Terdeteksi konten mencurigakan atau di luar domain tugas/);
});

