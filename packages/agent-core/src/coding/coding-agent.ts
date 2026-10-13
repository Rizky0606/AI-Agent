import { CodingEvaluator, type CodingEvidence } from '@personal-ai-os/evaluator';
import {
  ApprovalRequiredError,
  PermissionEngine,
  SecuredCapabilityGuard,
  type RiskLevel,
} from '@personal-ai-os/permissions';
import type {
  CodingAgentConfig,
  CodingExecutionReport,
  CodingWorkflowStage,
  GitInspectionResult,
  RepairAttemptProof,
} from '../types.ts';
import { LocalCodingEnvironment } from './local-environment.ts';

export interface CodingEnvironment {
  getGitStatus(): Promise<{ clean: boolean; branch: string; uncommittedFiles: string[] }>;
  createIsolatedBranch(branchName: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  runLint(): Promise<{ passed: boolean; output: string }>;
  runTypecheck(): Promise<{ passed: boolean; output: string }>;
  runTests(): Promise<{
    passed: boolean;
    passedCount?: number | undefined;
    failedCount?: number | undefined;
    output: string;
  }>;
  runBuild(): Promise<{ passed: boolean; output: string }>;
  getDiff(): Promise<{ diffSummary: string; fullDiff: string; changedFiles: string[] }>;
  pushGit?(remote: string, branch: string): Promise<{ success: boolean; output: string }>;
  mergeGit?(branch: string, target: string): Promise<{ success: boolean; output: string }>;
  deploy?(targetEnv: string): Promise<{ success: boolean; output: string }>;
}

export interface CodingTaskInput {
  taskId: string;
  userId: string;
  projectId?: string | undefined;
  instructions: string;
  /** Real directory the workflow executes in. Ignored when `mockEnvironment` is supplied. */
  workspaceDir?: string | undefined;
  repoPath?: string | undefined;
  targetBranch?: string | undefined;
  filesToModify?: Array<{ path: string; content: string }> | undefined;
  mockEnvironment?: CodingEnvironment | undefined;
  requestPush?: boolean | undefined;
  requestDeploy?: boolean | undefined;
  requestMerge?: boolean | undefined;
  approvalId?: string | undefined;
  customRepairLogic?:
    | ((
        attempt: number,
        errorOutput: string,
        env: CodingEnvironment,
      ) => Promise<{
        fixApplied: boolean;
        proposedFix: string;
        filesModified: string[];
      }>)
    | undefined;
}

export interface ResolvedCodingAgentConfig {
  maxRepairAttempts: number;
  workspaceRoot: string;
  targetBranch: string;
  repoIsolationMode: 'branch' | 'worktree' | 'temp_dir';
}

export class CodingAgent {
  private readonly config: ResolvedCodingAgentConfig;
  private readonly evaluator: CodingEvaluator;
  private readonly guard: SecuredCapabilityGuard;

  constructor(
    config?: CodingAgentConfig,
    evaluator?: CodingEvaluator,
    guard?: SecuredCapabilityGuard,
  ) {
    this.config = {
      maxRepairAttempts: config?.maxRepairAttempts ?? 3,
      workspaceRoot: config?.workspaceRoot ?? process.cwd(),
      targetBranch: config?.targetBranch ?? 'master',
      repoIsolationMode: config?.repoIsolationMode ?? 'branch',
    };
    this.evaluator = evaluator ?? new CodingEvaluator();
    this.guard = guard ?? new SecuredCapabilityGuard(new PermissionEngine());
  }

  async execute(input: CodingTaskInput): Promise<CodingExecutionReport> {
    const env: CodingEnvironment =
      input.mockEnvironment ??
      new LocalCodingEnvironment({
        workspaceDir: input.workspaceDir ?? this.config.workspaceRoot,
      });
    let currentStage: CodingWorkflowStage = 'understand';
    const repairProofs: RepairAttemptProof[] = [];
    const modifiedFiles: string[] = [];

    // ========================================================
    // 1. UNDERSTAND
    // ========================================================
    currentStage = 'understand';
    const parsedRequirements = {
      summary: input.instructions,
      needsPush: input.requestPush === true,
      needsDeploy: input.requestDeploy === true,
      needsMerge: input.requestMerge === true,
    };

    // ========================================================
    // 2. INSPECT (Git status and user changes check)
    // ========================================================
    currentStage = 'inspect';
    const gitStatus = await env.getGitStatus();
    let isolatedWorkspacePrepared = false;
    let activeBranch = gitStatus.branch;

    if (!gitStatus.clean) {
      // AGENTS.md rule 1: Do not overwrite user changes; work in separate branch/workspace
      const isolatedBranchName = `agent/patch-${input.taskId}`;
      await env.createIsolatedBranch(isolatedBranchName);
      isolatedWorkspacePrepared = true;
      activeBranch = isolatedBranchName;
    }

    const gitInspection: GitInspectionResult = {
      branch: activeBranch,
      clean: gitStatus.clean,
      uncommittedChanges: gitStatus.uncommittedFiles,
      isolatedWorkspacePrepared,
      activeWorkspacePath: this.config.workspaceRoot,
    };

    // ========================================================
    // 3. PLAN
    // ========================================================
    currentStage = 'plan';
    // Plan created: will implement target files and run verification suite

    // ========================================================
    // 4. IMPLEMENT
    // ========================================================
    currentStage = 'implement';
    if (input.filesToModify && input.filesToModify.length > 0) {
      for (const file of input.filesToModify) {
        await env.writeFile(file.path, file.content);
        if (!modifiedFiles.includes(file.path)) {
          modifiedFiles.push(file.path);
        }
      }
    }

    // ========================================================
    // 5. TEST
    // ========================================================
    currentStage = 'test';
    let lintResult = await env.runLint();
    let typecheckResult = await env.runTypecheck();
    let testResult = await env.runTests();
    let buildResult = await env.runBuild();

    let allTestsPassed =
      lintResult.passed && typecheckResult.passed && testResult.passed && buildResult.passed;

    // ========================================================
    // 6. DEBUG (Bounded repair loop, max N attempts)
    // ========================================================
    currentStage = 'debug';
    let repairAttempt = 0;

    while (!allTestsPassed && repairAttempt < this.config.maxRepairAttempts) {
      repairAttempt++;
      const failingStep = !lintResult.passed
        ? 'lint'
        : !typecheckResult.passed
          ? 'typecheck'
          : !testResult.passed
            ? 'test'
            : 'build';

      const errorOutput = !lintResult.passed
        ? lintResult.output
        : !typecheckResult.passed
          ? typecheckResult.output
          : !testResult.passed
            ? testResult.output
            : buildResult.output;

      let proposedFix = `Diagnosa dan perbaikan bug pada langkah ${failingStep}.`;
      let attemptModifiedFiles: string[] = [];

      if (input.customRepairLogic) {
        const repairRes = await input.customRepairLogic(repairAttempt, errorOutput, env);
        proposedFix = repairRes.proposedFix;
        attemptModifiedFiles = repairRes.filesModified;
        for (const f of attemptModifiedFiles) {
          if (!modifiedFiles.includes(f)) modifiedFiles.push(f);
        }
      }

      // Re-run test suite to verify fix
      lintResult = await env.runLint();
      typecheckResult = await env.runTypecheck();
      testResult = await env.runTests();
      buildResult = await env.runBuild();

      const retestPassed =
        lintResult.passed && typecheckResult.passed && testResult.passed && buildResult.passed;

      // AGENTS.md rule 2: setiap percobaan menyimpan bukti
      const proof: RepairAttemptProof = {
        attempt: repairAttempt,
        timestamp: new Date().toISOString(),
        failingStep,
        errorOutput,
        proposedFix,
        filesModified: attemptModifiedFiles,
        retestPassed,
      };
      repairProofs.push(proof);

      if (retestPassed) {
        allTestsPassed = true;
        break;
      }
    }

    // ========================================================
    // 7. REVIEW DIFF (Self-review diff & modified files)
    // ========================================================
    currentStage = 'review_diff';
    const diffData = await env.getDiff();
    for (const f of diffData.changedFiles) {
      if (!modifiedFiles.includes(f)) modifiedFiles.push(f);
    }

    // Basic security scan on diff (check for hardcoded secrets, dangerous tokens)
    let securityClean = true;
    let securityDetails = 'Tidak ditemukan secret, token bocor, atau syntax berbahaya dalam diff.';
    if (
      /api_key\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i.test(diffData.fullDiff) ||
      /secret\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i.test(diffData.fullDiff)
    ) {
      securityClean = false;
      securityDetails = 'Terdeteksi potensi hardcoded API key / secret dalam file perubahan.';
    }

    // ========================================================
    // 8. DOCUMENT
    // ========================================================
    currentStage = 'document';
    const artifacts = [
      {
        id: `artifact-diff-${input.taskId}`,
        title: 'Git Diff Review',
        content: diffData.fullDiff,
      },
      {
        id: `artifact-report-${input.taskId}`,
        title: 'Coding Task Execution Log',
        content: `Modified files: ${modifiedFiles.join(', ')}\nRepair attempts: ${repairAttempt}\nTests passed: ${allTestsPassed}`,
      },
    ];

    // ========================================================
    // 9. REPORT & EVALUATOR GATING
    // ========================================================
    currentStage = 'report';

    const codingEvidence: CodingEvidence = {
      lintPassed: lintResult.passed,
      lintOutput: lintResult.output,
      typecheckPassed: typecheckResult.passed,
      typecheckOutput: typecheckResult.output,
      testsPassed: testResult.passed,
      testsPassedCount: testResult.passedCount,
      testsFailedCount: testResult.failedCount,
      testOutput: testResult.output,
      buildPassed: buildResult.passed,
      buildOutput: buildResult.output,
      securityCheckPassed: securityClean,
      securityCheckDetails: securityDetails,
      requirementCoverage: allTestsPassed && securityClean ? 1.0 : 0.6,
      diffAvailable: diffData.changedFiles.length > 0 || modifiedFiles.length > 0,
      diffSummary: diffData.diffSummary,
      modifiedFiles,
    };

    const evalResult = this.evaluator.evaluate(codingEvidence);

    // If evaluator fails, task cannot be marked completed
    if (!evalResult.passed) {
      return {
        taskId: input.taskId,
        status: 'failed',
        summary: `Tugas coding gagal evaluasi: ${evalResult.completionBlockedReason ?? evalResult.remainingIssues.join(', ')}`,
        workflowStage: currentStage,
        gitInspection,
        modifiedFiles,
        diffSummary: diffData.diffSummary,
        fullDiff: diffData.fullDiff,
        testResults: {
          lint: lintResult.passed,
          typecheck: typecheckResult.passed,
          test: testResult.passed,
          build: buildResult.passed,
          details: testResult.output,
        },
        repairAttemptsCount: repairAttempt,
        repairProofs,
        evaluationResult: evalResult,
        artifacts,
        limitations: evalResult.remainingIssues,
        nextSteps: ['Perbaiki error pengujian atau security issue yang ditandai oleh evaluator.'],
      };
    }

    // ========================================================
    // HIGH-RISK APPROVAL CHECK (git push, merge, deploy)
    // ========================================================
    if (
      parsedRequirements.needsPush ||
      parsedRequirements.needsDeploy ||
      parsedRequirements.needsMerge
    ) {
      const highRiskAction = parsedRequirements.needsDeploy
        ? 'deploy:production'
        : parsedRequirements.needsMerge
          ? 'git:merge'
          : 'git:push';

      try {
        await this.guard.executeProtected(
          {
            actor: { id: input.userId, role: 'user' },
            action: highRiskAction,
            resource: `git://repo/${input.repoPath ?? 'main'}`,
            scope: 'external_git',
            context: {
              branch: activeBranch,
              taskId: input.taskId,
            },
          },
          async () => {
            // High-risk execution when approved
            if (highRiskAction === 'git:push' && env.pushGit) {
              await env.pushGit('origin', activeBranch);
            } else if (highRiskAction === 'git:merge' && env.mergeGit) {
              await env.mergeGit(activeBranch, this.config.targetBranch);
            } else if (highRiskAction === 'deploy:production' && env.deploy) {
              await env.deploy('production');
            }
          },
          { approvalId: input.approvalId },
        );
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          return {
            taskId: input.taskId,
            status: 'waiting_approval',
            summary: `Kode selesai diuji dan lulus Evaluator. Aksi '${highRiskAction}' menunggu persetujuan pengguna.`,
            workflowStage: currentStage,
            gitInspection,
            modifiedFiles,
            diffSummary: diffData.diffSummary,
            fullDiff: diffData.fullDiff,
            testResults: {
              lint: lintResult.passed,
              typecheck: typecheckResult.passed,
              test: testResult.passed,
              build: buildResult.passed,
            },
            repairAttemptsCount: repairAttempt,
            repairProofs,
            evaluationResult: evalResult,
            artifacts,
            limitations: [
              `Operasi ${highRiskAction} ditahan sampai pengguna memberikan approval eksplisit.`,
            ],
            nextSteps: ['Berikan approval melalui Inbox Approval untuk melanjutkan rilis.'],
            pendingApproval: {
              action: err.requiredApproval.action,
              resource: err.requiredApproval.resource,
              riskLevel: err.requiredApproval.riskLevel as RiskLevel,
              reason: err.message,
              fingerprint: err.requiredApproval.fingerprint,
            },
          };
        }
        throw err;
      }
    }

    return {
      taskId: input.taskId,
      status: 'completed',
      summary: `Perbaikan kode berhasil diimplementasikan dan diverifikasi oleh Evaluator (100% score).`,
      workflowStage: currentStage,
      gitInspection,
      modifiedFiles,
      diffSummary: diffData.diffSummary,
      fullDiff: diffData.fullDiff,
      testResults: {
        lint: lintResult.passed,
        typecheck: typecheckResult.passed,
        test: testResult.passed,
        build: buildResult.passed,
      },
      repairAttemptsCount: repairAttempt,
      repairProofs,
      evaluationResult: evalResult,
      artifacts,
      limitations: [],
      nextSteps: ['Review hasil pada diff artifact atau picu pipeline deploy jika diperlukan.'],
    };
  }
}
