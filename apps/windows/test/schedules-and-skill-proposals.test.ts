import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client.ts';

test('ApiClient: handles schedules methods correctly', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const responses: Response[] = [
    new Response(
      JSON.stringify({
        schedules: [
          {
            id: 'sched-1',
            name: 'Pagi Hari',
            type: 'recurring',
            cronExpression: '0 8 * * *',
            timezone: 'Asia/Jakarta',
            status: 'active',
            lastBrief: 'Semua sistem aman.',
            taskPayload: { kind: 'research', input: { query: 'AI updates' } },
          },
        ],
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        schedule: {
          id: 'sched-2',
          name: 'Sekali',
          type: 'one_off',
          runAt: '2026-10-18T08:00:00.000Z',
          timezone: 'Asia/Jakarta',
          status: 'active',
          taskPayload: { kind: 'generic', input: { prompt: 'do task' } },
        },
      }),
      { status: 201 },
    ),
    new Response(
      JSON.stringify({
        schedule: { id: 'sched-1', status: 'paused' },
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        schedule: { id: 'sched-1', status: 'active' },
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        schedule: { id: 'sched-1', status: 'cancelled' },
      }),
      { status: 200 },
    ),
  ];

  const client = new ApiClient({
    baseUrl: () => 'http://127.0.0.1:8080',
    token: () => 'jwt-test',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift()!;
    },
  });

  const list = await client.listSchedules('active');
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, 'sched-1');
  assert.equal(list[0]?.lastBrief, 'Semua sistem aman.');
  assert.equal(calls[0]?.url, 'http://127.0.0.1:8080/v1/schedules?status=active');

  const created = await client.createSchedule({
    name: 'Sekali',
    type: 'one_off',
    runAt: '2026-10-18T08:00:00.000Z',
    timezone: 'Asia/Jakarta',
    taskPayload: { kind: 'generic', input: { prompt: 'do task' } },
  });
  assert.equal(created.id, 'sched-2');
  assert.equal(calls[1]?.init.method, 'POST');

  const paused = await client.pauseSchedule('sched-1');
  assert.equal(paused.status, 'paused');
  assert.equal(calls[2]?.url, 'http://127.0.0.1:8080/v1/schedules/sched-1/pause');

  const resumed = await client.resumeSchedule('sched-1');
  assert.equal(resumed.status, 'active');
  assert.equal(calls[3]?.url, 'http://127.0.0.1:8080/v1/schedules/sched-1/resume');

  const cancelled = await client.cancelSchedule('sched-1');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(calls[4]?.init.method, 'DELETE');
});

test('ApiClient: handles skill proposals methods correctly', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const responses: Response[] = [
    new Response(
      JSON.stringify({
        proposals: [
          {
            id: 'prop-1',
            skillName: 'auto-search',
            title: 'Auto Search Skill',
            description: 'Pola pencarian otomatis',
            status: 'pending',
            proposedManifest: { name: 'auto-search', version: '1.0.0', tools: ['docs:read'], riskLevel: 'LOW' },
          },
        ],
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        proposal: {
          id: 'prop-2',
          skillName: 'code-audit',
          title: 'Code Audit',
          description: 'Audit pola kode',
          status: 'pending',
          proposedManifest: { name: 'code-audit', version: '1.0.0', tools: ['docs:read'], riskLevel: 'LOW' },
        },
      }),
      { status: 201 },
    ),
    new Response(
      JSON.stringify({
        success: true,
        createdSkillName: 'auto-search',
        statusNote: 'Skill dibuat dalam status NONAKTIF',
        proposal: { id: 'prop-1', status: 'approved' },
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        success: true,
        proposal: { id: 'prop-2', status: 'rejected', rejectionReason: 'Tidak aman' },
      }),
      { status: 200 },
    ),
  ];

  const client = new ApiClient({
    baseUrl: () => 'http://127.0.0.1:8080',
    token: () => 'jwt-test',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift()!;
    },
  });

  const list = await client.listSkillProposals('pending');
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, 'prop-1');
  assert.equal(calls[0]?.url, 'http://127.0.0.1:8080/v1/skills/proposals?status=pending');

  const created = await client.createSkillProposal({
    skillName: 'code-audit',
    title: 'Code Audit',
    description: 'Audit pola kode',
    proposedManifest: { name: 'code-audit', version: '1.0.0', tools: ['docs:read'], riskLevel: 'LOW' },
  });
  assert.equal(created.id, 'prop-2');

  const approved = await client.approveSkillProposal('prop-1');
  assert.equal(approved.success, true);
  assert.equal(approved.proposal.status, 'approved');
  assert.equal(approved.createdSkillName, 'auto-search');

  const rejected = await client.rejectSkillProposal('prop-2', 'Tidak aman');
  assert.equal(rejected.success, true);
  assert.equal(rejected.proposal.status, 'rejected');
  assert.equal(rejected.proposal.rejectionReason, 'Tidak aman');
});
