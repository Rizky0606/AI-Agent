import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SkillEvolutionEngine,
  SkillRegistry,
  SkillPermissionViolationError,
  type SkillManifest,
  type TaskEvaluationContext,
} from '../src/index.ts';

test('SkillEvolutionEngine: Evaluator hanya dapat mengusulkan skill setelah kondisi terpenuhi', () => {
  const engine = new SkillEvolutionEngine();

  // 1. Task gagal (status !== completed) HARUS DITOLAK
  const failedTaskCtx: TaskEvaluationContext = {
    taskId: 'task-fail-1',
    status: 'failed',
    prompt: 'Implement auth module',
    evaluation: {
      passed: false,
      score: 0.3,
      confidence: 0.9,
      selfClaimRejected: false,
    },
  };
  const check1 = engine.checkEligibility(failedTaskCtx);
  assert.equal(check1.eligible, false);
  assert.ok(check1.reason.includes('bukan \'completed\''));

  // 2. Evaluator tidak lulus (passed === false) HARUS DITOLAK
  const evalFailedCtx: TaskEvaluationContext = {
    taskId: 'task-eval-failed',
    status: 'completed',
    prompt: 'Run tests and fix linter',
    evaluation: {
      passed: false,
      score: 0.7,
      confidence: 0.8,
      selfClaimRejected: false,
    },
  };
  const check2 = engine.checkEligibility(evalFailedCtx);
  assert.equal(check2.eligible, false);
  assert.ok(check2.reason.includes('Evaluasi task tidak lulus'));

  // 3. Skor di bawah ambang batas (< 0.85) HARUS DITOLAK
  const lowScoreCtx: TaskEvaluationContext = {
    taskId: 'task-low-score',
    status: 'completed',
    prompt: 'Refactor database queries',
    evaluation: {
      passed: true,
      score: 0.80, // < 0.85
      confidence: 0.85,
      selfClaimRejected: false,
    },
  };
  const check3 = engine.checkEligibility(lowScoreCtx);
  assert.equal(check3.eligible, false);
  assert.ok(check3.reason.includes('di bawah ambang batas kelayakan'));

  // 4. Klaim sepihak agen ditolak oleh evaluator HARUS DITOLAK
  const selfClaimCtx: TaskEvaluationContext = {
    taskId: 'task-self-claim',
    status: 'completed',
    prompt: 'Optimize API response time',
    evaluation: {
      passed: true,
      score: 0.95,
      confidence: 0.9,
      selfClaimRejected: true,
    },
  };
  const check4 = engine.checkEligibility(selfClaimCtx);
  assert.equal(check4.eligible, false);
  assert.ok(check4.reason.includes('Klaim sepihak agen ditolak'));

  // 5. Kondisi terpenuhi sempurna (completed + passed + score >= 0.85 + no selfClaim) HARUS DITERIMA
  const perfectCtx: TaskEvaluationContext = {
    taskId: 'task-success-perfect',
    status: 'completed',
    prompt: 'Extract and validate JSON schema from raw telemetry data',
    toolCalls: ['workspace:read', 'telemetry:extract'],
    evaluation: {
      passed: true,
      score: 0.95,
      confidence: 0.95,
      selfClaimRejected: false,
      remainingIssues: [],
    },
  };
  const check5 = engine.checkEligibility(perfectCtx);
  assert.equal(check5.eligible, true);
  assert.ok(check5.reason.includes('memenuhi kriteria keberhasilan'));
});

test('SkillEvolutionEngine: Secret dan credential dalam proposal disanitasi/ditolak', () => {
  const engine = new SkillEvolutionEngine();

  const ctx: TaskEvaluationContext = {
    taskId: 'task-secret-test',
    status: 'completed',
    prompt: 'Configure API with key sk-12345678901234567890 and password "supersecret"',
    evaluation: {
      passed: true,
      score: 0.92,
      confidence: 0.9,
      selfClaimRejected: false,
    },
  };

  const proposal = engine.createProposal(ctx, {
    skillName: 'telemetry-parser',
    description: 'Parser telemetry dengan Bearer eyJhbGciOiJIUzI1NiJ9.token dan sk-proj-1234567890abcdef123456 serta password: "my-secret-pass"',
    promptInstructions: 'Gunakan token Bearer eyJhbGciOiJIUzI1NiJ9.secret untuk auth',
  });

  // Verify secret tokens and keys are sanitized to REDACTED
  assert.ok(!proposal.purpose.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!proposal.purpose.includes('sk-proj-1234567890abcdef123456'));
  assert.ok(!proposal.purpose.includes('my-secret-pass'));
  assert.ok(proposal.purpose.includes('[REDACTED_TOKEN]'));
  assert.ok(proposal.purpose.includes('[REDACTED_API_KEY]'));
  assert.ok(proposal.purpose.includes('[REDACTED_CREDENTIAL]'));

  // Safety verification confirms sanitized proposal is safe
  const safety = engine.verifyProposalSafety(proposal);
  assert.equal(safety.safe, true);
});

test('SkillEvolutionEngine: Proposal tidak dapat meminta permission terlarang atau memuat aksi berbahaya', () => {
  const engine = new SkillEvolutionEngine();

  const ctx: TaskEvaluationContext = {
    taskId: 'task-privilege-escalation',
    status: 'completed',
    prompt: 'Reboot system and clean root directory',
    evaluation: {
      passed: true,
      score: 0.95,
      confidence: 0.9,
      selfClaimRejected: false,
    },
  };

  // 1. Attempting forbidden system actions throws immediately
  assert.throws(
    () => {
      engine.createProposal(ctx, {
        skillName: 'root-cleaner',
        permissions: [
          {
            action: 'system:rmdir_root',
            resource: '/',
            scope: 'system',
            riskLevel: 'CRITICAL',
            reason: 'Wipe root',
          },
        ],
      });
    },
    (err: Error) => err instanceof SkillPermissionViolationError && /di luar batas keamanan/i.test(err.message),
  );

  // 2. Attempting security policy override or arbitrary package evaluation
  assert.throws(
    () => {
      engine.createProposal(ctx, {
        skillName: 'policy-bypass',
        permissions: [
          {
            action: 'security:override_policy',
            resource: 'all',
            scope: 'admin',
            riskLevel: 'CRITICAL',
            reason: 'Bypass guard',
          },
        ],
      });
    },
    (err: Error) => err instanceof SkillPermissionViolationError,
  );
});

test('SkillEvolutionEngine: Sandbox test harness evaluates test cases with bounded timeout and retries', async () => {
  const engine = new SkillEvolutionEngine();

  const sampleManifest: SkillManifest = {
    name: 'math-doubler',
    version: '1.0.0',
    description: 'Doubles an input number',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolRequirements: [],
    permissions: [],
    compatibility: {},
  };

  // 1. Successful handler passes test harness
  const successHandler = async (input: Record<string, unknown>) => {
    const val = Number(input['num'] ?? 0);
    return { result: val * 2 };
  };

  const passTestCases = [
    { name: 'double-2', input: { num: 2 }, expectedOutput: { result: 4 } },
    { name: 'double-5', input: { num: 5 }, expectedOutput: { result: 10 } },
  ];

  const run1 = await engine.runSandboxTestHarness(sampleManifest, passTestCases, successHandler);
  assert.equal(run1.allPassed, true);
  assert.equal(run1.passedCount, 2);
  assert.equal(run1.failedCount, 0);

  // 2. Failing handler is caught by test harness
  const failingHandler = async () => {
    throw new Error('Simulation crash in calculation');
  };

  const run2 = await engine.runSandboxTestHarness(sampleManifest, passTestCases, failingHandler, {
    maxRetries: 1, // Bounded retry: attempts once then terminates
  });
  assert.equal(run2.allPassed, false);
  assert.equal(run2.failedCount, 2);
  assert.ok(run2.results[0]?.error?.includes('Simulation crash'));
});

test('SkillEvolutionEngine: Skill gagal tes TIDAK DAPAT disetujui untuk aktivasi', () => {
  const engine = new SkillEvolutionEngine();

  const ctx: TaskEvaluationContext = {
    taskId: 'task-test-gate',
    status: 'completed',
    prompt: 'Process telemetry stream',
    evaluation: { passed: true, score: 0.90, confidence: 0.9, selfClaimRejected: false },
  };

  const proposal = engine.createProposal(ctx, {
    skillName: 'telemetry-stream-processor',
  });

  // Mark testStatus as failed (e.g. after sandbox test harness failed)
  proposal.testStatus = 'failed';

  const safety = engine.verifyProposalSafety(proposal);
  assert.equal(safety.safe, false);
  assert.ok(safety.issues.some((i) => i.includes('testStatus: failed')));
});

test('SkillRegistry: Pemisahan tegas approval vs aktivasi dan circuit breaker auto-disable pada kegagalan', async () => {
  const registry = new SkillRegistry();

  const manifest: SkillManifest = {
    name: 'flaky-service-caller',
    version: '1.0.0',
    description: 'Calls an external flaky service',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolRequirements: [],
    permissions: [],
    compatibility: {},
  };

  // Registering skill (when approved, registered disabled by default)
  registry.registerSkill(manifest);
  registry.disableSkill('flaky-service-caller'); // ADR 0029 contract: Approved skills remain DISABLED by default!

  const skill = registry.getSkill('flaky-service-caller');
  assert.ok(skill);
  assert.equal(skill.isEnabled, false, 'Skill baru wajib nonaktif by default sampai diaktifkan eksplisit');

  // Attempt to execute disabled skill throws SkillDisabledError
  let callCount = 0;
  registry.registerSkill(manifest, async () => {
    callCount++;
    throw new Error('Service 503 Outage');
  });

  await assert.rejects(
    () => registry.executeSkill('flaky-service-caller', {}, { userId: 'u1' }),
    /sedang dinonaktifkan/,
  );
  assert.equal(callCount, 0, 'Disabled skill cannot execute');

  // User explicitly enables skill
  registry.enableSkill('flaky-service-caller');
  assert.equal(skill.isEnabled, true);

  // Execute 3 consecutive failures to trigger circuit breaker
  for (let i = 1; i <= 3; i++) {
    await assert.rejects(
      () => registry.executeSkill('flaky-service-caller', {}, { userId: 'u1' }),
      /Service 503 Outage/,
    );
  }

  // Circuit breaker should have automatically disabled the skill!
  assert.equal(skill.isEnabled, false, 'Circuit breaker must auto-disable skill after 3 consecutive failures');
  assert.equal(skill.consecutiveFailures, 3);
  assert.ok(skill.autoDisabledReason?.includes('otomatis dinonaktifkan'));

  // Subsequent call is blocked by disabled state
  await assert.rejects(
    () => registry.executeSkill('flaky-service-caller', {}, { userId: 'u1' }),
    /sedang dinonaktifkan/,
  );
});

test('SkillRegistry: Versioning dan Rollback mengembalikan ke versi yang diketahui baik (known-good version)', async () => {
  const registry = new SkillRegistry();

  // Version 1.0.0 (Known-good)
  const v1Manifest: SkillManifest = {
    name: 'text-formatter',
    version: '1.0.0',
    description: 'Formats text reliably',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolRequirements: [],
    permissions: [],
    compatibility: {},
  };
  registry.registerSkill(v1Manifest, async (input: { text?: string }) => ({ text: (input.text || '').toUpperCase() }));

  const v1 = registry.getSkill('text-formatter')!;
  assert.equal(v1.version, '1.0.0');

  // Evolve to Version 1.1.0 (Flaky improvement)
  const v2Manifest: SkillManifest = {
    ...v1Manifest,
    version: '1.1.0',
    description: 'Formats text with buggy experimental logic',
  };
  registry.registerSkill(v2Manifest, async () => {
    throw new Error('Bug in v1.1.0 experimental logic');
  });

  const v2 = registry.getSkill('text-formatter')!;
  assert.equal(v2.version, '1.1.0');
  assert.equal(registry.getRevisions('text-formatter').length, 1);

  // Trigger failure on v1.1.0
  await assert.rejects(() => registry.executeSkill('text-formatter', { text: 'hello' }, { userId: 'u1' }));
  assert.equal(v2.consecutiveFailures, 1);

  // Rollback to v1.0.0
  const rolledBack = registry.rollbackSkill('text-formatter', '1.0.0');
  assert.equal(rolledBack.version, '1.0.0');
  assert.equal(rolledBack.description, 'Formats text reliably');
  assert.equal(rolledBack.consecutiveFailures, 0, 'Rollback resets failure count');
  assert.equal(rolledBack.autoDisabledReason, null);

  // Executing rolled-back version succeeds with known-good handler logic
  registry.registerSkill(v1Manifest, async (input: { text?: string }) => ({ text: (input.text || '').toUpperCase() }));
  const out = await registry.executeSkill<{ text: string }, { text: string }>(
    'text-formatter',
    { text: 'hello' },
    { userId: 'u1' },
  );
  assert.equal(out.text, 'HELLO');
});
