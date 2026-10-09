import assert from 'node:assert/strict';
import test from 'node:test';
import { CodingAgent, ResearchAgent } from '../src/index.ts';

test('Evaluator Gating: coding task completion is strictly BLOCKS when evaluator fails', async () => {
  const agent = new CodingAgent({ maxRepairAttempts: 1 });

  // 1. Coding task with failing tests
  const failingTestReport = await agent.execute({
    taskId: 'gate-coding-fail-test',
    userId: 'user-gate',
    instructions: 'Perbaiki kode tapi test selalu gagal',
    mockEnvironment: {
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
        return {
          passed: false,
          passedCount: 0,
          failedCount: 1,
          output: 'SyntaxError in test suite',
        };
      },
      async runBuild() {
        return { passed: true, output: 'ok' };
      },
      async getDiff() {
        return { diffSummary: 'changed', fullDiff: '+ bad code', changedFiles: ['test.ts'] };
      },
    },
  });

  assert.equal(failingTestReport.status, 'failed');
  assert.equal(failingTestReport.evaluationResult.passed, false);
  assert.match(
    failingTestReport.evaluationResult.completionBlockedReason ?? '',
    /Coding criteria incomplete/i,
  );
  assert.notEqual(failingTestReport.status, 'completed');

  // 2. Coding task with empty diff / no changes
  const missingDiffReport = await agent.execute({
    taskId: 'gate-coding-no-diff',
    userId: 'user-gate',
    instructions: 'Tugas coding tanpa menghasilkan diff apapun',
    mockEnvironment: {
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
        return { diffSummary: '', fullDiff: '', changedFiles: [] };
      },
    },
  });

  assert.equal(missingDiffReport.status, 'failed');
  assert.equal(missingDiffReport.evaluationResult.passed, false);
  assert.match(
    missingDiffReport.evaluationResult.completionBlockedReason ?? '',
    /Diff issue|Coding criteria incomplete/i,
  );
  assert.notEqual(missingDiffReport.status, 'completed');
});

test('Evaluator Gating: research task completion is strictly BLOCKED when citations or sources are invalid', async () => {
  const agent = new ResearchAgent();

  // 1. Research task with low quality sources (credibility < 0.6)
  const lowQualityReport = await agent.execute({
    taskId: 'gate-research-low-quality',
    userId: 'user-gate',
    query: 'Riset dengan sumber abal-abal',
    mockSources: [
      {
        id: 'src-spam',
        url: 'https://random-spam-blog.xyz/post',
        title: 'Random Post',
        domain: 'random-spam-blog.xyz',
        credibilityScore: 0.3, // Below 0.6 threshold!
        snippet: 'Klaim tanpa bukti',
      },
    ],
    mockClaims: [
      {
        id: 'c1',
        statement: 'Klaim fakta dari blog tidak kredibel',
        type: 'sourced_fact',
        sourceIds: ['src-spam'],
        confidence: 0.3,
      },
    ],
  });

  assert.equal(lowQualityReport.status, 'failed');
  assert.equal(lowQualityReport.evaluationResult.passed, false);
  assert.match(
    lowQualityReport.evaluationResult.completionBlockedReason ?? '',
    /Source quality|Research criteria incomplete/i,
  );
  assert.notEqual(lowQualityReport.status, 'completed');

  // 2. Research task with missing citation on factual claim
  const unlinkedFactReport = await agent.execute({
    taskId: 'gate-research-unlinked-fact',
    userId: 'user-gate',
    query: 'Riset dengan klaim fakta tanpa rujukan sumber',
    mockSources: [
      {
        id: 'src-1',
        url: 'https://developer.mozilla.org/doc',
        title: 'MDN',
        domain: 'developer.mozilla.org',
        credibilityScore: 0.95,
        snippet: 'Docs',
      },
      {
        id: 'src-2',
        url: 'https://nodejs.org/doc',
        title: 'Node',
        domain: 'nodejs.org',
        credibilityScore: 0.9,
        snippet: 'Docs',
      },
    ],
    mockClaims: [
      {
        id: 'c1',
        statement: 'Fakta diklaim tapi array sourceIds kosong',
        type: 'sourced_fact',
        sourceIds: [], // Missing citation!
        confidence: 0.9,
      },
    ],
  });

  assert.equal(unlinkedFactReport.status, 'failed');
  assert.equal(unlinkedFactReport.evaluationResult.passed, false);
  assert.match(
    unlinkedFactReport.evaluationResult.completionBlockedReason ?? '',
    /Citation mapping|Research criteria incomplete/i,
  );
  assert.notEqual(unlinkedFactReport.status, 'completed');
});
