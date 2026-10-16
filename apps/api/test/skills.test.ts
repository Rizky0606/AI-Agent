import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemorySkillRepository } from '../src/db/skill-repository.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Skills API: sync from disk, list, detail, enable/disable, execute, and rollback', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const skillRepo = new InMemorySkillRepository();

  const user = await auth.register('alice-skills@example.com', 'ValidPassword123!');

  const skillsDir =
    process.env['SKILLS_DIR'] ?? fileURLToPath(new URL('../../../skills', import.meta.url));

  const app = await buildApp({
    auth,
    skills: {
      skillRepo,
      skillsDir,
    },
  });

  // 1. Initial list contains Hermes read-only skills
  const initialRes = await app.inject({
    method: 'GET',
    url: '/v1/skills',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(initialRes.statusCode, 200);
  const initialSkills = initialRes.json().skills;
  assert.ok(initialSkills.length >= 4);
  assert.ok(initialSkills.every((s: { source: string; isReadOnly: boolean }) => s.source === 'hermes' && s.isReadOnly === true));

  // 2. Sync from disk folder
  const syncRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/sync',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(syncRes.statusCode, 200);
  assert.ok(syncRes.json().syncedCount >= 3);

  // 3. List skills returns the 3 initial skills
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/skills',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(listRes.statusCode, 200);
  const skills = listRes.json().skills;
  assert.ok(skills.length >= 3);
  const skillNames = skills.map((s: { name: string }) => s.name);
  assert.ok(skillNames.includes('on-topic-guard'));
  assert.ok(skillNames.includes('coding-quality-checklist'));
  assert.ok(skillNames.includes('research-quality-checklist'));

  // 4. Get skill detail
  const detailRes = await app.inject({
    method: 'GET',
    url: '/v1/skills/on-topic-guard',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.json().skill.name, 'on-topic-guard');
  assert.equal(detailRes.json().skill.version, '1.0.0');

  // 5. Disable skill
  const disableRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/on-topic-guard/disable',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(disableRes.statusCode, 200);
  assert.equal(disableRes.json().skill.isEnabled, false);

  // Filter by isEnabled=true
  const enabledOnlyRes = await app.inject({
    method: 'GET',
    url: '/v1/skills?isEnabled=true',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(enabledOnlyRes.statusCode, 200);
  const enabledNames = enabledOnlyRes.json().skills.map((s: { name: string }) => s.name);
  assert.equal(enabledNames.includes('on-topic-guard'), false);

  // 6. Re-enable skill
  const enableRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/on-topic-guard/enable',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(enableRes.statusCode, 200);
  assert.equal(enableRes.json().skill.isEnabled, true);

  // 7. Execute on-topic-guard skill
  const execRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/on-topic-guard/execute',
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: {
      input: {
        goal: 'Implementasi unit tests untuk auth service',
        acceptanceCriteria: ['Semua endpoint teruji', 'Coverage 100%'],
        proposedActionOrOutput: 'Menulis file auth.test.ts dan menjalankan test suite unit',
      },
    },
  });
  assert.equal(execRes.statusCode, 200);
  assert.equal(execRes.json().result.isOnTopic, true);

  // 8. Versioning and Rollback
  const currentSkill = (await skillRepo.getSkillByName('on-topic-guard'))!;
  // Update to v1.2.0
  await skillRepo.upsertSkill({
    ...currentSkill.manifest,
    version: '1.2.0',
    description: 'Updated v1.2.0 description',
  });

  const checkUpdated = await skillRepo.getSkillByName('on-topic-guard');
  assert.equal(checkUpdated?.version, '1.2.0');

  // Rollback to v1.0.0
  const rollbackRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/on-topic-guard/rollback',
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { targetVersion: '1.0.0' },
  });
  assert.equal(rollbackRes.statusCode, 200);
  assert.equal(rollbackRes.json().skill.version, '1.0.0');
  assert.match(rollbackRes.json().message, /berhasil di-rollback/i);
});

test('Hermes Skills: exposed read-only, forbids enable/disable modifications', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const skillRepo = new InMemorySkillRepository();
  const user = await auth.register('bob-hermes@example.com', 'ValidPassword123!');
  const app = await buildApp({
    auth,
    skills: { skillRepo },
  });

  const detailRes = await app.inject({
    method: 'GET',
    url: '/v1/skills/hermes_telegram_messenger',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.json().skill.isReadOnly, true);

  const disableRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/hermes_telegram_messenger/disable',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(disableRes.statusCode, 403);
  assert.match(disableRes.json().error, /read-only/i);
});

test('Runtimes API: GET /v1/runtimes returns plain Indonesian status for omp, hermes, native', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const user = await auth.register('carol-runtimes@example.com', 'ValidPassword123!');
  const app = await buildApp({ auth });

  const res = await app.inject({
    method: 'GET',
    url: '/v1/runtimes',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(res.statusCode, 200);
  const { runtimes } = res.json() as { runtimes: Array<{ id: string; name: string; status: string; healthText: string }> };
  assert.ok(Array.isArray(runtimes));
  assert.equal(runtimes.length, 3);
  const ids = runtimes.map((r) => r.id);
  assert.ok(ids.includes('omp'));
  assert.ok(ids.includes('hermes'));
  assert.ok(ids.includes('native'));
  assert.ok(runtimes.every((r) => typeof r.healthText === 'string' && r.healthText.length > 0));
});

test('Skills API: manifest viewer, per-project toggle, and execution tracking of Sesi 14 skills', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const skillRepo = new InMemorySkillRepository();
  const user = await auth.register('dave-skills@example.com', 'ValidPassword123!');

  const skillsDir =
    process.env['SKILLS_DIR'] ?? fileURLToPath(new URL('../../../skills', import.meta.url));

  const app = await buildApp({
    auth,
    skills: {
      skillRepo,
      skillsDir,
    },
  });

  // 1. Sync from disk to register all skills
  const syncRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/sync',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(syncRes.statusCode, 200);

  // 2. GET /v1/skills/plan-before-act/manifest returns raw manifest
  const manifestRes = await app.inject({
    method: 'GET',
    url: '/v1/skills/plan-before-act/manifest',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(manifestRes.statusCode, 200);
  const { manifest } = manifestRes.json();
  assert.equal(manifest.name, 'plan-before-act');
  assert.equal(manifest.version, '1.0.0');
  assert.ok(Array.isArray(manifest.permissions));

  // 3. Per-project toggle
  const projectId = 'proj-alpha-123';

  // Initially, getProjectSkills returns all skills without override
  const projSkillsRes1 = await app.inject({
    method: 'GET',
    url: `/v1/projects/${projectId}/skills`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(projSkillsRes1.statusCode, 200);
  assert.ok(projSkillsRes1.json().skills.length >= 6);

  // Toggle plan-before-act to disabled for this project
  const toggleRes1 = await app.inject({
    method: 'POST',
    url: `/v1/projects/${projectId}/skills/plan-before-act/toggle`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { isEnabled: false },
  });
  assert.equal(toggleRes1.statusCode, 200);
  assert.equal(toggleRes1.json().skillName, 'plan-before-act');
  assert.equal(toggleRes1.json().isEnabled, false);

  // Check project skills has override for plan-before-act
  const projSkillsRes2 = await app.inject({
    method: 'GET',
    url: `/v1/projects/${projectId}/skills`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(projSkillsRes2.statusCode, 200);
  const planSkill = projSkillsRes2.json().skills.find((s: { name: string }) => s.name === 'plan-before-act');
  assert.ok(planSkill);
  assert.equal(planSkill.isEnabled, false);
  assert.equal(planSkill.isProjectOverride, true);

  // 4. Execute plan-before-act and verify usage tracking
  const execPlanRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/plan-before-act/execute',
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: {
      input: {
        goal: 'Membangun UI Manajer Skill di Windows',
        proposedAction: 'Membuat file SkillMcpView.tsx',
        plan: {
          steps: [
            'Membuat komponen SkillMcpView.tsx',
            'Menambahkan tab ke AppHeader.tsx',
          ],
          acceptanceCriteria: [
            'Daftar skill tampil dengan status izin',
            'Saklar per proyek berfungsi',
          ],
        },
      },
    },
  });
  assert.equal(execPlanRes.statusCode, 200);
  assert.equal(execPlanRes.json().result.allowed, true);

  // Check skill detail shows lastOutcome = success
  const skillDetailRes = await app.inject({
    method: 'GET',
    url: '/v1/skills/plan-before-act',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(skillDetailRes.statusCode, 200);
  assert.equal(skillDetailRes.json().skill.lastOutcome, 'success');
  assert.ok(skillDetailRes.json().skill.lastUsedAt);

  // 5. Execute verify-with-evidence with failure and verify usage tracking records failure
  const execVerifyFailRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/verify-with-evidence/execute',
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: {
      input: {
        taskGoal: 'Implementasi auth refresh token',
        claimedStatus: 'completed',
        summary: 'Semua selesai tanpa bukti',
        evidence: {},
      },
    },
  });
  assert.equal(execVerifyFailRes.statusCode, 200);
  assert.equal(execVerifyFailRes.json().result.verified, false);

  const verifyDetailRes = await app.inject({
    method: 'GET',
    url: '/v1/skills/verify-with-evidence',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(verifyDetailRes.statusCode, 200);
  assert.equal(verifyDetailRes.json().skill.lastOutcome, 'failure');
  assert.ok(verifyDetailRes.json().skill.lastError);
});


