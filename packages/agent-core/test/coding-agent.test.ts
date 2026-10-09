import assert from 'node:assert/strict';
import test from 'node:test';
import { CodingAgent, type CodingEnvironment } from '../src/index.ts';

test('CodingAgent: executes full 9-step workflow with controlled bug, protected workspace, and bounded repair loop', async () => {
  let isolatedBranchCreated = false;
  let testAttempts = 0;
  let bugFixed = false;
  const fileStore: Record<string, string> = {
    'src/calculator.ts': 'export function add(a: number, b: number) { return a - b; }', // BUG: minus instead of plus
  };

  const mockEnv: CodingEnvironment = {
    async getGitStatus() {
      // User has uncommitted files in workspace
      return {
        clean: false,
        branch: 'master',
        uncommittedFiles: ['notes.txt'],
      };
    },
    async createIsolatedBranch(branchName: string) {
      isolatedBranchCreated = true;
      assert.match(branchName, /agent\/patch-/);
    },
    async readFile(filePath: string) {
      return fileStore[filePath] ?? '';
    },
    async writeFile(filePath: string, content: string) {
      fileStore[filePath] = content;
    },
    async runLint() {
      return { passed: true, output: 'ESLint: 0 errors' };
    },
    async runTypecheck() {
      return { passed: true, output: 'tsc --noEmit: 0 errors' };
    },
    async runTests() {
      testAttempts++;
      if (!bugFixed) {
        return {
          passed: false,
          passedCount: 0,
          failedCount: 1,
          output: 'AssertionError: expected add(2, 2) to equal 4, but got 0',
        };
      }
      return {
        passed: true,
        passedCount: 5,
        failedCount: 0,
        output: 'All 5 test suites passed (100%)',
      };
    },
    async runBuild() {
      return { passed: true, output: 'Build successful' };
    },
    async getDiff() {
      return {
        diffSummary: 'src/calculator.ts: 1 line changed',
        fullDiff: '--- src/calculator.ts\n+++ src/calculator.ts\n- return a - b;\n+ return a + b;',
        changedFiles: ['src/calculator.ts'],
      };
    },
  };

  const agent = new CodingAgent({ maxRepairAttempts: 3 });

  const report = await agent.execute({
    taskId: 'task-bug-fix-01',
    userId: 'user-dev-1',
    instructions:
      'Perbaiki bug pada kalkulator yang menghasilkan pengurangan alih-alih penjumlahan',
    mockEnvironment: mockEnv,
    customRepairLogic: async (attempt, errorOutput, env) => {
      assert.equal(attempt, 1);
      assert.match(errorOutput, /AssertionError/);
      bugFixed = true;
      await env.writeFile(
        'src/calculator.ts',
        'export function add(a: number, b: number) { return a + b; }',
      );
      return {
        fixApplied: true,
        proposedFix: 'Ganti operator minus dengan plus pada fungsi add',
        filesModified: ['src/calculator.ts'],
      };
    },
  });

  // Verify workspace protection
  assert.equal(isolatedBranchCreated, true);
  assert.equal(report.gitInspection.clean, false);
  assert.equal(report.gitInspection.isolatedWorkspacePrepared, true);

  // Verify bounded repair loop proof collection
  assert.equal(testAttempts, 2);
  assert.equal(report.repairAttemptsCount, 1);
  assert.equal(report.repairProofs.length, 1);
  assert.equal(report.repairProofs[0]?.attempt, 1);
  assert.equal(report.repairProofs[0]?.failingStep, 'test');
  assert.equal(report.repairProofs[0]?.retestPassed, true);

  // Verify diff self-review
  assert.deepEqual(report.modifiedFiles, ['src/calculator.ts']);
  assert.match(report.diffSummary, /calculator\.ts/);

  // Verify Evaluator gating: passed 100%
  assert.equal(report.status, 'completed');
  assert.equal(report.evaluationResult.passed, true);
  assert.equal(report.evaluationResult.score, 1.0);
  assert.equal(report.artifacts.length, 2);
});

test('CodingAgent: requires approval before executing high-risk actions (git push, merge, deploy)', async () => {
  let pushCalled = false;

  const mockEnv: CodingEnvironment = {
    async getGitStatus() {
      return { clean: true, branch: 'master', uncommittedFiles: [] };
    },
    async createIsolatedBranch() {},
    async readFile() {
      return '';
    },
    async writeFile() {},
    async runLint() {
      return { passed: true, output: 'ok' };
    },
    async runTypecheck() {
      return { passed: true, output: 'ok' };
    },
    async runTests() {
      return { passed: true, passedCount: 1, failedCount: 0, output: 'ok' };
    },
    async runBuild() {
      return { passed: true, output: 'ok' };
    },
    async getDiff() {
      return { diffSummary: '1 file changed', fullDiff: '+ code', changedFiles: ['src/app.ts'] };
    },
    async pushGit() {
      pushCalled = true;
      return { success: true, output: 'Pushed to origin/master' };
    },
  };

  const agent = new CodingAgent();

  // 1. Without approval -> enters waiting_approval
  const unapprovedReport = await agent.execute({
    taskId: 'task-push-req',
    userId: 'user-dev-1',
    instructions: 'Deploy dan push perubahan ke GitHub',
    mockEnvironment: mockEnv,
    requestPush: true,
  });

  assert.equal(unapprovedReport.status, 'waiting_approval');
  assert.equal(pushCalled, false);
  assert.ok(unapprovedReport.pendingApproval);
  assert.equal(unapprovedReport.pendingApproval.action, 'git:push');
  assert.equal(unapprovedReport.pendingApproval.riskLevel, 'HIGH');
  assert.ok(unapprovedReport.pendingApproval.fingerprint);
});

test('CodingAgent: Evaluator strictly BLOCKS completed status when repair attempts exceed limit', async () => {
  const mockEnv: CodingEnvironment = {
    async getGitStatus() {
      return { clean: true, branch: 'master', uncommittedFiles: [] };
    },
    async createIsolatedBranch() {},
    async readFile() {
      return '';
    },
    async writeFile() {},
    async runLint() {
      return { passed: true, output: 'ok' };
    },
    async runTypecheck() {
      return { passed: true, output: 'ok' };
    },
    async runTests() {
      // Test permanently failing
      return {
        passed: false,
        passedCount: 0,
        failedCount: 2,
        output: 'Failed 2 critical integration tests',
      };
    },
    async runBuild() {
      return { passed: true, output: 'ok' };
    },
    async getDiff() {
      return { diffSummary: '1 file changed', fullDiff: '+ code', changedFiles: ['src/broken.ts'] };
    },
  };

  const agent = new CodingAgent({ maxRepairAttempts: 2 });

  const failedReport = await agent.execute({
    taskId: 'task-failing-bug',
    userId: 'user-dev-1',
    instructions: 'Perbaiki bug kompleks',
    mockEnvironment: mockEnv,
  });

  // Evaluator gating: MUST NOT claim completed!
  assert.equal(failedReport.status, 'failed');
  assert.equal(failedReport.evaluationResult.passed, false);
  assert.ok(failedReport.evaluationResult.completionBlockedReason);
  assert.equal(failedReport.repairAttemptsCount, 2);
  assert.equal(failedReport.repairProofs.length, 2);
});

test('CodingAgent: Evaluator strictly BLOCKS completed status if security check detects leaked secret in diff', async () => {
  const mockEnv: CodingEnvironment = {
    async getGitStatus() {
      return { clean: true, branch: 'master', uncommittedFiles: [] };
    },
    async createIsolatedBranch() {},
    async readFile() {
      return '';
    },
    async writeFile() {},
    async runLint() {
      return { passed: true, output: 'ok' };
    },
    async runTypecheck() {
      return { passed: true, output: 'ok' };
    },
    async runTests() {
      return { passed: true, passedCount: 1, failedCount: 0, output: 'ok' };
    },
    async runBuild() {
      return { passed: true, output: 'ok' };
    },
    async getDiff() {
      // Leaked secret in diff!
      return {
        diffSummary: 'config updated',
        fullDiff: "+ const api_key = 'abcdef1234567890abcdef123456';",
        changedFiles: ['src/config.ts'],
      };
    },
  };

  const agent = new CodingAgent();

  const leakedSecretReport = await agent.execute({
    taskId: 'task-secret-leak',
    userId: 'user-dev-1',
    instructions: 'Update config credentials',
    mockEnvironment: mockEnv,
  });

  assert.equal(leakedSecretReport.status, 'failed');
  assert.equal(leakedSecretReport.evaluationResult.passed, false);
  assert.match(
    leakedSecretReport.evaluationResult.remainingIssues[0] ?? '',
    /Security issue|potensi hardcoded/i,
  );
});
