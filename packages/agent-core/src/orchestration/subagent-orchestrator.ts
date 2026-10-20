import { resolve } from 'node:path';
import {
  type TaskRecord,
  type TaskRepository,
  TaskStateMachine,
} from '@personal-ai-os/shared';
import { GenericEvaluator, type AcceptanceCriterion, type GenericEvidence } from '@personal-ai-os/evaluator';
import type {
  ParentOrchestrationSummary,
  ParentTaskPayload,
  SubagentExecutionResult,
  SubagentOrchestratorConfig,
  SubagentPlanItem,
} from './subagent-types.ts';

export const DEFAULT_MAX_DELEGATION_DEPTH = 1;
export const DEFAULT_MAX_CHILDREN_PER_PARENT = 5;
export const DEFAULT_ORCHESTRATION_CONCURRENCY = 2; // Konservatif untuk VPS ARM64 2 OCPU / 12 GB RAM

export class SubagentOrchestrator {
  private readonly taskRepo: TaskRepository;
  private readonly taskQueue: SubagentOrchestratorConfig['taskQueue'];
  private readonly broadcaster: SubagentOrchestratorConfig['broadcaster'];
  private readonly codingWorkspaceRoot: string;
  private readonly defaultMaxDepth: number;
  private readonly defaultMaxChildren: number;
  private readonly defaultConcurrency: number;
  private readonly evaluator = new GenericEvaluator();

  constructor(config: SubagentOrchestratorConfig) {
    this.taskRepo = config.taskRepo;
    this.taskQueue = config.taskQueue;
    this.broadcaster = config.broadcaster;
    this.codingWorkspaceRoot = config.codingWorkspaceRoot ?? 'data/workspaces';
    this.defaultMaxDepth = config.defaultMaxDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
    this.defaultMaxChildren = config.defaultMaxChildren ?? DEFAULT_MAX_CHILDREN_PER_PARENT;
    this.defaultConcurrency = config.defaultConcurrency ?? DEFAULT_ORCHESTRATION_CONCURRENCY;
  }

  /**
   * Memvalidasi batas delegasi dan batas jumlah child task sebelum eksekusi.
   */
  validatePlan(parentTask: TaskRecord, payload: ParentTaskPayload): void {
    const currentDepth = payload.currentDepth ?? 0;
    const maxDepth = payload.maxDelegationDepth ?? this.defaultMaxDepth;

    if (currentDepth >= maxDepth) {
      throw new Error(
        `Batas kedalaman delegasi (maksimum kedalaman ${maxDepth}) telah tercapai pada task '${parentTask.id}'. Spawning subagent ditolak untuk mencegah loop rekursif tanpa batas.`,
      );
    }

    const maxChildren = payload.maxChildren ?? this.defaultMaxChildren;
    if (payload.childPlan.length > maxChildren) {
      throw new Error(
        `Jumlah child task (${payload.childPlan.length}) melebihi batas maksimum per parent (${maxChildren}). Delegasi ditolak demi batas sumber daya VPS.`,
      );
    }

    if (payload.childPlan.length === 0) {
      throw new Error('Rencana child task kosong. Minimal 1 child task diperlukan.');
    }
  }

  /**
   * Menyiapkan dan menyimpan child tasks durable di PostgreSQL dengan idempotency key.
   * Tidak akan menduplikasi pembuatan child task jika worker restart atau re-delivery queue.
   */
  async prepareChildTasks(
    parentTask: TaskRecord,
    payload: ParentTaskPayload,
  ): Promise<TaskRecord[]> {
    this.validatePlan(parentTask, payload);

    const currentDepth = payload.currentDepth ?? 0;
    const childDepth = currentDepth + 1;
    const parentWorkspace = payload.workspaceRoot ?? this.codingWorkspaceRoot;

    // 1. Ambil child task yang sudah ada untuk mendeteksi recovery / resume
    const existingChildren = await this.listExistingChildTasks(parentTask.userId, parentTask.id);
    const existingByKey = new Map<string, TaskRecord>();
    for (const child of existingChildren) {
      if (child.idempotencyKey) {
        existingByKey.set(child.idempotencyKey, child);
      }
    }

    const preparedChildren: TaskRecord[] = [];

    // 2. Iterasi plan item dan buat task durable jika belum ada
    for (let i = 0; i < payload.childPlan.length; i++) {
      const planItem = payload.childPlan[i]!;
      const idempotencyKey = `${parentTask.id}-child-${planItem.id}`;

      const existing = existingByKey.get(idempotencyKey);
      if (existing) {
        preparedChildren.push(existing);
        continue;
      }

      // Isolasi workspace per child task (Rule 4)
      const isolatedWorkspace = resolve(
        parentWorkspace,
        'children',
        parentTask.id,
        planItem.id,
      );

      // Least privilege: hilangkan secret dan memory personal dari payload child (Rule 7)
      const sanitizedChildPayload: Record<string, unknown> = {
        ...(planItem.payload ?? {}),
        parentTaskId: parentTask.id,
        planItemId: planItem.id,
        goal: planItem.goal,
        name: planItem.name,
        capabilityAllowlist: planItem.capabilityAllowlist,
        assignedRuntime: planItem.assignedRuntime ?? 'native',
        workspace: isolatedWorkspace,
        timeoutMs: planItem.timeoutMs ?? payload.timeoutMs ?? 30000,
        required: planItem.required ?? true,
        currentDepth: childDepth,
        maxDelegationDepth: payload.maxDelegationDepth ?? this.defaultMaxDepth,
      };

      // Pastikan secrets dan userProfile TIDAK diteruskan
      delete sanitizedChildPayload['secrets'];
      delete sanitizedChildPayload['userProfile'];
      delete sanitizedChildPayload['privateKeys'];

      const taskKind =
        planItem.kind === 'coding'
          ? 'coding_task'
          : planItem.kind === 'research'
            ? 'research_task'
            : 'generic_task';

      const created = await this.taskRepo.createTask({
        userId: parentTask.userId,
        projectId: parentTask.projectId,
        kind: taskKind,
        payload: sanitizedChildPayload,
        conversationId: parentTask.conversationId,
        parentTaskId: parentTask.id,
        idempotencyKey,
        priority: parentTask.priority,
      });

      preparedChildren.push(created.task);

      // Pancarkan event host terstruktur untuk subagent durable (Rule 9)
      if (this.broadcaster) {
        this.broadcaster.publish({
          id: `subagent-spawned-${created.task.id}`,
          taskId: parentTask.id,
          userId: parentTask.userId,
          eventType: 'subagent.spawned',
          payload: {
            parentTaskId: parentTask.id,
            childTaskId: created.task.id,
            planItemId: planItem.id,
            kind: planItem.kind,
            capabilityAllowlist: planItem.capabilityAllowlist,
            workspace: isolatedWorkspace,
            currentDepth: childDepth,
          },
          createdAt: new Date().toISOString(),
        });
      }
    }

    return preparedChildren;
  }

  /**
   * Mendaftarkan child tasks ke queue BullMQ (atau TaskQueue) tanpa in-memory queue baru (Rule 3).
   */
  async enqueueChildTasks(children: TaskRecord[]): Promise<void> {
    if (!this.taskQueue) return;

    for (const child of children) {
      if (child.status === 'queued') {
        await this.taskQueue.enqueue(child);
      }
    }
  }

  /**
   * Meneruskan pembatalan parent ke seluruh child task aktif (Rule 8).
   */
  async cascadeCancellation(parentTaskId: string, userId: string): Promise<number> {
    const children = await this.listExistingChildTasks(userId, parentTaskId);
    let cancelledCount = 0;

    for (const child of children) {
      if (!TaskStateMachine.isTerminal(child.status)) {
        if (this.taskQueue?.cancel) {
          try {
            await this.taskQueue.cancel(child.id);
          } catch {
            // Best effort queue cancel
          }
        }

        await this.taskRepo.updateTaskStatus(userId, child.id, 'cancelled', {
          error: 'Dibatalkan secara kaskade karena parent task dibatalkan.',
        });

        cancelledCount++;

        if (this.broadcaster) {
          this.broadcaster.publish({
            id: `subagent-cancelled-${child.id}`,
            taskId: parentTaskId,
            userId,
            eventType: 'subagent.cancelled',
            payload: {
              parentTaskId,
              childTaskId: child.id,
              reason: 'parent_cancelled',
            },
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    return cancelledCount;
  }

  /**
   * Mengumpulkan dan mengevaluasi hasil eksekusi seluruh child task.
   * Summary child diperlakukan sebagai UNTRUSTED (Rule 11).
   * Status parent jujur terhadap kegagalan child (Rule 8).
   */
  async aggregateResults(
    parentTask: TaskRecord,
    planItems: SubagentPlanItem[],
  ): Promise<ParentOrchestrationSummary> {
    const children = await this.listExistingChildTasks(parentTask.userId, parentTask.id);
    const planItemMap = new Map<string, SubagentPlanItem>(planItems.map((p) => [p.id, p]));

    const childrenResults: SubagentExecutionResult[] = [];
    const untrustedSummaries: Array<{ childTaskId: string; summary: string }> = [];
    const allConcreteArtifacts: Array<{ title: string; content?: string }> = [];

    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let requiredChildFailed = false;

    for (const child of children) {
      const planItemId = (child.payload?.planItemId as string) ?? child.id;
      const planConfig = planItemMap.get(planItemId);
      const isRequired = planConfig?.required ?? (child.payload?.required as boolean) ?? true;

      const rawSummary =
        (child.payload?.resultSummary as string) ??
        (child.payload?.summary as string) ??
        child.error ??
        '';

      // Tandai summary child sebagai untrusted content (Rule 11)
      if (rawSummary) {
        untrustedSummaries.push({ childTaskId: child.id, summary: rawSummary });
      }

      const childArtifacts = Array.isArray(child.artifacts)
        ? (child.artifacts as Array<{ id: string; title: string; content?: string }>)
        : [];

      for (const art of childArtifacts) {
        allConcreteArtifacts.push(
          art.content !== undefined
            ? { title: art.title, content: art.content }
            : { title: art.title },
        );
      }

      let status: 'completed' | 'failed' | 'cancelled' = 'failed';
      if (child.status === 'completed') {
        status = 'completed';
        completedCount++;
      } else if (child.status === 'cancelled') {
        status = 'cancelled';
        cancelledCount++;
        if (isRequired) {
          requiredChildFailed = true;
        }
      } else {
        status = 'failed';
        failedCount++;
        if (isRequired) {
          requiredChildFailed = true;
        }
      }

      childrenResults.push({
        childTaskId: child.id,
        planItemId,
        kind: child.kind,
        status,
        summary: rawSummary,
        artifacts: childArtifacts,
        error: child.error ?? undefined,
        isolatedWorkspace: child.payload?.workspace as string | undefined,
        startedAt: child.startedAt,
        finishedAt: child.finishedAt,
      });
    }

    // Evaluator memverifikasi bukti nyata / artifacts (Rule 11)
    const successCriteria: AcceptanceCriterion[] = (
      (parentTask.payload?.successCriteria as string[]) ?? ['Semua child task selesai dengan artefak valid']
    ).map((desc, idx) => ({
      id: `criterion-${idx + 1}`,
      description: desc,
      category: 'generic',
      required: true,
      expectedEvidenceType: 'artifact',
    }));

    const evidence: GenericEvidence = {
      artifacts: allConcreteArtifacts,
      logs: childrenResults.map((r) => `Child ${r.childTaskId} (${r.planItemId}): ${r.status}`),
    };

    const evalResult = this.evaluator.evaluate(successCriteria, evidence);

    // Tentukan status keseluruhan parent secara jujur (Rule 8)
    let finalStatus: 'completed' | 'partial_failure' | 'failed' | 'cancelled';
    if (cancelledCount > 0 && completedCount === 0 && failedCount === 0) {
      finalStatus = 'cancelled';
    } else if (requiredChildFailed) {
      finalStatus = completedCount > 0 ? 'partial_failure' : 'failed';
    } else if (completedCount === children.length && evalResult.passed) {
      finalStatus = 'completed';
    } else if (completedCount > 0) {
      finalStatus = 'partial_failure';
    } else {
      finalStatus = 'failed';
    }

    return {
      parentTaskId: parentTask.id,
      status: finalStatus,
      totalChildren: children.length,
      completedChildren: completedCount,
      failedChildren: failedCount,
      cancelledChildren: cancelledCount,
      childrenResults,
      untrustedSummaries,
      verifiedArtifactsCount: allConcreteArtifacts.length,
      evaluationPassed: evalResult.passed,
      notes: evalResult.remainingIssues.length > 0 ? evalResult.remainingIssues.join('; ') : undefined,
    };
  }

  private async listExistingChildTasks(userId: string, parentTaskId: string): Promise<TaskRecord[]> {
    if (this.taskRepo.listChildTasks) {
      return this.taskRepo.listChildTasks(userId, parentTaskId);
    }
    return this.taskRepo.listTasks(userId, { parentTaskId });
  }

  /**
   * Meninjau hasil coding child task sebelum digabungkan ke parent / branch utama.
   * Auto-merge ke main, push ke remote, atau deployment otomatis DILARANG KERAS (Rule 10).
   */
  reviewCodingMergePolicy(params: {
    childTaskId: string;
    diffAvailable: boolean;
    testsPassed: boolean;
    lintPassed: boolean;
    targetBranch?: string | undefined;
    action?: 'merge' | 'push' | 'deploy' | undefined;
  }): {
    allowed: boolean;
    requiresApproval: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reason: string;
    autoMergeBlocked: boolean;
  } {
    if (params.action === 'push' || params.action === 'deploy') {
      return {
        allowed: false,
        requiresApproval: true,
        riskLevel: 'HIGH',
        reason: 'Aksi git push atau deploy ke remote tidak boleh dilakukan otomatis tanpa persetujuan eksplisit pemilik (Rule 7 & 10).',
        autoMergeBlocked: true,
      };
    }

    if (!params.diffAvailable) {
      return {
        allowed: false,
        requiresApproval: false,
        riskLevel: 'MEDIUM',
        reason: 'Penggabungan kode ditolak: tidak ada diff perubahan yang dapat diverifikasi.',
        autoMergeBlocked: true,
      };
    }

    if (!params.testsPassed || !params.lintPassed) {
      return {
        allowed: false,
        requiresApproval: false,
        riskLevel: 'MEDIUM',
        reason: 'Penggabungan kode ditolak: pengujian (test/lint) pada workspace child gagal.',
        autoMergeBlocked: true,
      };
    }

    const isMainBranch = params.targetBranch === 'main' || params.targetBranch === 'master';
    if (isMainBranch) {
      return {
        allowed: false,
        requiresApproval: true,
        riskLevel: 'HIGH',
        reason: 'Auto-merge langsung ke branch utama (main) dilarang. Diperlukan review persetujuan manual pemilik.',
        autoMergeBlocked: true,
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      riskLevel: 'MEDIUM',
      reason: 'Diff terverifikasi dan test lulus pada branch kerja terisolasi.',
      autoMergeBlocked: false,
    };
  }
}
