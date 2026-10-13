import {
  ApprovalRequiredError,
  InvalidApprovalError,
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
  type TelemetrySpan,
} from '@personal-ai-os/shared';
import {
  CodingEvaluator,
  GenericEvaluator,
  ResearchEvaluator,
  type AcceptanceCriterion,
  type CodingEvidence,
  type EvaluationResult,
  type ResearchEvidence,
} from '@personal-ai-os/evaluator';
import {
  AgentRouter,
  CodingAgent,
  type CodingEnvironment,
  type CodingTaskInput,
  IntentAnalyzer,
  Planner,
  ResearchAgent,
  LocalResearchEnvironment,
  prepareCodingWorkspace,
  type ResearchTaskInput,
  type RuntimeManager,
  type RuntimeExecuteResult,
} from '@personal-ai-os/agent-core';
import type { ModelGateway } from '@personal-ai-os/model-gateway';
import type { ToolRegistry } from '@personal-ai-os/tools';
import { DeviceOfflineError, type DeviceCommandResult } from '@personal-ai-os/api/services';
import type { DeviceDispatcher } from './device-dispatcher.ts';

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
  /** Presence and command dispatch for the user's devices, routed through the API. */
  deviceDispatcher?: DeviceDispatcher | undefined;
  registry?: ToolRegistry | undefined;
  analyzer?: IntentAnalyzer | undefined;
  planner?: Planner | undefined;
  router?: AgentRouter | undefined;
  runtimeManager?: RuntimeManager | undefined;
  preferredRuntimeId?: string | undefined;
  codingAgent?: CodingAgent | undefined;
  /** Parent directory for per-task coding workspaces. Each task gets its own git-initialised subdirectory. */
  codingWorkspaceRoot?: string | undefined;
  researchAgent?: ResearchAgent | undefined;
  modelGateway?: ModelGateway | undefined;
  defaultModel?: string | undefined;
}

export class TaskExecutor {
  private readonly taskRepo: TaskRepository;
  private readonly broadcaster: EventPublisher;
  private readonly guard?: SecuredCapabilityGuard | undefined;
  private readonly approvalCreator?:
    ((params: ApprovalCreatorParams) => Promise<{ id: string }>) | undefined;
  private readonly deviceDispatcher?: DeviceDispatcher | undefined;
  private readonly registry?: ToolRegistry | undefined;
  private readonly analyzer: IntentAnalyzer;
  private readonly planner: Planner;
  private readonly router: AgentRouter;
  private readonly runtimeManager?: RuntimeManager | undefined;
  private readonly preferredRuntimeId: string;
  private readonly codingAgent: CodingAgent;
  private readonly researchAgent: ResearchAgent;
  private readonly modelGateway?: ModelGateway | undefined;
  private readonly defaultModel?: string | undefined;
  private readonly codingWorkspaceRoot: string;

  constructor(
    taskRepo: TaskRepository,
    broadcaster: EventPublisher,
    options?: TaskExecutorOptions,
  ) {
    this.taskRepo = taskRepo;
    this.broadcaster = broadcaster;
    this.guard = options?.guard;
    this.approvalCreator = options?.approvalCreator;
    this.deviceDispatcher = options?.deviceDispatcher;
    this.registry = options?.registry;

    this.analyzer = options?.analyzer ?? new IntentAnalyzer();
    this.planner = options?.planner ?? new Planner();
    this.runtimeManager = options?.runtimeManager;
    this.preferredRuntimeId = options?.preferredRuntimeId ?? 'omp';
    this.router = options?.router ?? new AgentRouter(this.analyzer, this.planner, this.runtimeManager);
    this.codingAgent = options?.codingAgent ?? new CodingAgent(undefined, undefined, this.guard);
    this.researchAgent = options?.researchAgent ?? new ResearchAgent();
    this.modelGateway = options?.modelGateway;
    this.defaultModel = options?.defaultModel;
    this.codingWorkspaceRoot =
      options?.codingWorkspaceRoot ?? process.env.CODING_WORKSPACE_ROOT ?? 'data/workspaces';
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

    // A task that targets a device must reach a real one. Presence is asked of the API, which
    // owns the Windows agent sessions; when nothing is connected the task fails transparently
    // instead of being reported as work the device never performed.
    const targetDevice =
      typeof task.payload?.['targetDevice'] === 'string' ? task.payload['targetDevice'] : undefined;
    const isWindowsTarget =
      targetDevice !== undefined ||
      task.payload?.['target'] === 'windows' ||
      task.payload?.['platform'] === 'windows' ||
      task.kind.startsWith('windows');

    const onlineDeviceIds = isWindowsTarget
      ? ((await this.deviceDispatcher?.listOnlineDevices(task.userId, 'windows')) ?? [])
      : [];

    if (isWindowsTarget) {
      const isOnline =
        targetDevice === undefined
          ? onlineDeviceIds.length > 0
          : onlineDeviceIds.includes(targetDevice);
      if (!isOnline) {
        const reason =
          targetDevice === undefined
            ? 'Windows Agent sedang offline: tidak ada perangkat Windows yang terhubung untuk menjalankan task ini.'
            : `Windows Agent "${targetDevice}" sedang offline: perangkat tidak terhubung untuk menjalankan task ini.`;
        // A task straight out of the queue is not allowed to jump to `failed`, so record the
        // planning step first. Without it the transition throws and the task stays `queued`
        // forever with no visible error.
        if (task.status === 'queued') {
          await this.taskRepo.updateTaskStatus(task.userId, task.id, 'planning', {
            attempt: task.attempt + 1,
          });
        }
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', {
          error: reason,
        });
        const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
          error: reason,
          offlineReason: 'device_unreachable',
          platform: 'windows',
          ...(targetDevice === undefined ? {} : { deviceId: targetDevice }),
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

    // Synthetic execution is test-only and must be explicit.
    const isSimulation =
      task.payload?.isSimulation === true ||
      task.payload?.placeholder === true ||
      Boolean(task.payload?.simulateStep);

    const prompt =
      (task.payload?.instructions as string) ??
      (task.payload?.prompt as string) ??
      (task.payload?.goal as string) ??
      task.kind;
    const requestedMode = task.payload?.mode;
    const mode =
      requestedMode === 'auto' || requestedMode === 'fast' || requestedMode === 'coding' || requestedMode === 'complex' || requestedMode === 'research'
        ? requestedMode
        : undefined;
    let selectedRuntimeId: string | undefined;
    try {
      // 1. Move to planning if in queued
      if (task.status === 'queued') {
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'planning', {
          attempt: currentAttempt,
        });

        const routeResult = await this.router.routeWithHealth(prompt, {
          userId: task.userId,
          mode,
          isWindowsOnline: isWindowsTarget ? onlineDeviceIds.length > 0 : undefined,
          preferredRuntimeId: (task.payload?.runtime as string) ?? this.preferredRuntimeId,
        });
        selectedRuntimeId = routeResult.route.selectedRuntimeId;

        const startPayload: Record<string, unknown> = {
          attempt: currentAttempt,
          startStep,
          resumedFromCheckpoint: Boolean(lastCheckpoint),
          intent: routeResult.analysis.intent,
          planId: routeResult.plan.planId,
          totalSteps: routeResult.plan.steps.length,
          runtime: routeResult.route.runtime,
          selectedRuntimeId: routeResult.route.selectedRuntimeId,
          runtimeFallback: routeResult.route.fallbackUsed === true,
          runtimeFallbackReason: routeResult.route.fallbackReason,
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

      if (task.payload?.useRuntime === true) {
        await this.executeRuntimeTrack(task, prompt, selectedRuntimeId ?? (task.payload?.runtime as string) ?? this.preferredRuntimeId, span);
        return;
      }

      // ========================================================
      // PATH D: WINDOWS DEVICE DISPATCH
      // ========================================================
      if (targetDevice !== undefined) {
        await this.executeDeviceTrack(task, targetDevice, startStep, currentCheckpointVersion, span);
        return;
      }

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
      if (isResearchTask) {
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
        prompt,
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

  private async executeRuntimeTrack(task: TaskRecord, prompt: string, runtimeId: string, span: TelemetrySpan): Promise<void> {
    if (!this.runtimeManager) throw new Error('Runtime execution requested but no RuntimeManager configured.');
    const runtime = this.runtimeManager.getRuntime(runtimeId);
    if (!runtime) throw new Error(`Selected runtime "${runtimeId}" is not registered.`);
    const result: RuntimeExecuteResult = await runtime.execute({ taskId: task.id, prompt, timeoutMs: typeof task.payload?.timeoutMs === 'number' ? task.payload.timeoutMs : undefined, metadata: { workspaceId: task.payload?.workspaceId ?? task.id }, untrusted: true });
    const output = result.output ?? '';
    const outputEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.tool_call', { tool: `runtime:${runtimeId}`, output, proposedActions: result.proposedActions ?? [], untrustedOutputWarning: result.untrustedOutputWarning === true });
    this.broadcaster.publish(outputEvent);
    if (result.status !== 'completed') {
      const status = result.status === 'cancelled' ? 'cancelled' : 'failed';
      const error = result.error ?? `Runtime ${runtimeId} returned ${result.status}.`;
      await this.taskRepo.updateTaskStatus(task.userId, task.id, status, { error });
      const failed = await this.taskRepo.createTaskEvent(task.userId, task.id, status === 'cancelled' ? 'task.cancelled' : 'task.failed', { runtimeId, error, retryable: false });
      this.broadcaster.publish(failed);
      return;
    }
    const artifact = { id: `runtime-output-${task.id}`, type: 'runtime_output', title: `${runtimeId} output`, content: output };
    const evaluation = new GenericEvaluator().evaluate((task.payload?.acceptanceCriteria as AcceptanceCriterion[]) ?? [{ id: 'runtime_output', description: 'Runtime menghasilkan output', category: 'runtime', required: true, expectedEvidenceType: 'artifact' }], { artifacts: [artifact], outputs: { runtimeOutput: output }, logs: [`runtime:${runtimeId}`] });
    if (!evaluation.passed) throw new Error(evaluation.completionBlockedReason ?? 'Runtime output rejected by evaluator.');
    await this.taskRepo.updateTaskProgress(task.userId, task.id, 100, createVersionedCheckpoint({ version: (task.checkpoint?.version ?? 0) + 1, stepIndex: 1, totalSteps: 1, lastExecutedAction: `runtime:${runtimeId}`, actionType: 'external_tool', verified: true }));
    await this.taskRepo.updateTaskStatus(task.userId, task.id, 'completed', { artifacts: [artifact] });
    const completed = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.completed', { runtimeId, result: 'Runtime output received and recorded.', artifacts: [artifact] });
    this.broadcaster.publish(completed);
    defaultTracer.endSpan(span, { status: 'ok' });
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
      // A coding task runs against a real directory. Payloads that name one use it verbatim;
      // otherwise the executor hands the task its own git-initialised workspace so the checks
      // that follow execute for real instead of being answered by a stub.
      const workspaceDir =
        typeof task.payload?.workspaceDir === 'string'
          ? task.payload.workspaceDir
          : await prepareCodingWorkspace(this.codingWorkspaceRoot, task.id);

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
        workspaceDir,
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

      // The environment is built here, not read from the payload: a client must never be able
      // to inject sources, claims, or a mock backend and have the evaluator accept them.
      const researchInput: ResearchTaskInput = {
        taskId: task.id,
        userId: task.userId,
        query: (task.payload?.query as string) ?? prompt,
        topics: (task.payload?.topics as string[]) ?? undefined,
        environment: this.registry
          ? new LocalResearchEnvironment({
              registry: this.registry,
              context: {
                actor: { id: task.userId, role: 'user' },
                taskId: task.id,
                projectId: task.projectId,
              },
            })
          : undefined,
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
  // DEVICE TRACK (Windows agent)
  // =========================================================================
  /**
   * Dispatches one command to a connected device and records what it actually returned.
   *
   * The device's exit code is the verdict — there is no evaluator step to soften it. A non-zero
   * exit, a transport error, or a device that never answered all fail the task; nothing is
   * reported as completed that the device did not do. The command is HIGH risk, so it only runs
   * once the user has approved that exact command (the approval fingerprint covers the command
   * text and the target device).
   */
  private async executeDeviceTrack(
    task: TaskRecord,
    targetDevice: string,
    startStep: number,
    currentCheckpointVersion: number,
    span: TelemetrySpan,
  ): Promise<void> {
    if (await this.isHalted(task.userId, task.id)) return;

    const command =
      typeof task.payload?.['command'] === 'string' ? task.payload['command'] : undefined;
    if (!command) {
      const reason =
        'Task perangkat memerlukan payload.command berisi perintah yang akan dijalankan.';
      await this.failDeviceTask(task, reason, { retryable: false });
      return;
    }

    if (startStep <= 1) {
      currentCheckpointVersion++;
      const cp1 = createVersionedCheckpoint({
        version: currentCheckpointVersion,
        stepIndex: 1,
        totalSteps: 3,
        lastExecutedAction: 'device_plan',
        actionType: 'internal',
        verified: true,
      });
      await this.taskRepo.updateTaskProgress(task.userId, task.id, 25, cp1);

      const progEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.progress', {
        progress: 25,
        step: 1,
        action: 'device_plan',
        deviceId: targetDevice,
      });
      this.broadcaster.publish(progEvent);
    }

    const approvedApprovalId =
      typeof task.checkpoint?.actionState?.approvalId === 'string'
        ? task.checkpoint.actionState.approvalId
        : typeof task.payload?.['approvalId'] === 'string'
          ? task.payload['approvalId']
          : undefined;
    // An approved device command is replayed on resume: the approval route rewrites the
    // checkpoint to step 3, so a step-number check alone would silently skip the dispatch.
    const isApprovedResume =
      task.checkpoint?.actionState?.approved === true && approvedApprovalId !== undefined;
    if (startStep > 2 && !isApprovedResume) return;

    const dispatcher = this.deviceDispatcher;
    const guard = this.guard;
    if (!dispatcher || !guard) {
      await this.failDeviceTask(
        task,
        'Dispatch perangkat tidak tersedia: worker tidak dikonfigurasi dengan DeviceDispatcher dan SecuredCapabilityGuard.',
        { retryable: false },
      );
      return;
    }

    const timeoutMs =
      typeof task.payload?.['timeoutMs'] === 'number' ? task.payload['timeoutMs'] : undefined;
    const deviceCommand = {
      userId: task.userId,
      deviceId: targetDevice,
      command,
      capability: typeof task.payload?.['capability'] === 'string' ? task.payload['capability'] : undefined,
      action: typeof task.payload?.['action'] === 'string' ? task.payload['action'] : undefined,
      cwd: typeof task.payload?.['cwd'] === 'string' ? task.payload['cwd'] : undefined,
      timeoutMs,
    };

    let result: DeviceCommandResult;
    try {
      result = await guard.executeProtected(
        {
          actor: { id: task.userId, role: 'user' },
          action: 'device:command',
          resource: targetDevice,
          scope: 'device',
          traceId: task.id,
          // Part of the approval fingerprint: approving one command must not approve another.
          context: { deviceId: targetDevice, command, taskId: task.id, platform: 'windows' },
        },
        async () => dispatcher.dispatchCommand(deviceCommand),
        { approvalId: approvedApprovalId },
      );
    } catch (err) {
      if (err instanceof ApprovalRequiredError) {
        const created = this.approvalCreator
          ? await this.approvalCreator({
              userId: task.userId,
              taskId: task.id,
              projectId: task.projectId,
              action: err.requiredApproval.action,
              resource: err.requiredApproval.resource,
              scope: err.requiredApproval.scope,
              riskLevel: err.requiredApproval.riskLevel,
              consequence: err.requiredApproval.consequence,
              fingerprint: err.requiredApproval.fingerprint,
              expiresInSeconds: 3600,
            })
          : { id: 'appr-pending' };

        currentCheckpointVersion++;
        const cpWait = createVersionedCheckpoint({
          version: currentCheckpointVersion,
          stepIndex: 2,
          totalSteps: 3,
          lastExecutedAction: 'waiting_approval',
          actionType: 'approval',
          actionState: { approvalId: created.id, action: err.requiredApproval.action },
          verified: true,
        });
        await this.taskRepo.updateTaskProgress(task.userId, task.id, 50, cpWait);
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'waiting_approval');

        const approvalEvent = await this.taskRepo.createTaskEvent(
          task.userId,
          task.id,
          'task.waiting_approval',
          {
            approvalId: created.id,
            action: err.requiredApproval.action,
            riskLevel: err.requiredApproval.riskLevel,
            consequence: err.requiredApproval.consequence,
            fingerprint: err.requiredApproval.fingerprint,
            deviceId: targetDevice,
          },
        );
        this.broadcaster.publish(approvalEvent);
        return;
      }

      if (err instanceof DeviceOfflineError) {
        await this.failDeviceTask(
          task,
          `Windows Agent "${targetDevice}" tidak terhubung saat perintah dikirim.`,
          { retryable: true, offlineReason: 'device_unreachable', deviceId: targetDevice },
        );
        return;
      }

      // An approval is bound to the exact command it was granted for, so a mismatch, a reused
      // approval, or a denial all mean this command was never authorised. Say so instead of
      // blaming the device.
      if (err instanceof InvalidApprovalError || err instanceof PermissionDeniedError) {
        await this.failDeviceTask(task, `Perintah perangkat tidak diotorisasi: ${err.message}`, {
          retryable: false,
          deviceId: targetDevice,
        });
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      await this.failDeviceTask(task, `Perintah ke perangkat gagal: ${message}`, {
        retryable: false,
        deviceId: targetDevice,
      });
      return;
    }

    const artifact = {
      id: `artifact-device-${task.id}`,
      type: 'device_command_output',
      title: `Output perintah Windows (${targetDevice})`,
      content: JSON.stringify(
        {
          deviceId: targetDevice,
          command,
          exitCode: result.result?.exitCode ?? null,
          stdout: result.result?.stdout ?? '',
          stderr: result.result?.stderr ?? '',
          truncated: result.result?.truncated ?? false,
          durationMs: result.result?.durationMs ?? null,
          error: result.error ?? null,
        },
        null,
        2,
      ),
    };

    if (!result.success) {
      const detail =
        result.error?.message ??
        `exit code ${result.result?.exitCode ?? 'tidak diketahui'}` +
          (result.result?.stderr ? `: ${result.result.stderr.trim()}` : '');
      await this.failDeviceTask(task, `Perintah pada perangkat gagal (${detail}).`, {
        retryable: false,
        deviceId: targetDevice,
        artifacts: [artifact],
        commandResult: result.result ?? result.error,
      });
      return;
    }

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
      artifacts: [artifact],
    });

    const completeEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.completed', {
      result: `Perintah dijalankan pada perangkat ${targetDevice} dengan exit code ${result.result?.exitCode ?? 0}.`,
      deviceId: targetDevice,
      command,
      exitCode: result.result?.exitCode ?? 0,
      artifacts: [artifact],
    });
    this.broadcaster.publish(completeEvent);
    defaultTracer.endSpan(span, { status: 'ok' });
  }

  private async failDeviceTask(
    task: TaskRecord,
    reason: string,
    options: {
      retryable: boolean;
      offlineReason?: string | undefined;
      deviceId?: string | undefined;
      artifacts?: Array<{ id: string; type: string; title: string; content: string }> | undefined;
      commandResult?: unknown;
    },
  ): Promise<void> {
    await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', { error: reason });
    const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
      error: reason,
      retryable: options.retryable,
      ...(options.offlineReason === undefined ? {} : { offlineReason: options.offlineReason }),
      ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
      ...(options.artifacts === undefined ? {} : { artifacts: options.artifacts }),
      ...(options.commandResult === undefined ? {} : { commandResult: options.commandResult }),
    });
    this.broadcaster.publish(failEvent);
  }

  private async executeRegisteredTool(task: TaskRecord, toolName: string, approvalId: string | undefined, span: TelemetrySpan): Promise<void> {
    const result = await this.registry!.executeTool({
      toolName,
      input: task.payload?.toolInput ?? {},
      context: { actor: { id: task.userId, role: 'user' }, taskId: task.id, projectId: task.projectId, traceId: task.id },
      approvalId,
    });
    const event = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.tool_call', { tool: toolName, input: task.payload?.toolInput ?? {}, output: result.data, truncated: result.truncated });
    this.broadcaster.publish(event);
    const checkpoint = createVersionedCheckpoint({ version: (task.checkpoint?.version ?? 0) + 1, stepIndex: 2, totalSteps: 2, lastExecutedAction: `tool_call:${toolName}`, actionType: 'external_tool', verified: true, actionState: { output: result.data } });
    // A tool call is evidence, not a verdict. The task is only complete once an evaluator has
    // accepted what the tool actually returned.
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
    // Evidence is only attached when the tool actually produced something; a call that returned
    // nothing must not be dressed up as an artifact.
    const toolOutput = result.data;
    const hasOutput = toolOutput !== undefined && toolOutput !== null;
    const evaluationResult = new GenericEvaluator().evaluate(criteria, {
      artifacts: hasOutput
        ? [
            {
              title: `Task Output (tool_call:${toolName})`,
              content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
            },
          ]
        : [],
      outputs: hasOutput ? { tool: toolName, result: toolOutput } : {},
      logs: [`Executed tool ${toolName}`, `Output truncated: ${result.truncated}`],
    });
    if (!evaluationResult.passed) {
      const reason =
        evaluationResult.completionBlockedReason ??
        evaluationResult.remainingIssues[0] ??
        'Evaluator menolak penyelesaian task tool tanpa bukti.';
      await this.taskRepo.updateTaskStatus(task.userId, task.id, 'failed', { error: reason });
      const failEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.failed', {
        error: reason,
        evaluationResult,
        retryable: false,
      });
      this.broadcaster.publish(failEvent);
      return;
    }
    await this.taskRepo.updateTaskProgress(task.userId, task.id, 100, checkpoint);
    await this.taskRepo.updateTaskStatus(task.userId, task.id, 'completed');
    const completeEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.completed', { result: result.data, tool: toolName, evaluationResult });
    this.broadcaster.publish(completeEvent);
    defaultTracer.endSpan(span, { status: 'ok' });
  }

  /**
   * Real generic path: registered tool when named, otherwise a bounded model call through the
   * configured ModelGateway. Fails closed — never fabricates evidence.
   */
  private async executeGenericOrchestration(
    task: TaskRecord,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    if (typeof task.payload?.toolName === 'string') {
      if (!this.registry) throw new Error('Task names a registered tool but no ToolRegistry is configured.');
      const res = await this.registry.executeTool({
        toolName: task.payload.toolName,
        input: task.payload.toolInput ?? {},
        context: { actor: { id: task.userId, role: 'user' }, taskId: task.id, projectId: task.projectId },
      });
      return { tool: task.payload.toolName, content: JSON.stringify(res.data), toolOutput: res.data };
    }

    if (!this.modelGateway) {
      throw new Error(
        'Generic task requires a ModelGateway (set NINEROUTER_API_KEY or DEFAULT_CHAT_MODEL); refusing to fabricate evidence.',
      );
    }
    const model = (task.payload?.model as string) ?? this.defaultModel;
    if (!model) {
      throw new Error('Generic task requires payload.model or DEFAULT_CHAT_MODEL to select a verified model.');
    }

    const analysis = this.analyzer.analyze(prompt);
    const plan = this.planner.createPlan(analysis, prompt);
    const response = await this.modelGateway.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Anda mengeksekusi satu langkah task otonom untuk pengguna berbahasa Indonesia. ' +
            'Jawab langsung dalam Bahasa Indonesia dengan hasil kerja yang konkret dan dapat diverifikasi. ' +
            'Rujuk kembali istilah kunci dari permintaan pengguna. Jangan mengklaim hal yang tidak Anda kerjakan.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    });

    return {
      content: response.content,
      model: response.model,
      intent: analysis.intent,
      planId: plan.planId,
      plannedSteps: plan.steps.map((s) => s.name),
      usage: response.usage ?? null,
    };
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
    prompt: string,
    span: TelemetrySpan,
  ): Promise<void> {
    // Step 1: Plan Analysis
    const registeredToolApprovalId =
      (task.checkpoint?.actionState?.approvalId as string) ?? (task.payload?.approvalId as string) ?? undefined;
    // Resume after an approved step-2 action: replay the guarded action with the approval id so the
    // approved capability executes exactly once instead of being skipped on resume.
    const replayApprovedStepTwo =
      task.checkpoint?.stepIndex === 2 &&
      task.checkpoint?.lastExecutedAction === 'waiting_approval' &&
      task.checkpoint?.actionState?.approved === true &&
      typeof task.checkpoint?.actionState?.approvalId === 'string';
    if (!isSimulation && this.registry && typeof task.payload?.toolName === 'string' && (startStep <= 2 || registeredToolApprovalId)) {
      try {
        await this.executeRegisteredTool(task, task.payload.toolName, registeredToolApprovalId, span);
      } catch (toolErr) {
        if (!(toolErr instanceof ApprovalRequiredError)) throw toolErr;
        const created = this.approvalCreator ? await this.approvalCreator({
          userId: task.userId, taskId: task.id, projectId: task.projectId,
          action: toolErr.requiredApproval.action, resource: toolErr.requiredApproval.resource,
          scope: toolErr.requiredApproval.scope, riskLevel: toolErr.requiredApproval.riskLevel,
          consequence: toolErr.requiredApproval.consequence, fingerprint: toolErr.requiredApproval.fingerprint,
          expiresInSeconds: 3600,
        }) : { id: 'appr-pending' };
        currentCheckpointVersion++;
        const checkpoint = createVersionedCheckpoint({
          version: currentCheckpointVersion, stepIndex: 2, totalSteps: 4,
          lastExecutedAction: 'waiting_approval', actionType: 'approval',
          actionState: { approvalId: created.id, action: toolErr.requiredApproval.action }, verified: true,
        });
        await this.taskRepo.updateTaskProgress(task.userId, task.id, 50, checkpoint);
        await this.taskRepo.updateTaskStatus(task.userId, task.id, 'waiting_approval');
        const approvalEvent = await this.taskRepo.createTaskEvent(task.userId, task.id, 'task.waiting_approval', {
          approvalId: created.id, action: toolErr.requiredApproval.action,
          riskLevel: toolErr.requiredApproval.riskLevel, consequence: toolErr.requiredApproval.consequence,
          fingerprint: toolErr.requiredApproval.fingerprint,
        });
        this.broadcaster.publish(approvalEvent);
      }
      return;
    }
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
    let stepTwoOutput: unknown;
    let stepTwoAction = 'none';
    let completionContent: string | undefined;
    if (startStep <= 2 || replayApprovedStepTwo) {
      if (await this.isHalted(task.userId, task.id)) return;

      const isGenericOrchestration =
        !isSimulation && task.payload?.toolName === undefined && task.kind.startsWith('generic');
      const actionName =
        (task.payload?.action as string) ??
        (isGenericOrchestration ? 'model:chat' : 'tool:search_knowledge');
      const resourceName =
        (task.payload?.resource as string) ??
        (isGenericOrchestration
          ? `model://${(task.payload?.model as string) ?? this.defaultModel ?? 'unconfigured'}`
          : 'knowledge://personal-ai-os');
      const scopeName = (task.payload?.scope as string) ?? 'workspace';
      const approvedApprovalId =
        (task.checkpoint?.actionState?.approvalId as string) ??
        (task.payload?.approvalId as string) ??
        undefined;
      stepTwoAction = actionName;

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

      const executeStepTwo = async (): Promise<unknown> => {
        if (isSimulation) return { matchCount: 3, summary: 'Found relevant specifications' };
        if (task.kind.startsWith('generic')) return this.executeGenericOrchestration(task, prompt);
        return { result: 'controlled task step completed' };
      };

      try {
        stepTwoOutput = this.guard
          ? await this.guard.executeProtected(
              {
                actor: { id: task.userId, isAutomated: true },
                action: actionName,
                resource: resourceName,
                scope: scopeName,
                context: task.payload,
              },
              executeStepTwo,
              { approvalId: approvedApprovalId },
            )
          : await executeStepTwo();
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

      const toolOutput = stepTwoOutput;
      const toolIsPlaceholder = isSimulation;

      const toolEvent = await this.taskRepo.createTaskEvent(
        task.userId,
        task.id,
        'task.tool_call',
        {
          tool: (task.payload?.toolName as string) ?? actionName,
          input: task.payload?.toolInput ?? { prompt },
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
    let completionEvaluation: EvaluationResult | undefined;
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
        let executedOutput: Record<string, unknown> | undefined = isSimulation
          ? { result: 'ok', matchCount: 3 }
          : ((stepTwoOutput as Record<string, unknown> | undefined) ??
            (task.checkpoint?.actionState?.toolResult as Record<string, unknown> | undefined) ??
            (task.checkpoint
              ? {
                  resumedFromCheckpoint: true,
                  lastExecutedAction: task.checkpoint.lastExecutedAction,
                  verifiedStepIndex: task.checkpoint.stepIndex,
                  checkpointVersion: task.checkpoint.version,
                }
              : undefined));
        if (!isSimulation && !executedOutput && task.kind.startsWith('generic')) {
          executedOutput = await this.executeGenericOrchestration(task, prompt);
        }
        const executedAction =
          stepTwoAction !== 'none' ? stepTwoAction : (task.checkpoint?.lastExecutedAction ?? 'none');
        const evidenceContent =
          typeof executedOutput?.['content'] === 'string'
            ? (executedOutput['content'] as string)
            : JSON.stringify(executedOutput ?? null);
        completionContent = evidenceContent;
        const evalResult = genericEvaluator.evaluate(criteria, {
          artifacts:
            isSelfClaimOnly || !executedOutput
              ? []
              : [{ title: `Task Output (${executedAction})`, content: evidenceContent }],
          outputs: isSelfClaimOnly || !executedOutput ? {} : executedOutput,
          logs:
            isSelfClaimOnly || !executedOutput
              ? []
              : [`Executed ${executedAction}`, 'Task execution finished successfully'],
        });
        completionEvaluation = evalResult;

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
          content:
            completionContent ?? 'Task berhasil diselesaikan dan diverifikasi oleh Evaluator.',
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
          ...(completionEvaluation ? { evaluationResult: completionEvaluation } : {}),
          ...(isSimulation ? { placeholder: true, note: PLACEHOLDER_WORKER_LABEL } : {}),
        },
      );
      this.broadcaster.publish(completeEvent);
      defaultTracer.endSpan(span, { status: 'ok' });
    }
  }

  /**
   * Re-enqueue tasks left `running` by a previous process. The queue is required: without it
   * this method only wrote a `task.resumed` event and left the task dangling forever, which
   * looked like a successful recovery in the logs.
   */
  async recoverInterruptedTasks(
    queue: TaskQueueEnqueuer,
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

      await queue.enqueue(task);
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
