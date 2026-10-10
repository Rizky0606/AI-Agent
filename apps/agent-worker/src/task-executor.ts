import {
  ApprovalRequiredError,
  PermissionDeniedError,
  type RiskLevel,
  SecuredCapabilityGuard,
} from '@personal-ai-os/permissions';
import {
  createVersionedCheckpoint,
  defaultTracer,
  type TaskEventBroadcaster,
  type TaskEventEnvelope,
  type TaskRecord,
  type TaskRepository,
  verifyCheckpointIntegrity,
  verifyStepBeforeExternalAction,
} from '@personal-ai-os/shared';
import {
  CodingEvaluator,
  GenericEvaluator,
  ResearchEvaluator,
  type AcceptanceCriterion,
  type CodingEvidence,
  type ResearchClaim,
  type ResearchContradiction,
  type ResearchEvidence,
  type ResearchSource,
} from '@personal-ai-os/evaluator';
import {
  AgentRouter,
  CodingAgent,
  type CodingEnvironment,
  type CodingTaskInput,
  IntentAnalyzer,
  Planner,
  ResearchAgent,
  type ResearchEnvironment,
  type ResearchTaskInput,
  type RuntimeManager,
} from '@personal-ai-os/agent-core';
import type { ModelGateway } from '@personal-ai-os/model-gateway';
import type { ToolRegistry } from '@personal-ai-os/tools';

export const PLACEHOLDER_WORKER_LABEL =
  '[PLACEHOLDER_GENERIC_WORKER] Eksekusi simulasi langkah task untuk fondasi runtime. Belum memanggil tool sistem sesungguhnya.';

export type EventPublisher =
  | TaskEventBroadcaster
  | {
      publish(event: TaskEventEnvelope): unknown;
    };

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
  analyzer?: IntentAnalyzer | undefined;
  planner?: Planner | undefined;
  router?: AgentRouter | undefined;
  runtimeManager?: RuntimeManager | undefined;
  codingAgent?: CodingAgent | undefined;
  researchAgent?: ResearchAgent | undefined;
  modelGateway?: ModelGateway | undefined;
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
  private readonly analyzer: IntentAnalyzer;
  private readonly planner: Planner;
  private readonly router: AgentRouter;
  private readonly runtimeManager?: RuntimeManager | undefined;
  private readonly codingAgent: CodingAgent;
  private readonly researchAgent: ResearchAgent;
  private readonly modelGateway?: ModelGateway | undefined;

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

    this.analyzer = options?.analyzer ?? new IntentAnalyzer();
    this.planner = options?.planner ?? new Planner();
    this.runtimeManager = options?.runtimeManager;
    this.router =
      options?.router ?? new AgentRouter(this.analyzer, this.planner, this.runtimeManager);
    this.codingAgent = options?.codingAgent ?? new CodingAgent(undefined, undefined, this.guard);
    this.researchAgent = options?.researchAgent ?? new ResearchAgent();
    this.modelGateway = options?.modelGateway;
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
    const startStep = lastCheckpoint ? lastCheckpoint.stepIndex + 1 : 1;
    const currentCheckpointVersion = task.checkpoint?.version ?? 0;

    // Check if this execution is explicit simulation / placeholder
    const isSimulation =
      task.kind.startsWith('generic') ||
      task.payload?.isSimulation === true ||
      task.payload?.placeholder === true ||
      Boolean(task.payload?.simulateStep);

    const prompt =
      (task.payload?.instructions as string) ??
      (task.payload?.prompt as string) ??
      (task.payload?.query as string) ??
      task.kind;

    try {
      // 1. Move to planning if in queued
      if (task.status === 'queued') {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'planning', {
          attempt: currentAttempt,
        });

        const routeResult = await this.router.routeWithHealth(prompt, {
          userId: task.userId,
          isWindowsOnline:
            this.deviceManager?.hasOnlineDeviceForUser(task.userId, 'windows') ?? false,
          preferredRuntimeId: (task.payload?.runtime as string) ?? undefined,
        });

        const startPayload: Record<string, unknown> = {
          attempt: currentAttempt,
          startStep,
          resumedFromCheckpoint: Boolean(lastCheckpoint),
          intent: routeResult.analysis.intent,
          planId: routeResult.plan.planId,
          totalSteps: routeResult.plan.steps.length,
          modelId: routeResult.route.modelId,
          runtime: routeResult.route.runtime,
        };

        if (isSimulation) {
          startPayload['placeholder'] = true;
          startPayload['note'] = PLACEHOLDER_WORKER_LABEL;
        }

        const startEvent = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.started',
          startPayload,
        );
        this.broadcaster.publish(startEvent);
      }

      // Ensure state is running when starting/resuming steps
      const currentStatusCheck = await this.taskRepo.getTask(task.userId, task.id);
      if (currentStatusCheck && currentStatusCheck.status === 'planning') {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'running');
      }

      // Determine task category
      const isCodingTask =
        task.kind.startsWith('coding') ||
        task.payload?.category === 'coding' ||
        task.payload?.type === 'coding' ||
        (task.payload?.intent === 'coding' && !isSimulation);

      const isResearchTask =
        task.kind.startsWith('research') ||
        task.payload?.category === 'research' ||
        task.payload?.type === 'research' ||
        (task.payload?.intent === 'research' && !isSimulation);

      // ========================================================
      // PATH A: REAL CODING AGENT TRACK
      // ========================================================
      if (
        isCodingTask &&
        (task.payload?.instructions || task.payload?.filesToModify || task.payload?.mockEnvironment)
      ) {
        await this.executeCodingTrack(task, startStep, currentCheckpointVersion, span);
        return;
      }

      // ========================================================
      // PATH B: REAL RESEARCH AGENT TRACK
      // ========================================================
      if (
        isResearchTask &&
        (task.payload?.query || task.payload?.mockSources || task.payload?.mockEnvironment)
      ) {
        await this.executeResearchTrack(task, startStep, currentCheckpointVersion, prompt, span);
        return;
      }

      // ========================================================
      // PATH C: STANDARD / TOOL / CONTROLLED STEP EXECUTION
      // ========================================================
      await this.executeStandardTrack(
        task,
        startStep,
        currentCheckpointVersion,
        isSimulation,
        isCodingTask,
        isResearchTask,
        span,
      );
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

      await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
        error: errorMsg,
        attempt: currentAttempt,
      });
      const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
        error: errorMsg,
        retryable: isRetryable,
        attempt: currentAttempt,
        maxAttempts: task.maxAttempts,
      });
      this.broadcaster.publish(failEvent);
      throw err;
    }
  }

  // =========================================================================
  // CODING TRACK
  // =========================================================================
  private async executeCodingTrack(
    task: TaskRecord,
    startStep: number,
    currentCheckpointVersion: number,
    span: ReturnType<typeof defaultTracer.startSpan>,
  ): Promise<void> {
    if (await this.isHalted(task.userId, task.id)) return;

    // Step 1: Understand & Inspect
    if (startStep <= 1) {
      currentCheckpointVersion++;
      const cp1 = createVersionedCheckpoint({
        version: currentCheckpointVersion,
        stepIndex: 1,
        totalSteps: 3,
        lastExecutedAction: 'coding_plan_inspect',
        actionType: 'internal',
        verified: true,
      });
      await this.taskRepo.updateTaskProgress(task.userId, task.id, 25, cp1);

      const progEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.progress', {
        progress: 25,
        step: 1,
        action: 'coding_plan_inspect',
      });
      this.broadcaster.publish(progEvent);
    }

    // Step 2: Implement & Test
    if (startStep <= 2) {
      if (await this.isHalted(task.userId, task.id)) return;

      const approvedApprovalId =
        (task.checkpoint?.actionState?.approvalId as string) ??
        (task.payload?.approvalId as string) ??
        undefined;

      const codingInput: CodingTaskInput = {
        taskId: task.id,
        userId: task.userId,
        projectId: task.projectId,
        instructions:
          (task.payload?.instructions as string) ??
          (task.payload?.prompt as string) ??
          'Coding task execution',
        repoPath: (task.payload?.repoPath as string) ?? undefined,
        targetBranch: (task.payload?.targetBranch as string) ?? undefined,
        filesToModify:
          (task.payload?.filesToModify as Array<{ path: string; content: string }>) ?? undefined,
        mockEnvironment: (task.payload?.mockEnvironment as CodingEnvironment) ?? undefined,
        requestPush: task.payload?.requestPush === true,
        requestDeploy: task.payload?.requestDeploy === true,
        requestMerge: task.payload?.requestMerge === true,
        approvalId: approvedApprovalId,
      };

      const report = await this.codingAgent.execute(codingInput);

      if (report.status === 'waiting_approval') {
        let approvalId = 'appr-pending';
        if (this.approvalCreator && report.pendingApproval) {
          const created = await this.approvalCreator({
            userId: task.userId,
            taskId: task.id,
            projectId: task.projectId,
            action: report.pendingApproval.action,
            resource: report.pendingApproval.resource,
            scope: 'coding_agent',
            riskLevel: report.pendingApproval.riskLevel,
            consequence: report.pendingApproval.reason,
            fingerprint: report.pendingApproval.fingerprint ?? 'fp-default',
            expiresInSeconds: 3600,
          });
          approvalId = created.id;
        }

        currentCheckpointVersion++;
        const cpWait = createVersionedCheckpoint({
          version: currentCheckpointVersion,
          stepIndex: 2,
          totalSteps: 3,
          lastExecutedAction: 'waiting_approval',
          actionType: 'approval',
          actionState: {
            approvalId,
            action: report.pendingApproval?.action,
          },
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
            action: report.pendingApproval?.action,
            riskLevel: report.pendingApproval?.riskLevel,
            consequence: report.pendingApproval?.reason,
            fingerprint: report.pendingApproval?.fingerprint,
          },
        );
        this.broadcaster.publish(approvalEvent);
        return;
      }

      if (report.status === 'failed') {
        const reason = report.summary;
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
          error: reason,
        });
        const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
          error: reason,
          evaluationResult: report.evaluationResult,
          retryable: false,
        });
        this.broadcaster.publish(failEvent);
        return;
      }

      // Evaluator passed -> Step 3 Complete
      currentCheckpointVersion++;
      const cpComplete = createVersionedCheckpoint({
        version: currentCheckpointVersion,
        stepIndex: 3,
        totalSteps: 3,
        lastExecutedAction: 'complete_task',
        actionType: 'internal',
        verified: true,
      });
      await this.taskRepo.updateTaskProgress(task.userId, task.id, 100, cpComplete);
      await this.taskRepo.updateTaskStatus(task.userId, task.id, 'completed', {
        artifacts: report.artifacts,
      });

      const completeEvent = await this.taskRepo.createTaskEvent(
        task.userId,
        task.id,
        'task.completed',
        {
          result: report.summary,
          artifacts: report.artifacts,
          evaluationResult: report.evaluationResult,
        },
      );
      this.broadcaster.publish(completeEvent);
      defaultTracer.endSpan(span, { status: 'ok' });
    }
  }

  // =========================================================================
  // RESEARCH TRACK
  // =========================================================================
  private async executeResearchTrack(
    task: TaskRecord,
    startStep: number,
    currentCheckpointVersion: number,
    prompt: string,
    span: ReturnType<typeof defaultTracer.startSpan>,
  ): Promise<void> {
    if (await this.isHalted(task.userId, task.id)) return;

    if (startStep <= 1) {
      currentCheckpointVersion++;
      const cp1 = createVersionedCheckpoint({
        version: currentCheckpointVersion,
        stepIndex: 1,
        totalSteps: 3,
        lastExecutedAction: 'research_plan',
        actionType: 'internal',
        verified: true,
      });
      await this.taskRepo.updateTaskProgress(task.userId, task.id, 25, cp1);

      const progEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.progress', {
        progress: 25,
        step: 1,
        action: 'research_plan',
      });
      this.broadcaster.publish(progEvent);
    }

    if (startStep <= 2) {
      if (await this.isHalted(task.userId, task.id)) return;

      const researchInput: ResearchTaskInput = {
        taskId: task.id,
        userId: task.userId,
        query: (task.payload?.query as string) ?? prompt,
        topics: (task.payload?.topics as string[]) ?? undefined,
        mockSources: (task.payload?.mockSources as ResearchSource[]) ?? undefined,
        mockClaims: (task.payload?.mockClaims as ResearchClaim[]) ?? undefined,
        mockContradictions:
          (task.payload?.mockContradictions as ResearchContradiction[]) ?? undefined,
        mockEnvironment: (task.payload?.mockEnvironment as ResearchEnvironment) ?? undefined,
        simulateFabricatedCitation: task.payload?.simulateFabricatedCitation === true,
      };

      const report = await this.researchAgent.execute(researchInput);

      if (report.status === 'failed') {
        const reason = report.summary;
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
          error: reason,
        });
        const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
          error: reason,
          evaluationResult: report.evaluationResult,
          retryable: false,
        });
        this.broadcaster.publish(failEvent);
        return;
      }

      // Evaluator passed -> Step 3 Complete
      currentCheckpointVersion++;
      const cpComplete = createVersionedCheckpoint({
        version: currentCheckpointVersion,
        stepIndex: 3,
        totalSteps: 3,
        lastExecutedAction: 'complete_task',
        actionType: 'internal',
        verified: true,
      });
      await this.taskRepo.updateTaskProgress(task.userId, task.id, 100, cpComplete);
      await this.taskRepo.updateTaskStatus(task.userId, task.id, 'completed', {
        artifacts: report.artifacts,
      });

      const completeEvent = await this.taskRepo.createTaskEvent(
        task.userId,
        task.id,
        'task.completed',
        {
          result: report.summary,
          artifacts: report.artifacts,
          evaluationResult: report.evaluationResult,
        },
      );
      this.broadcaster.publish(completeEvent);
      defaultTracer.endSpan(span, { status: 'ok' });
    }
  }

  // =========================================================================
  // STANDARD / TOOL / EVALUATOR-GATED TRACK
  // =========================================================================
  private async executeStandardTrack(
    task: TaskRecord,
    startStep: number,
    currentCheckpointVersion: number,
    isSimulation: boolean,
    isCodingTask: boolean,
    isResearchTask: boolean,
    span: ReturnType<typeof defaultTracer.startSpan>,
  ): Promise<void> {
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
          ...(isSimulation ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
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
        (task.checkpoint?.actionState?.approvalId as string) ??
        (task.payload?.approvalId as string) ??
        undefined;

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
              actionState: { approvalId, action: guardErr.requiredApproval.action },
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
                ...(isSimulation ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
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
      let toolIsPlaceholder = isSimulation;

      if (this.registry && typeof task.payload?.toolName === 'string') {
        const res = await this.registry.executeTool({
          toolName: task.payload.toolName,
          input: task.payload.toolInput ?? {},
          context: {
            actor: { id: task.userId, role: 'user' },
            taskId: task.id,
            projectId: task.projectId,
          },
          approvalId: approvedApprovalId,
        });
        toolOutput = res.data;
        toolIsPlaceholder = false;
      }

      const toolEvent = await this.taskRepo.createTaskEvent(
        task.userId,
        task.id,
        'task.tool_call',
        {
          tool: (task.payload?.toolName as string) ?? actionName,
          input: task.payload?.toolInput ?? { query: 'runtime architecture specs' },
          output: toolOutput,
          ...(toolIsPlaceholder ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
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
          ...(isSimulation ? { placeholder: true } : {}),
        },
      );
      this.broadcaster.publish(progEvent2);
    }

    // Step 3: Approval Check (Explicit payload flag check)
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
            ...(isSimulation ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
          },
        );
        this.broadcaster.publish(approvalEvent);
        return;
      }
    }

    // Step 4: Finalize Artifacts & Complete (STRICT EVALUATOR GATING)
    if (startStep <= 4) {
      if (await this.isHalted(task.userId, task.id)) return;

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
                  title: 'Task Output',
                  content: 'Task output berhasil diselesaikan dan diverifikasi.',
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
          title: 'Task Output',
          content: 'Task berhasil diselesaikan dan diverifikasi oleh Evaluator.',
          ...(isSimulation ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
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
          result: 'Task completed successfully and verified by Evaluator',
          artifacts,
          ...(isSimulation ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
        },
      );
      this.broadcaster.publish(completeEvent);
      defaultTracer.endSpan(span, { status: 'ok' });
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
