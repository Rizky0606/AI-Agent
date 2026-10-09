import {
  ApprovalRequiredError,
  PermissionDeniedError,
  type RiskLevel,
  type SecuredCapabilityGuard,
} from '@personal-ai-os/permissions';
import {
  createVersionedCheckpoint,
  defaultTracer,
  verifyCheckpointIntegrity,
  verifyStepBeforeExternalAction,
  type TaskEventEnvelope,
  type TaskRecord,
  type TaskRepository,
} from '@personal-ai-os/shared';
import {
  CodingEvaluator,
  GenericEvaluator,
  ResearchEvaluator,
  type AcceptanceCriterion,
  type CodingEvidence,
  type ResearchEvidence,
} from '@personal-ai-os/evaluator';
import type { ToolRegistry } from '@personal-ai-os/tools';

export const PLACEHOLDER_WORKER_LABEL =
  '[PLACEHOLDER_GENERIC_WORKER] Eksekusi simulasi langkah task untuk fondasi runtime. Belum memanggil tool sistem sesungguhnya.';

export interface EventPublisher {
  publish(event: TaskEventEnvelope): void;
}

export interface TaskJobData {
  taskId: string;
  userId: string;
  projectId: string;
  kind: string;
  attempt: number;
  maxAttempts: number;
}

export interface TaskQueueEnqueuer {
  enqueue(task: TaskRecord): Promise<void>;
}

export interface ApprovalCreatorParams {
  userId: string;
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  consequence: string;
  fingerprint: string;
  expiresInSeconds?: number | undefined;
}

export interface TaskExecutorOptions {
  guard?: SecuredCapabilityGuard | undefined;
  approvalCreator?: ((params: ApprovalCreatorParams) => Promise<{ id: string }>) | undefined;
  deviceManager?:
    { hasOnlineDeviceForUser: (userId: string, platform?: string) => boolean } | undefined;
  registry?: ToolRegistry | undefined;
}

export class TaskExecutor {
  private readonly taskRepo: TaskRepository;
  private readonly broadcaster: EventPublisher;
  private readonly guard?: SecuredCapabilityGuard | undefined;
  private readonly approvalCreator?:
    ((params: ApprovalCreatorParams) => Promise<{ id: string }>) | undefined;
  private readonly deviceManager?:
    { hasOnlineDeviceForUser: (userId: string, platform?: string) => boolean } | undefined;
  private readonly registry?: ToolRegistry | undefined;

  constructor(
    taskRepo: TaskRepository,
    broadcaster: EventPublisher,
    options?: TaskExecutorOptions,
  ) {
    this.taskRepo = taskRepo;
    this.broadcaster = broadcaster;
    this.guard = options?.guard;
    this.approvalCreator = options?.approvalCreator;
    this.deviceManager = options?.deviceManager;
    this.registry = options?.registry;
  }

  async execute(job: TaskJobData): Promise<void> {
    const span = defaultTracer.startSpan('task_execution', 'task_execution', {
      attributes: {
        'task.id': job.taskId,
        'user.id': job.userId,
        'task.kind': job.kind,
        'task.attempt': job.attempt,
      },
    });

    const task = await this.taskRepo.getTask(job.userId, job.taskId);
    if (!task) {
      defaultTracer.endSpan(span, { status: 'error', errorMessage: 'Task not found' });
      return;
    }

    // Check if task is already in non-runnable state
    if (task.status === 'cancelled' || task.status === 'completed' || task.status === 'paused') {
      defaultTracer.endSpan(span, { status: 'ok', attributes: { 'task.status': task.status } });
      return;
    }

    // Check offline Windows agent constraint
    const isWindowsTarget =
      task.payload?.['target'] === 'windows' ||
      task.payload?.['platform'] === 'windows' ||
      task.kind.startsWith('windows');

    if (isWindowsTarget) {
      const isOnline = this.deviceManager?.hasOnlineDeviceForUser(task.userId, 'windows') ?? false;
      if (!isOnline) {
        const reason =
          'Windows Agent sedang offline: tidak ada perangkat Windows yang terhubung untuk menjalankan task ini.';
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
          error: reason,
        });
        const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
          error: reason,
          offlineReason: 'device_unreachable',
          platform: 'windows',
          retryable: true,
        });
        this.broadcaster.publish(failEvent);
        return;
      }
    }

    const currentAttempt = task.attempt + 1;
    const lastCheckpoint = task.checkpoint;
    // Verify last step before repeating actions (Durability / Idempotency of steps)
    const startStep = lastCheckpoint ? lastCheckpoint.stepIndex + 1 : 1;
    let currentCheckpointVersion = task.checkpoint?.version ?? 0;

    try {
      // 1. Move to planning if in queued
      if (task.status === 'queued') {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'planning', {
          attempt: currentAttempt,
        });

        const startEvent = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.started',
          {
            attempt: currentAttempt,
            startStep,
            resumedFromCheckpoint: Boolean(lastCheckpoint),
            placeholder: true,
            note: PLACEHOLDER_WORKER_LABEL,
          },
        );
        this.broadcaster.publish(startEvent);
      }

      // Ensure state is running when starting/resuming steps
      const currentStatusCheck = await this.taskRepo.getTask(task.userId, task.id);
      if (currentStatusCheck && currentStatusCheck.status === 'planning') {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'running');
      }

      // Step 1: Plan Analysis
      if (startStep <= 1) {
        if (await this.isHalted(task.userId, task.id)) return;

        currentCheckpointVersion++;
        const cp1 = createVersionedCheckpoint({
          version: currentCheckpointVersion,
          stepIndex: 1,
          totalSteps: 4,
          lastExecutedAction: 'plan_analysis',
          actionType: 'internal',
          verified: true,
        });
        await this.taskRepo.updateTaskProgress(task.userId, task.id, 25, cp1);

        const progEvent1 = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.progress',
          {
            progress: 25,
            step: 1,
            action: 'plan_analysis',
            placeholder: true,
          },
        );
        this.broadcaster.publish(progEvent1);
      }

      // Step 2: Tool Call Execution (Secured via Permission Engine)
      if (startStep <= 2) {
        if (await this.isHalted(task.userId, task.id)) return;

        const actionName = (task.payload?.action as string) ?? 'tool:search_knowledge';
        const resourceName = (task.payload?.resource as string) ?? 'knowledge://personal-ai-os';
        const scopeName = (task.payload?.scope as string) ?? 'workspace';
        const approvedApprovalId =
          (task.checkpoint?.actionState?.approvalId as string) ?? undefined;

        // Verify last step before executing external action
        const isExternal = actionName.startsWith('tool:') || actionName.startsWith('external:');
        const verification = verifyStepBeforeExternalAction(task.checkpoint, {
          name: actionName,
          isExternal,
        });
        if (!verification.canProceed && verification.requiresVerification) {
          const verifyNotice = await this.taskRepo.createTaskEvent(
            task.userId,
            task.id,
            'task.progress',
            {
              step: 2,
              action: 'verify_last_step',
              reason: verification.reason,
            },
          );
          this.broadcaster.publish(verifyNotice);
        }

        if (this.guard) {
          try {
            await this.guard.executeProtected(
              {
                actor: { id: task.userId, isAutomated: true },
                action: actionName,
                resource: resourceName,
                scope: scopeName,
                context: task.payload,
              },
              async () => {
                // Actual simulated execution of capability
                return { matchCount: 3, summary: 'Found relevant specifications' };
              },
              { approvalId: approvedApprovalId },
            );
          } catch (guardErr) {
            if (guardErr instanceof ApprovalRequiredError) {
              let approvalId = 'appr-pending';
              if (this.approvalCreator) {
                const createdApproval = await this.approvalCreator({
                  userId: task.userId,
                  taskId: task.id,
                  projectId: task.projectId,
                  action: guardErr.requiredApproval.action,
                  resource: guardErr.requiredApproval.resource,
                  scope: guardErr.requiredApproval.scope,
                  riskLevel: guardErr.requiredApproval.riskLevel,
                  consequence: guardErr.requiredApproval.consequence,
                  fingerprint: guardErr.requiredApproval.fingerprint,
                  expiresInSeconds: 3600,
                });
                approvalId = createdApproval.id;
              }

              currentCheckpointVersion++;
              const cpWait = createVersionedCheckpoint({
                version: currentCheckpointVersion,
                stepIndex: 2,
                totalSteps: 4,
                lastExecutedAction: 'waiting_approval',
                actionType: 'approval',
                actionState: { approvalId },
                verified: true,
              });
              await this.taskRepo.updateTaskProgress(task.userId, task.id, 50, cpWait);
              await this.taskRepo.updateTaskStatus(task.userId, task.id, 'waiting_approval');

              const approvalEvent = await this.taskRepo.createTaskEvent(
                task.userId,
                task.id,
                'task.waiting_approval',
                {
                  approvalId,
                  action: guardErr.requiredApproval.action,
                  riskLevel: guardErr.requiredApproval.riskLevel,
                  consequence: guardErr.requiredApproval.consequence,
                  fingerprint: guardErr.requiredApproval.fingerprint,
                  placeholder: true,
                  note: PLACEHOLDER_WORKER_LABEL,
                },
              );
              this.broadcaster.publish(approvalEvent);
              return; // Halt until approved
            }

            if (guardErr instanceof PermissionDeniedError) {
              await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
                error: guardErr.message,
              });
              const failEvent = await this.taskRepo.createTaskEvent(
                task.userId,
                task.id,
                'task.failed',
                {
                  error: guardErr.message,
                  riskLevel: guardErr.riskLevel,
                  retryable: false,
                },
              );
              this.broadcaster.publish(failEvent);
              return;
            }

            throw guardErr;
          }
        }

        let toolOutput: unknown = { matchCount: 3, summary: 'Found relevant specifications' };
        let isPlaceholder = true;

        if (this.registry && typeof task.payload?.toolName === 'string') {
          const res = await this.registry.executeTool({
            toolName: task.payload.toolName,
            input: task.payload.toolInput ?? {},
            context: {
              actor: { id: task.userId, role: 'user' },
              taskId: task.id,
              projectId: task.projectId,
            },
            approvalId: (task.payload?.approvalId as string) ?? undefined,
          });
          toolOutput = res.data;
          isPlaceholder = false;
        }

        const toolEvent = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.tool_call',
          {
            tool: (task.payload?.toolName as string) ?? actionName,
            input: task.payload?.toolInput ?? { query: 'runtime architecture specs' },
            output: toolOutput,
            placeholder: isPlaceholder,
            note: isPlaceholder ? PLACEHOLDER_WORKER_LABEL : undefined,
          },
        );
        this.broadcaster.publish(toolEvent);

        currentCheckpointVersion++;
        const cp2 = createVersionedCheckpoint({
          version: currentCheckpointVersion,
          stepIndex: 2,
          totalSteps: 4,
          lastExecutedAction: `tool_call:${(task.payload?.toolName as string) ?? actionName}`,
          actionType: 'external_tool',
          actionState: { toolResult: toolOutput },
          verified: true,
        });
        await this.taskRepo.updateTaskProgress(task.userId, task.id, 50, cp2);

        const progEvent2 = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.progress',
          {
            progress: 50,
            step: 2,
            action: `tool_call:${actionName}`,
            placeholder: true,
          },
        );
        this.broadcaster.publish(progEvent2);
      }

      // Step 3: Approval Check (Fallback/explicit payload flag check)
      if (startStep <= 3) {
        if (await this.isHalted(task.userId, task.id)) return;

        if (task.payload?.requiresApproval === true && !task.checkpoint?.actionState?.approved) {
          currentCheckpointVersion++;
          const cp3 = createVersionedCheckpoint({
            version: currentCheckpointVersion,
            stepIndex: 3,
            totalSteps: 4,
            lastExecutedAction: 'waiting_approval',
            actionType: 'approval',
            verified: true,
          });
          await this.taskRepo.updateTaskProgress(task.userId, task.id, 75, cp3);
          await this.taskRepo.updateTaskStatus(task.userId, task.id, 'waiting_approval');

          const approvalEvent = await this.taskRepo.createTaskEvent(
            task.userId,
            task.id,
            'task.waiting_approval',
            {
              action: 'apply_policy_changes',
              reason: 'Tindakan memerlukan persetujuan eksplisit pengguna.',
              placeholder: true,
              note: PLACEHOLDER_WORKER_LABEL,
            },
          );
          this.broadcaster.publish(approvalEvent);
          return; // Stop and wait for approval
        }
      }

      // Step 4: Finalize Artifacts & Complete
      if (startStep <= 4) {
        if (await this.isHalted(task.userId, task.id)) return;

        // EVALUATOR GATE: "Agent tidak boleh menyatakan selesai berdasarkan klaimnya sendiri."
        const isCodingTask =
          task.kind.startsWith('coding') ||
          task.payload?.category === 'coding' ||
          task.payload?.type === 'coding';

        const isResearchTask =
          task.kind.startsWith('research') ||
          task.payload?.category === 'research' ||
          task.payload?.type === 'research';

        if (isCodingTask) {
          const codingEvaluator = new CodingEvaluator();
          const codingEvidence: CodingEvidence = (task.payload?.codingEvidence as CodingEvidence) ??
            (task.payload?.evidence as CodingEvidence) ?? {
              selfClaimOnly: task.payload?.selfClaimOnly === true,
            };
          const evalResult = codingEvaluator.evaluate(codingEvidence);
          if (!evalResult.passed) {
            const reason =
              evalResult.completionBlockedReason ??
              evalResult.remainingIssues[0] ??
              'Coding evaluator menolak penyelesaian tanpa bukti.';
            await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
              error: reason,
            });
            const failEvent = await this.taskRepo.createTaskEvent(
              task.userId,
              task.id,
              'task.failed',
              {
                error: reason,
                evaluationResult: evalResult,
                retryable: false,
              },
            );
            this.broadcaster.publish(failEvent);
            return;
          }
        } else if (isResearchTask) {
          const researchEvaluator = new ResearchEvaluator();
          const researchEvidence: ResearchEvidence = (task.payload
            ?.researchEvidence as ResearchEvidence) ??
            (task.payload?.evidence as ResearchEvidence) ?? {
              selfClaimOnly: task.payload?.selfClaimOnly === true,
              sources: [],
              claims: [],
            };
          const evalResult = researchEvaluator.evaluate(researchEvidence);
          if (!evalResult.passed) {
            const reason =
              evalResult.completionBlockedReason ??
              evalResult.remainingIssues[0] ??
              'Research evaluator menolak penyelesaian tanpa bukti sumber.';
            await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
              error: reason,
            });
            const failEvent = await this.taskRepo.createTaskEvent(
              task.userId,
              task.id,
              'task.failed',
              {
                error: reason,
                evaluationResult: evalResult,
                retryable: false,
              },
            );
            this.broadcaster.publish(failEvent);
            return;
          }
        } else {
          const genericEvaluator = new GenericEvaluator();
          const criteria: AcceptanceCriterion[] = (task.payload
            ?.acceptanceCriteria as AcceptanceCriterion[]) ?? [
            {
              id: 'task_output',
              description: 'Menghasilkan artefak output task yang valid',
              category: 'generic',
              required: true,
              expectedEvidenceType: 'artifact',
            },
          ];

          const isSelfClaimOnly = task.payload?.selfClaimOnly === true;
          const evalResult = genericEvaluator.evaluate(criteria, {
            artifacts: isSelfClaimOnly
              ? []
              : [
                  {
                    title: 'Generic Task Output',
                    content: 'Simulasi generic task berhasil diselesaikan.',
                  },
                ],
            outputs: isSelfClaimOnly ? {} : { result: 'ok', matchCount: 3 },
            logs: isSelfClaimOnly ? [] : ['Task execution finished successfully'],
          });

          if (!evalResult.passed) {
            const reason =
              evalResult.completionBlockedReason ??
              evalResult.remainingIssues[0] ??
              'Generic evaluator menolak klaim selesai.';
            await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
              error: reason,
            });
            const failEvent = await this.taskRepo.createTaskEvent(
              task.userId,
              task.id,
              'task.failed',
              {
                error: reason,
                evaluationResult: evalResult,
                retryable: false,
              },
            );
            this.broadcaster.publish(failEvent);
            return;
          }
        }

        currentCheckpointVersion++;
        const cp4 = createVersionedCheckpoint({
          version: currentCheckpointVersion,
          stepIndex: 4,
          totalSteps: 4,
          lastExecutedAction: 'complete_task',
          actionType: 'internal',
          verified: true,
        });
        await this.taskRepo.updateTaskProgress(task.userId, task.id, 100, cp4);

        const artifacts = [
          {
            id: 'artifact-summary',
            type: 'summary',
            title: 'Generic Task Output',
            content: 'Simulasi generic task berhasil diselesaikan.',
            placeholder: true,
            note: PLACEHOLDER_WORKER_LABEL,
          },
        ];

        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'completed', {
          artifacts,
        });

        const completeEvent = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.completed',
          {
            result: 'Task completed successfully',
            artifacts,
            placeholder: true,
            note: PLACEHOLDER_WORKER_LABEL,
          },
        );
        this.broadcaster.publish(completeEvent);
        defaultTracer.endSpan(span, { status: 'ok' });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      defaultTracer.endSpan(span, { status: 'error', errorMessage: errorMsg });
      defaultTracer.recordError({
        service: 'agent-worker',
        errorType: 'task_execution_error',
        message: errorMsg,
        taskId: task.id,
        timestamp: Date.now(),
      });
      const isRetryable = currentAttempt < task.maxAttempts;

      if (isRetryable) {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
          error: errorMsg,
          attempt: currentAttempt,
        });
        const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
          error: errorMsg,
          retryable: true,
          attempt: currentAttempt,
          maxAttempts: task.maxAttempts,
        });
        this.broadcaster.publish(failEvent);
      } else {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
          error: errorMsg,
          attempt: currentAttempt,
        });
        const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
          error: errorMsg,
          retryable: false,
          attempt: currentAttempt,
          maxAttempts: task.maxAttempts,
        });
        this.broadcaster.publish(failEvent);
      }
      throw err;
    }
  }

  async recoverInterruptedTasks(
    queue?: TaskQueueEnqueuer,
  ): Promise<{ recoveredCount: number; recoveredTasks: TaskRecord[] }> {
    const dangling = await this.taskRepo.getDanglingRunningTasks();
    const recoveredTasks: TaskRecord[] = [];

    for (const task of dangling) {
      const isIntegrityValid = task.checkpoint ? verifyCheckpointIntegrity(task.checkpoint) : true;
      const lastStep = task.checkpoint?.stepIndex ?? 0;
      const resumeEvent = await this.taskRepo.createTaskEvent(
        task.userId,
        task.id,
        'task.resumed',
        {
          recoveredAfterRestart: true,
          checkpointVersion: task.checkpoint?.version ?? 1,
          checkpointIntegrityValid: isIntegrityValid,
          lastVerifiedStep: lastStep,
          resumingFromStep: lastStep + 1,
          note: 'Task dipulihkan setelah worker restart; melanjutkan dari checkpoint terakhir.',
        },
      );
      this.broadcaster.publish(resumeEvent);

      if (queue) {
        await queue.enqueue(task);
      }
      recoveredTasks.push(task);
    }

    return { recoveredCount: recoveredTasks.length, recoveredTasks };
  }

  private async isHalted(userId: string, taskId: string): Promise<boolean> {
    const task = await this.taskRepo.getTask(userId, taskId);
    if (!task) return true;
    return task.status === 'cancelled' || task.status === 'paused';
  }
}
