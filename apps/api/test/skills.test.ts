import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemorySkillRepository } from '../src/db/skill-repository.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Skills API: sync from disk, list, detail, enable/disable, execute, and rollback', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const skillRepo = new InMemorySkillRepository();

  const user = await auth.register('alice-skills@example.com', 'ValidPassword123!');

  const app = await buildApp({
    auth,
    skills: {
      skillRepo,
      skillsDir: 'c:/Coding/Project/ai-agent/skills',
    },
  });

  // 1. Initial list is empty
  const emptyRes = await app.inject({
    method: 'GET',
    url: '/v1/skills',
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
  assert.equal(emptyRes.statusCode, 200);
  assert.deepEqual(emptyRes.json().skills, []);

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
