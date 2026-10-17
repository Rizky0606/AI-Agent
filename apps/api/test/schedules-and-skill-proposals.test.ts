import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemorySkillProposalRepository } from '../src/db/skill-proposal-repository.ts';
import { InMemorySkillRepository } from '../src/db/skill-repository.ts';
import {
  NotificationEngine,
  SchedulerEngine,
} from '@personal-ai-os/scheduler';
import { sanitizeSensitiveJson, sanitizeSensitiveText } from '../src/services/sensitive-data-filter.ts';

async function setupTest() {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-jwt-secret-at-least-thirty-two-bytes-long');
  const skillRepo = new InMemorySkillRepository();
  const proposalRepo = new InMemorySkillProposalRepository();
  const schedulerEngine = new SchedulerEngine();
  const notificationEngine = new NotificationEngine();

  const alice = await auth.register('alice@personal-ai-os.test', 'super-secret-password-123');

  const app = await buildApp({
    auth,
    skills: { skillRepo },
    skillProposals: { proposalRepo, skillRepo },
    schedules: { schedulerEngine, notificationEngine },
  });

  return { app, alice, skillRepo, proposalRepo, schedulerEngine, notificationEngine };
}

test('Scheduler: validasi zona waktu Asia/Jakarta dan frekuensi minimum (15 menit)', async () => {
  const { app, alice } = await setupTest();

  // 1. Jadwal dengan frekuensi terlalu sering (setiap 5 menit) HARUS DITOLAK
  const tooFrequentRes = await app.inject({
    method: 'POST',
    url: '/v1/schedules',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      name: 'Riset Terlalu Sering',
      type: 'recurring',
      cronExpression: '*/5 * * * *',
      timezone: 'Asia/Jakarta',
      taskPayload: {
        kind: 'research',
        input: { topic: 'AI Agent' },
      },
    },
  });
  assert.equal(tooFrequentRes.statusCode, 400);
  const tooFrequentJson = tooFrequentRes.json();
  assert.ok(tooFrequentJson.error.message.includes('terlalu sering'));

  // 2. Jadwal dengan frekuensi aman (setiap 30 menit atau harian 09:00 WIB) HARUS DITERIMA
  const safeRes = await app.inject({
    method: 'POST',
    url: '/v1/schedules',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      name: 'Briefing Harian Pagi',
      type: 'recurring',
      cronExpression: '0 9 * * *', // 09:00 WIB setiap hari
      timezone: 'Asia/Jakarta',
      taskPayload: {
        kind: 'generic',
        input: { prompt: 'Ringkas berita teknologi terkini' },
      },
    },
  });
  assert.equal(safeRes.statusCode, 201);
  const safeJson = safeRes.json();
  assert.equal(safeJson.schedule.name, 'Briefing Harian Pagi');
  assert.equal(safeJson.schedule.timezone, 'Asia/Jakarta');
  assert.equal(safeJson.schedule.status, 'active');
  assert.ok(safeJson.schedule.nextRunAt);
});

test('Scheduler: batas maksimal 10 jadwal aktif per pengguna', async () => {
  const { app, alice } = await setupTest();

  // Buat 10 jadwal aktif
  for (let i = 1; i <= 10; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/schedules',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        name: `Jadwal #${i}`,
        type: 'recurring',
        cronExpression: `0 ${i % 24} * * *`,
        timezone: 'Asia/Jakarta',
        taskPayload: {
          kind: 'generic',
          input: { prompt: `Task ${i}` },
        },
      },
    });
    assert.equal(res.statusCode, 201);
  }

  // Jadwal ke-11 HARUS DITOLAK karena melebihi kuota
  const quotaRes = await app.inject({
    method: 'POST',
    url: '/v1/schedules',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      name: 'Jadwal Melebihi Kuota',
      type: 'recurring',
      cronExpression: '0 12 * * *',
      timezone: 'Asia/Jakarta',
      taskPayload: {
        kind: 'generic',
        input: { prompt: 'Task 11' },
      },
    },
  });
  assert.equal(quotaRes.statusCode, 400);
  const quotaJson = quotaRes.json();
  assert.ok(quotaJson.error.message.includes('Batas kuota'));
});

test('Sanitasi Data Sensitif: menyaring token otentikasi, API keys, dan IP internal', () => {
  const dirtyText =
    'Gunakan Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123 dan OpenAI sk-proj-1234567890abcdef1234567890 serta server 192.168.1.50 dengan password: "my-secret-password"';

  const res = sanitizeSensitiveText(dirtyText);
  assert.equal(res.hasSensitiveData, true);
  assert.ok(!res.cleanText.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  assert.ok(!res.cleanText.includes('sk-proj-1234567890abcdef1234567890'));
  assert.ok(!res.cleanText.includes('192.168.1.50'));
  assert.ok(!res.cleanText.includes('my-secret-password'));
  assert.ok(res.cleanText.includes('[REDACTED_TOKEN]'));
  assert.ok(res.cleanText.includes('[REDACTED_API_KEY]'));
  assert.ok(res.cleanText.includes('[REDACTED_INTERNAL_IP]'));
  assert.ok(res.cleanText.includes('[REDACTED_CREDENTIAL]'));

  // Sanitasi JSON Manifest
  const dirtyManifest = {
    name: 'test-skill',
    version: '1.0.0',
    description: 'Skill dengan token sk-12345678901234567890 di deskripsi',
    toolRequirements: [],
    permissions: [],
    compatibility: {},
    metadata: {
      endpoint: 'http://10.0.0.1/api',
    },
  };
  const jsonRes = sanitizeSensitiveJson(dirtyManifest);
  assert.equal(jsonRes.hasSensitiveData, true);
  assert.ok(!jsonRes.cleanData.description.includes('sk-12345678901234567890'));
  assert.ok(!jsonRes.cleanData.metadata.endpoint.includes('10.0.0.1'));
});

test('Skill Proposals: pembuatan usulan baru, penolakan, dan persetujuan (nonaktif by default)', async () => {
  const { app, alice, skillRepo } = await setupTest();

  const validManifest = {
    name: 'summarize-github-prs',
    version: '1.0.0',
    description: 'Ringkas pull request Github yang berhasil di-review',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolRequirements: [],
    permissions: [
      {
        action: 'web:fetch',
        resource: 'https://api.github.com/*',
        scope: 'read_only',
        riskLevel: 'LOW',
        reason: 'Mengambil metadata PR',
      },
    ],
    compatibility: { platforms: ['windows', 'android', 'backend'] },
  };

  // 1. Buat usulan skill baru
  const proposeRes = await app.inject({
    method: 'POST',
    url: '/v1/skills/proposals',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      skillName: 'summarize-github-prs',
      title: 'Usulan Skill: Ringkasan GitHub PR',
      description: 'Meringkas PR yang disetujui untuk rilis changelog',
      proposedManifest: validManifest,
      promptInstructions: 'Instruksi: Analisis judul dan deskripsi PR secara objektif.',
      changeType: 'new_skill',
    },
  });
  assert.equal(proposeRes.statusCode, 201);
  const proposeJson = proposeRes.json();
  const proposalId = proposeJson.proposal.id;
  assert.equal(proposeJson.proposal.status, 'pending'); // Wajib pending, tidak pernah aktif otomatis

  // 2. Periksa list usulan skill
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/skills/proposals',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(listRes.statusCode, 200);
  const listJson = listRes.json();
  assert.equal(listJson.proposals.length, 1);
  assert.equal(listJson.proposals[0].id, proposalId);

  // 3. Setujui usulan skill (Approve)
  const approveRes = await app.inject({
    method: 'POST',
    url: `/v1/skills/proposals/${proposalId}/approve`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(approveRes.statusCode, 200);
  const approveJson = approveRes.json();
  assert.equal(approveJson.success, true);
  assert.equal(approveJson.proposal.status, 'approved');

  // 4. Verifikasi bahwa skill di tabel skills dibuat dalam keadaan NONAKTIF (isEnabled: false)
  const createdSkill = await skillRepo.getSkillByName('summarize-github-prs');
  assert.ok(createdSkill);
  assert.equal(createdSkill.isEnabled, false); // KEAMANAN: Memastikan nonaktif secara default!

  // 5. Buat usulan kedua dan tolak (Reject)
  const secondPropose = await app.inject({
    method: 'POST',
    url: '/v1/skills/proposals',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      skillName: 'untrusted-system-exec',
      title: 'Usulan Berisiko',
      description: 'Menjalankan eksekusi lokal tanpa batas',
      proposedManifest: {
        ...validManifest,
        name: 'untrusted-system-exec',
      },
    },
  });
  const secondId = secondPropose.json().proposal.id;

  const rejectRes = await app.inject({
    method: 'POST',
    url: `/v1/skills/proposals/${secondId}/reject`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      reason: 'Izin berlebihan dan tidak aman untuk dijalankan',
    },
  });
  assert.equal(rejectRes.statusCode, 200);
  assert.equal(rejectRes.json().proposal.status, 'rejected');
  assert.equal(rejectRes.json().proposal.rejectionReason, 'Izin berlebihan dan tidak aman untuk dijalankan');
});
