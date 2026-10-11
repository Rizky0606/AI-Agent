import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ApprovalRequiredError,
  PermissionEngine,
  SecuredCapabilityGuard,
} from '@personal-ai-os/permissions';
import {
  CODING_QUALITY_CHECKLIST_MANIFEST,
  codingQualityChecklistHandler,
  ManifestValidator,
  ON_TOPIC_GUARD_MANIFEST,
  onTopicGuardHandler,
  RESEARCH_QUALITY_CHECKLIST_MANIFEST,
  researchQualityChecklistHandler,
  SkillDisabledError,
  SkillExecutor,
  SkillIncompatibleError,
  SkillLoader,
  SkillNotFoundError,
  SkillPermissionViolationError,
  SkillRegistry,
  SkillValidationError,
} from '../src/index.ts';

test('ManifestValidator: accepts valid manifest and rejects damaged manifests', () => {
  const validator = new ManifestValidator({ currentVersion: '0.2.0', currentPlatform: 'node' });

  // 1. Valid manifests pass
  const valid = validator.validate(ON_TOPIC_GUARD_MANIFEST);
  assert.equal(valid.name, 'on-topic-guard');
  assert.equal(valid.version, '1.0.0');
  assert.equal(
    validator.validate(CODING_QUALITY_CHECKLIST_MANIFEST).name,
    'coding-quality-checklist',
  );
  assert.equal(
    validator.validate(RESEARCH_QUALITY_CHECKLIST_MANIFEST).name,
    'research-quality-checklist',
  );

  // 2. Missing name or invalid kebab-case
  assert.throws(
    () => {
      validator.validate({
        ...ON_TOPIC_GUARD_MANIFEST,
        name: 'Invalid_Skill_Name',
      });
    },
    (err: Error) => err instanceof SkillValidationError && /kebab-case/i.test(err.message),
  );

  // 3. Invalid semver
  assert.throws(
    () => {
      validator.validate({
        ...ON_TOPIC_GUARD_MANIFEST,
        version: 'v1', // not a valid semver
      });
    },
    (err: Error) => err instanceof SkillValidationError && /semver/i.test(err.message),
  );

  // 4. Missing required schemas or descriptions
  assert.throws(
    () => {
      validator.validate({
        name: 'test-skill',
        version: '1.0.0',
        description: 'short',
      });
    },
    (err: Error) => err instanceof SkillValidationError,
  );
});

test('ManifestValidator: rejects incompatible agent core version or platform', () => {
  const validator = new ManifestValidator({ currentVersion: '0.2.0', currentPlatform: 'linux' });

  // Incompatible agentCoreVersion
  assert.throws(
    () => {
      validator.validate({
        ...ON_TOPIC_GUARD_MANIFEST,
        compatibility: {
          agentCoreVersion: '>=2.0.0', // current is 0.2.0!
        },
      });
    },
    (err: Error) => err instanceof SkillIncompatibleError && /agentCoreVersion/i.test(err.message),
  );

  // Incompatible platform
  assert.throws(
    () => {
      validator.validate({
        ...ON_TOPIC_GUARD_MANIFEST,
        compatibility: {
          platforms: ['darwin'], // current is linux!
        },
      });
    },
    (err: Error) => err instanceof SkillIncompatibleError && /platform/i.test(err.message),
  );
});

test('ManifestValidator: rejects skill requesting forbidden / excessive permissions outside boundaries', () => {
  const validator = new ManifestValidator();

  // Skill attempts to declare system:shutdown
  assert.throws(
    () => {
      validator.validate({
        ...ON_TOPIC_GUARD_MANIFEST,
        permissions: [
          {
            action: 'system:shutdown',
            resource: 'host://machine',
            scope: 'system',
            riskLevel: 'CRITICAL',
            reason: 'Malicious shutdown request',
          },
        ],
      });
    },
    (err: Error) =>
      err instanceof SkillPermissionViolationError && /di luar batas keamanan/i.test(err.message),
  );

  // Skill attempts to declare auth:revoke_all
  assert.throws(
    () => {
      validator.validate({
        ...ON_TOPIC_GUARD_MANIFEST,
        permissions: [
          {
            action: 'auth:revoke_all',
            resource: 'auth://master',
            scope: 'auth',
            riskLevel: 'CRITICAL',
            reason: 'Revoke keys',
          },
        ],
      });
    },
    (err: Error) => err instanceof SkillPermissionViolationError,
  );
});

test('SkillExecutor: enforces Permission Engine gate and refuses to bypass policy', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const executor = new SkillExecutor(guard);

  // Skill with HIGH risk action (git:push)
  const highRiskManifest = {
    ...ON_TOPIC_GUARD_MANIFEST,
    name: 'auto-pusher-skill',
    permissions: [
      {
        action: 'git:push',
        resource: 'git://repo',
        scope: 'external_git',
        riskLevel: 'HIGH' as const,
        reason: 'Pushing code to remote repo',
      },
    ],
  };

  const dummyHandler = async () => ({ executed: true });

  // 1. Without approval, execution MUST fail with ApprovalRequiredError (Rule 9)
  await assert.rejects(async () => {
    await executor.executeSkill(
      { manifest: highRiskManifest, isEnabled: true },
      dummyHandler,
      {},
      { userId: 'user-1' },
    );
  }, ApprovalRequiredError);

  // 2. Disabled skill throws SkillDisabledError
  await assert.rejects(async () => {
    await executor.executeSkill(
      { manifest: ON_TOPIC_GUARD_MANIFEST, isEnabled: false },
      dummyHandler,
      {},
      { userId: 'user-1' },
    );
  }, SkillDisabledError);
});

test('SkillRegistry: supports register, list, enable, disable, and version rollback', () => {
  const registry = new SkillRegistry();

  // Register v1.0.0
  const reg1 = registry.registerSkill(ON_TOPIC_GUARD_MANIFEST);
  assert.equal(reg1.name, 'on-topic-guard');
  assert.equal(reg1.version, '1.0.0');
  assert.equal(reg1.isEnabled, true);

  // Disable skill
  const disabled = registry.disableSkill('on-topic-guard');
  assert.equal(disabled.isEnabled, false);
  assert.equal(registry.listSkills({ isEnabled: true }).length, 0);

  // Enable skill
  const enabled = registry.enableSkill('on-topic-guard');
  assert.equal(enabled.isEnabled, true);
  assert.equal(registry.listSkills({ isEnabled: true }).length, 1);

  // Update with v1.1.0
  const v2Manifest = {
    ...ON_TOPIC_GUARD_MANIFEST,
    version: '1.1.0',
    description: 'Updated on topic guard v1.1.0 with advanced heuristics',
  };
  const updated = registry.registerSkill(v2Manifest);
  assert.equal(updated.version, '1.1.0');

  // Verify revision history exists
  const history = registry.getRevisions('on-topic-guard');
  assert.equal(history.length, 1);
  assert.equal(history[0]?.version, '1.0.0');

  // Rollback to v1.0.0
  const rolledBack = registry.rollbackSkill('on-topic-guard', '1.0.0');
  assert.equal(rolledBack.version, '1.0.0');
  assert.equal(registry.getSkill('on-topic-guard')?.version, '1.0.0');

  // Non-existent skill throws SkillNotFoundError
  assert.throws(
    () => registry.enableSkill('non-existent-skill'),
    (err: Error) => err instanceof SkillNotFoundError,
  );
});

test('Builtin Skill: on-topic-guard correctly flags alignment and deviations', async () => {
  const context = { userId: 'u1' };

  // On-topic scenario
  const goodRes = await onTopicGuardHandler(
    {
      goal: 'Perbaiki bug otentikasi login',
      acceptanceCriteria: ['Token divalidasi', 'User berhasil login'],
      proposedActionOrOutput:
        'Memeriksa fungsi verifikasi token login dan memperbaiki validasi password hash',
    },
    context,
  );
  assert.equal(goodRes.isOnTopic, true);
  assert.ok(goodRes.alignmentScore >= 0.5);

  // Off-topic scenario
  const badRes = await onTopicGuardHandler(
    {
      goal: 'Perbaiki bug otentikasi login',
      acceptanceCriteria: ['Token divalidasi'],
      proposedActionOrOutput: 'Beli voucher game online dan kirim transfer dana',
    },
    context,
  );
  assert.equal(badRes.isOnTopic, false);
  assert.ok(badRes.deviationReason);
  assert.ok(badRes.suggestions && badRes.suggestions.length > 0);
});

test('Builtin Skill: coding-quality-checklist audits code, tests, and secret hygiene', async () => {
  const context = { userId: 'u1' };

  // 1. Clean code
  const cleanRes = await codingQualityChecklistHandler(
    {
      codeOrDiff:
        'export function sum(a: number, b: number) { try { return a + b; } catch (err) { throw err; } }',
      testResultsSummary: 'All 15 tests passed cleanly',
      modifiedFiles: ['src/math.ts'],
    },
    context,
  );
  assert.equal(cleanRes.passed, true);
  assert.ok(cleanRes.score >= 0.75);
  assert.equal(cleanRes.criticalIssues.length, 0);

  // 2. Code with hardcoded secret
  const leakedRes = await codingQualityChecklistHandler(
    {
      codeOrDiff: 'const api_key = "abcdef1234567890abcdef123456";',
    },
    context,
  );
  assert.equal(leakedRes.passed, false);
  assert.ok(leakedRes.criticalIssues.length > 0);
  assert.match(leakedRes.criticalIssues[0] ?? '', /hardcoded secret/i);
});

test('Builtin Skill: research-quality-checklist verifies sources, claims, and citation mapping', async () => {
  const context = { userId: 'u1' };

  // 1. Valid research
  const validRes = await researchQualityChecklistHandler(
    {
      query: 'Arsitektur Node.js',
      sources: [
        { id: 's1', url: 'https://nodejs.org/doc', domain: 'nodejs.org', credibilityScore: 0.95 },
        {
          id: 's2',
          url: 'https://developer.mozilla.org/doc',
          domain: 'developer.mozilla.org',
          credibilityScore: 0.9,
        },
      ],
      claims: [
        { statement: 'Event loop berbasis libuv', type: 'sourced_fact', sourceIds: ['s1', 's2'] },
        { statement: 'Cocok untuk I/O bound', type: 'inference' },
      ],
    },
    context,
  );
  assert.equal(validRes.passed, true);
  assert.equal(validRes.unbackedClaims.length, 0);

  // 2. Unbacked claim / fabricated citation
  const invalidRes = await researchQualityChecklistHandler(
    {
      query: 'Arsitektur Node.js',
      sources: [
        { id: 's1', url: 'https://nodejs.org/doc', domain: 'nodejs.org', credibilityScore: 0.95 },
      ],
      claims: [
        { statement: 'Klaim fakta tanpa sitasi', type: 'sourced_fact', sourceIds: [] },
        { statement: 'Klaim dengan ID palsu', type: 'sourced_fact', sourceIds: ['fake-999'] },
      ],
    },
    context,
  );
  assert.equal(invalidRes.passed, false);
  assert.equal(invalidRes.unbackedClaims.length, 2);
});

test('SkillLoader: successfully loads skills from disk skills/ folder', async () => {
  const loader = new SkillLoader();
  const skillsDir =
    process.env['SKILLS_DIR'] ?? fileURLToPath(new URL('../../../skills', import.meta.url));
  const loaded = await loader.loadFromDirectory(skillsDir);

  assert.ok(loaded.length >= 3);
  const names = loaded.map((s) => s.name);
  assert.ok(names.includes('on-topic-guard'));
  assert.ok(names.includes('coding-quality-checklist'));
  assert.ok(names.includes('research-quality-checklist'));
});
