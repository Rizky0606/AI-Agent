/**
 * Skrip Live / Smoke Test Eksekusi Generik Nyata (Sesi 8)
 *
 * Mendemonstrasikan:
 * 1. Autonomous tool-calling loop (Rencana -> Langkah -> Observasi -> Evaluasi).
 * 2. Tool 1: web_fetch (LOW risk) -> Luaran disanitasi sebagai konten tidak tepercaya (<untrusted_content>).
 * 3. Tool 2: notify_stakeholder (HIGH risk) -> Memerlukan approval Permission Engine, berhenti di waiting_approval.
 * 4. Resume dengan approvalId yang valid -> Selesai via guard.
 * 5. Evaluasi akhir berbasis kriteria nyata dan audit_logs terperinci.
 *
 * Cara menjalankan:
 *   node --experimental-strip-types scripts/test-generic-live.ts
 */

import { TaskExecutor } from '../apps/agent-worker/src/task-executor.ts';
import {
  ToolRegistry,
  type ToolDefinition,
} from '../packages/tools/src/index.ts';
import {
  PermissionEngine,
  SecuredCapabilityGuard,
  type ApprovalValidator,
} from '../packages/permissions/src/index.ts';
import { MockModelGateway } from '../packages/model-gateway/src/index.ts';
import type { TaskRecord, TaskCheckpoint, TaskEventRecord } from '../packages/shared/src/index.ts';

// In-Memory Repository & Event Broadcaster
class LiveTaskRepo {
  public tasks = new Map<string, TaskRecord>();
  public events: TaskEventRecord[] = [];

  async createTask(params: {
    userId: string;
    projectId: string;
    kind: string;
    payload?: Record<string, unknown>;
  }): Promise<{ task: TaskRecord }> {
    const id = `task-live-${Date.now()}`;
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
    if (extras?.artifacts !== undefined) t.artifacts = extras.artifacts as any;
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
    return [];
  }
}

class LiveBroadcaster {
  publish(event: TaskEventRecord): void {
    console.log(`[EVENT] ${event.eventType} -> step: ${event.payload?.step ?? '-'} ${event.payload?.tool ?? ''}`);
  }
}

async function runLiveScript() {
  console.log('================================================================');
  console.log('  LIVE DEMONSTRATION: EKSEKUSI GENERIK NYATA (SESI 8)');
  console.log('================================================================\n');

  const repo = new LiveTaskRepo();
  const broadcaster = new LiveBroadcaster();

  // Audit log storage
  const auditLogs: Array<{ action: string; decision: string; risk: string; timestamp: string }> = [];

  // Setup Permission Engine & Guard with audit logger
  const engine = new PermissionEngine();

  const approvalStore = new Map<string, { valid: boolean }>();
  const validator: ApprovalValidator = {
    async validateAndConsume(approvalId) {
      const appr = approvalStore.get(approvalId);
      if (appr && appr.valid) {
        appr.valid = false;
        return { valid: true };
      }
      return { valid: false, reason: 'Persetujuan tidak valid atau kedaluwarsa' };
    },
  };

  const guard = new SecuredCapabilityGuard(engine, {
    approvalValidator: validator,
    auditLogger: {
      log: async (entry) => {
        auditLogs.push({
          action: entry.action,
          decision: entry.decision,
          risk: (entry.metadata as any)?.riskLevel ?? 'LOW',
          timestamp: new Date().toISOString(),
        });
      },
    },
  });
  const registry = new ToolRegistry(guard);

  // Register Tool 1: web_fetch (LOW risk)
  const webFetchTool: ToolDefinition = {
    name: 'web_fetch',
    description: 'Mengambil konten halaman web publik',
    capability: 'tool:generic',
    resourceScope: 'network',
    riskLevel: 'LOW',
    action: 'web:fetch',
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 16384,
    healthCheck: async () => ({ status: 'healthy', latencyMs: 0, timestamp: new Date().toISOString() }),
    execute: async (input: any) => ({
      url: input.url,
      status: 200,
      content:
        'Laporan Infrastruktur: Layanan backend Fastify dan worker BullMQ aktif normal di Oracle Cloud VPS.',
    }),
  };
  registry.registerTool(webFetchTool);

  // Register Tool 2: notify_stakeholder (HIGH risk per git/external push)
  const notifyTool: ToolDefinition = {
    name: 'notify_stakeholder',
    description: 'Mengirimkan notifikasi publikasi ke pemangku kepentingan',
    capability: 'tool:generic',
    resourceScope: 'external',
    riskLevel: 'HIGH',
    action: 'deploy:cluster', // Recognized HIGH risk
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 16384,
    healthCheck: async () => ({ status: 'healthy', latencyMs: 0, timestamp: new Date().toISOString() }),
    execute: async (input: any) => ({
      notified: true,
      channel: input.channel,
      status: 'terkirim',
    }),
  };
  registry.registerTool(notifyTool);

  let stepCounter = 0;
  let capturedApprovalId = '';

  const approvalCreator = async () => {
    capturedApprovalId = `appr-live-${Date.now()}`;
    approvalStore.set(capturedApprovalId, { valid: true });
    console.log(`[APPROVAL CREATOR] Dibuat persetujuan baru: ${capturedApprovalId}`);
    return { id: capturedApprovalId };
  };

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
      stepCounter++;
      if (stepCounter === 1) {
        // Step 1: Model invokes web_fetch
        console.log('[MODEL] Langkah 1: Memilih tool "web_fetch" untuk memeriksa status infrastruktur');
        return {
          content: 'Saya akan mengambil laporan status infrastruktur dari web.',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'web_fetch',
                arguments: JSON.stringify({ url: 'https://status.personal-os.internal' }),
              },
            },
          ],
        };
      }

      if (stepCounter === 2) {
        // Step 2: Model receives web_fetch observation and invokes notify_stakeholder (HIGH risk)
        console.log('[MODEL] Langkah 2: Observasi diterima. Memilih tool "notify_stakeholder" (HIGH risk)');
        return {
          content: 'Status infrastruktur telah dikonfirmasi normal. Sekarang mempublikasikan notifikasi.',
          toolCalls: [
            {
              id: 'call-2',
              type: 'function',
              function: {
                name: 'notify_stakeholder',
                arguments: JSON.stringify({ channel: 'management-broadcast' }),
              },
            },
          ],
        };
      }

      // Step 3: Model receives notify result and outputs final verified report
      console.log('[MODEL] Langkah 3: Semua data lengkap. Menyusun luaran akhir.');
      return {
        content:
          'Laporan Selesai: Layanan backend Fastify dan worker BullMQ aktif normal di Oracle Cloud VPS, dan notifikasi telah berhasil terkirim ke pemangku kepentingan.',
      };
    },
  });

  const executor = new TaskExecutor(repo, broadcaster as any, {
    modelGateway: gateway,
    registry,
    guard,
    approvalCreator,
    defaultModel: 'anthropic/claude-3-5-sonnet',
  });

  console.log('[1/4] Membuat Task Generik...');
  const { task } = await repo.createTask({
    userId: 'user-live-8',
    projectId: 'proj-live-8',
    kind: 'generic_task',
    payload: {
      prompt: 'Periksa status backend Fastify dan kirimkan notifikasi publikasi status operasional',
      acceptanceCriteria: [
        {
          id: 'status_backend',
          description: 'Layanan backend Fastify dan worker BullMQ aktif normal',
          category: 'generic',
          required: true,
        },
        {
          id: 'notifikasi_terkirim',
          description: 'notifikasi telah berhasil terkirim',
          category: 'generic',
          required: true,
        },
      ],
    },
  });

  console.log(`[2/4] Menjalankan Task (${task.id}) - Iterasi Pertama...`);
  await executor.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  let taskState = await repo.getTask(task.userId, task.id);
  console.log(`\n>> Status Task Setelah Eksekusi Pertama: ${taskState?.status}`);
  console.log(`>> Checkpoint Action: ${taskState?.checkpoint?.lastExecutedAction}`);
  console.log(`>> Pending Approval ID: ${taskState?.checkpoint?.actionState?.approvalId}\n`);

  if (taskState?.status === 'waiting_approval') {
    console.log('[3/4] Memberikan Persetujuan Pengguna (Approval Granted)...');
    taskState.status = 'running';
    taskState.checkpoint.actionState.approved = true;
    await repo.updateTaskStatus(task.userId, task.id, 'running');
    await repo.updateTaskProgress(task.userId, task.id, 50, taskState.checkpoint);

    console.log('[4/4] Melanjutkan Task Dari Checkpoint...');
    await executor.execute({
      taskId: task.id,
      userId: task.userId,
      projectId: task.projectId,
      kind: task.kind,
      attempt: 1,
      maxAttempts: 3,
    });
  }

  const finalTask = await repo.getTask(task.userId, task.id);
  const completedEvent = repo.events.find((e) => e.eventType === 'task.completed');

  console.log('\n================================================================');
  console.log('  HASIL AKHIR EKSEKUSI GENERIK:');
  console.log('================================================================');
  console.log(`Status Akhir: ${finalTask?.status}`);
  console.log(`Ringkasan Luaran: ${finalTask?.artifacts?.[0]?.content}`);
  console.log('\nevaluationResult:');
  console.log(JSON.stringify(completedEvent?.payload?.evaluationResult, null, 2));

  console.log('\nTelemetry:');
  console.log(JSON.stringify(completedEvent?.payload?.telemetry, null, 2));

  console.log('\nBaris Audit Logs (Permission Engine):');
  console.table(auditLogs);
  console.log('================================================================\n');
}

runLiveScript().catch((err) => {
  console.error('Eksekusi gagal:', err);
  process.exit(1);
});
