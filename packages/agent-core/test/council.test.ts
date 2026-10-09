import assert from 'node:assert/strict';
import test from 'node:test';
import { AiCouncil, type CouncilParticipant, type EvidenceItem } from '../src/index.ts';

const participant1: CouncilParticipant = {
  id: 'p-sec',
  name: 'Security Reviewer',
  perspective: 'security',
};

const participant2: CouncilParticipant = {
  id: 'p-arch',
  name: 'Architecture Reviewer',
  perspective: 'architecture',
};

const participant3: CouncilParticipant = {
  id: 'p-perf',
  name: 'Performance Reviewer',
  perspective: 'performance',
};

const participantExtra: CouncilParticipant = {
  id: 'p-extra',
  name: 'Extra Reviewer',
  perspective: 'general',
};

test('AiCouncil: enforces strict participant cap (<= 3) and round cap (<= 2) per ADR 0003', () => {
  // Exceeding 3 participants throws
  assert.throws(
    () => new AiCouncil([participant1, participant2, participant3, participantExtra]),
    /strictly capped at maximum 3 participants/,
  );

  // Exceeding 2 rounds throws
  assert.throws(
    () => new AiCouncil([participant1, participant2], { maxRounds: 5 }),
    /strictly capped at maximum 2 rounds/,
  );

  // 0 participants throws
  assert.throws(() => new AiCouncil([]), /requires at least 1 participant/);
});

test('AiCouncil: halts early and reports budget_exhausted when token or cost cap is reached', async () => {
  // Council with tight token limit of 300 tokens
  const council = new AiCouncil(
    [participant1, participant2],
    { maxTotalTokens: 300, maxCostUsd: 0.05 },
    async (p, round) => ({
      participantId: p.id,
      round,
      stance: 'approve',
      argument: 'Looks fine',
      tokenCount: 200, // Two opinions will reach 400 tokens > 300 limit
      costUsd: 0.001,
    }),
  );

  const res = await council.deliberate('Refactor DB pooling', []);
  assert.equal(res.status, 'budget_exhausted');
  assert.ok(res.totalTokens >= 300);
});

test('AiCouncil: evidence-based judge strictly REJECTS proposal when empirical evidence fails, despite unanimous reviewer approval', async () => {
  // Reviewers mistakenly approve the change
  const council = new AiCouncil([participant1, participant2], undefined, async (p, round) => ({
    participantId: p.id,
    round,
    stance: 'approve',
    argument: 'Subjectively looks good to me without running tests.',
    tokenCount: 100,
    costUsd: 0.0005,
  }));

  // BUT empirical evidence shows tests failed!
  const failingEvidence: EvidenceItem[] = [
    {
      id: 'ev-test-1',
      type: 'test_output',
      passed: false,
      description: 'Unit test suite failed: 3 assertions failed in auth.test.ts',
    },
    {
      id: 'ev-scan-1',
      type: 'security_audit',
      passed: true,
      description: 'Dependency audit: 0 vulnerabilities found',
    },
  ];

  const res = await council.deliberate('Deploy Auth Patch', failingEvidence);

  // Empirical test failure MUST override reviewer opinions
  assert.equal(res.judgeEvaluation.verdict, 'rejected');
  assert.equal(res.judgeEvaluation.decisionBasis, 'empirical_evidence');
  assert.ok(res.judgeEvaluation.rationale.includes('failing empirical evidence'));
  assert.equal(res.judgeEvaluation.evidenceWeighed.verifiedFailed, 1);
});

test('AiCouncil: judge requires empirical evidence and withholds approval when evidence is missing', async () => {
  const council = new AiCouncil([participant1], undefined, async (p, round) => ({
    participantId: p.id,
    round,
    stance: 'approve',
    argument: 'Approved.',
    tokenCount: 50,
    costUsd: 0.0001,
  }));

  // No evidence provided
  const res = await council.deliberate('Update schema', []);
  assert.equal(res.judgeEvaluation.verdict, 'needs_revision');
  assert.ok(res.judgeEvaluation.rationale.includes('No empirical evidence provided'));
});

test('AiCouncil: judge APPROVES when empirical evidence passes and reviewers agree', async () => {
  const council = new AiCouncil([participant1, participant2]);

  const passingEvidence: EvidenceItem[] = [
    {
      id: 'ev-1',
      type: 'test_output',
      passed: true,
      description: 'node --test passed: 21 tests, 0 failures',
    },
    {
      id: 'ev-2',
      type: 'typecheck',
      passed: true,
      description: 'tsc --noEmit exited with 0',
    },
  ];

  const res = await council.deliberate('Merge PR #42', passingEvidence);
  assert.equal(res.judgeEvaluation.verdict, 'approved');
  assert.equal(res.judgeEvaluation.decisionBasis, 'empirical_evidence');
  assert.equal(res.judgeEvaluation.evidenceWeighed.verifiedPassed, 2);
});
