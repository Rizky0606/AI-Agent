import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryResearchRepository } from '../src/db/research-repository.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { DeepResearchEngine, type ResearchEnvironment } from '@personal-ai-os/agent-core';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';

const setupResearchTest = async (options?: {
  mockEnv?: ResearchEnvironment;
  customEngine?: DeepResearchEngine;
}) => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-secret-at-least-thirty-two-chars-long');
  const projectRepo = new InMemoryProjectRepository();
  const chatRepo = new InMemoryChatRepository();
  const researchRepo = new InMemoryResearchRepository();
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const mockEnv: ResearchEnvironment = options?.mockEnv ?? {
    search: async (q) => [
      {
        url: 'https://developer.mozilla.org/quantum-principles',
        title: `MDN Reference ${q}`,
        snippet: `Quantum computing architecture principles based on qubits and error correction.`,
        domain: 'developer.mozilla.org',
      },
      {
        url: 'https://nodejs.org/quantum-principles',
        title: `Node.js Reference ${q}`,
        snippet: `Quantum computing architecture principles hardware integration and benchmarks.`,
        domain: 'nodejs.org',
      },
    ],
    fetchPage: async (url) => ({
      url,
      status: 200,
      content:
        '<html><body><h1>Quantum Computing Architecture Principles</h1>' +
        '<p>Quantum computing architecture principles based on qubits and error correction. Hardware integration and benchmarks demonstrate quantum computing supremacy.</p>' +
        '</body></html>',
    }),
    fetchContent: async (url) => ({
      url,
      title: 'Quantum Computing Architecture Principles',
      content:
        'Quantum computing architecture principles based on qubits and error correction. Hardware integration and benchmarks demonstrate quantum computing supremacy.',
    }),
  };

  const engine = options?.customEngine ?? new DeepResearchEngine();

  const app = await buildApp({
    auth,
    health: { database: async () => true, redis: async () => true },
    project: { projectRepo, chatRepo },
    research: {
      researchRepo,
      broadcaster,
      engine,
      environment: mockEnv,
    },
  });

  const alice = await auth.register('alice.research@example.com', 'ValidPassword123!');
  const bob = await auth.register('bob.research@example.com', 'ValidPassword123!');
  const project = await projectRepo.createProject(alice.user.id, 'Quantum Project');

  return {
    app,
    auth,
    alice,
    bob,
    project,
    researchRepo,
    broadcaster,
    mockEnv,
    engine,
  };
};

test('POST /v1/research rejects unauthenticated requests', async () => {
  const { app, project } = await setupResearchTest();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/research',
    payload: {
      projectId: project.id,
      query: 'Quantum computing architecture',
    },
  });

  assert.equal(res.statusCode, 401);
});

test('POST /v1/research validates input body', async () => {
  const { app, alice, project } = await setupResearchTest();

  // Too short query
  const res1 = await app.inject({
    method: 'POST',
    url: '/v1/research',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: project.id,
      query: 'ab',
    },
  });
  assert.equal(res1.statusCode, 400);

  // Missing projectId
  const res2 = await app.inject({
    method: 'POST',
    url: '/v1/research',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      query: 'Valid query topic',
    },
  });
  assert.equal(res2.statusCode, 400);
});

test('POST /v1/research creates run, executes pipeline, broadcasts events and saves report', async () => {
  const { app, alice, project, broadcaster, researchRepo } = await setupResearchTest();

  const receivedEvents: TaskEventEnvelope[] = [];
  broadcaster.subscribe((evt) => {
    receivedEvents.push(evt);
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/research',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: project.id,
      query: 'Quantum computing architecture principles',
      depth: 'quick',
    },
  });

  assert.equal(res.statusCode, 201);
  const data = res.json();
  assert.ok(data.run);
  assert.ok(data.run.id);
  assert.equal(data.run.query, 'Quantum computing architecture principles');
  assert.equal(data.run.depth, 'quick');
  assert.equal(data.run.userId, alice.user.id);

  // Wait briefly for background execution to complete (quick depth with mock env is almost instant)
  const maxWait = 3000;
  const start = Date.now();
  let details = await researchRepo.getRunDetails(alice.user.id, data.run.id);
  while (
    details &&
    details.run.status !== 'completed' &&
    details.run.status !== 'failed' &&
    Date.now() - start < maxWait
  ) {
    await new Promise((r) => setTimeout(r, 50));
    details = await researchRepo.getRunDetails(alice.user.id, data.run.id);
  }

  assert.ok(details);
  assert.equal(details.run.status, 'completed', `Run failed with error: ${details.run.error}`);
  assert.ok(details.sources.length > 0);
  assert.ok(details.evidence.length > 0);
  assert.ok(details.report);
  assert.ok(details.report.contentMarkdown.includes('Quantum'));

  // Verify broadcaster received events
  assert.ok(receivedEvents.length > 0);
  const eventTypes = receivedEvents.map((e) => e.eventType);
  assert.ok(eventTypes.includes('research.plan'));
  assert.ok(eventTypes.includes('research.done'));
});

test('GET /v1/research/:id returns run details with sources, evidence, and report', async () => {
  const { app, alice, bob, project, researchRepo } = await setupResearchTest();

  const run = await researchRepo.createRun({
    userId: alice.user.id,
    projectId: project.id,
    query: 'AI agent architecture',
    depth: 'standard',
    budgetConfig: { maxSearches: 5, maxPagesRead: 5, maxModelTokens: 10000, maxDurationMs: 60000 },
  });

  await researchRepo.saveSources(run.id, [
    {
      sourceId: 'src-1',
      url: 'https://example.org/ai',
      title: 'AI Architecture',
      domain: 'example.org',
      credibilityScore: 0.9,
      snippet: 'Overview of agent patterns',
      fetchStatus: 'fetched',
    },
  ]);

  await researchRepo.saveEvidence(run.id, [
    {
      sourceId: 'src-1',
      statement: 'Agents use planning and tools.',
      claimType: 'fact',
      quote: 'Agents use planning and tools.',
      confidence: 0.88,
      verified: true,
    },
  ]);

  await researchRepo.saveReport(run.id, {
    title: 'Research Report: AI Agent Architecture',
    contentMarkdown: '# Report\n\nAgents use tools [src-1].',
    confidenceBySection: { intro: 0.9 },
    gaps: ['Long-term memory scaling'],
    limitations: ['Limited sources'],
    summary: 'Executive summary',
  });

  // 1. Success for alice
  const res = await app.inject({
    method: 'GET',
    url: `/v1/research/${run.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.run.id, run.id);
  assert.equal(body.sources.length, 1);
  assert.equal(body.evidence.length, 1);
  assert.ok(body.report);
  assert.equal(body.report.title, 'Research Report: AI Agent Architecture');

  // 2. 404 for bob (tenant isolation)
  const bobRes = await app.inject({
    method: 'GET',
    url: `/v1/research/${run.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobRes.statusCode, 404);

  // 3. 404 for non-existent ID
  const notFoundRes = await app.inject({
    method: 'GET',
    url: `/v1/research/${randomUUID()}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(notFoundRes.statusCode, 404);
});

test('GET /v1/research lists runs with filters', async () => {
  const { app, alice, project, researchRepo } = await setupResearchTest();

  await researchRepo.createRun({
    userId: alice.user.id,
    projectId: project.id,
    query: 'Query 1',
    depth: 'quick',
    budgetConfig: { maxSearches: 2, maxPagesRead: 2, maxModelTokens: 5000, maxDurationMs: 30000 },
  });
  const run2 = await researchRepo.createRun({
    userId: alice.user.id,
    projectId: project.id,
    query: 'Query 2',
    depth: 'standard',
    budgetConfig: { maxSearches: 5, maxPagesRead: 5, maxModelTokens: 10000, maxDurationMs: 60000 },
  });
  await researchRepo.updateRunStatus(alice.user.id, run2.id, 'completed');

  // List all
  const resAll = await app.inject({
    method: 'GET',
    url: '/v1/research',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(resAll.statusCode, 200);
  const dataAll = resAll.json();
  assert.equal(dataAll.total, 2);
  assert.equal(dataAll.runs.length, 2);

  // Filter by status=completed
  const resFiltered = await app.inject({
    method: 'GET',
    url: '/v1/research?status=completed',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(resFiltered.statusCode, 200);
  const dataFiltered = resFiltered.json();
  assert.equal(dataFiltered.total, 1);
  assert.equal(dataFiltered.runs[0].id, run2.id);
});

test('POST /v1/research/:id/cancel cancels an active run', async () => {
  const { app, alice, project, researchRepo } = await setupResearchTest();

  const run = await researchRepo.createRun({
    userId: alice.user.id,
    projectId: project.id,
    query: 'Query to cancel',
    depth: 'standard',
    budgetConfig: { maxSearches: 5, maxPagesRead: 5, maxModelTokens: 10000, maxDurationMs: 60000 },
  });

  const res = await app.inject({
    method: 'POST',
    url: `/v1/research/${run.id}/cancel`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.run.status, 'cancelled');

  const reloaded = await researchRepo.getRun(alice.user.id, run.id);
  assert.equal(reloaded?.status, 'cancelled');
});

test('POST /v1/research/:id/approve-plan rejects invalid status and approves waiting plan', async () => {
  const { app, alice, project, researchRepo } = await setupResearchTest();

  const run = await researchRepo.createRun({
    userId: alice.user.id,
    projectId: project.id,
    query: 'Deep research on microservices',
    depth: 'deep',
    budgetConfig: {
      maxSearches: 10,
      maxPagesRead: 10,
      maxModelTokens: 20000,
      maxDurationMs: 120000,
    },
  });

  // 1. Rejects approval while status is 'queued'
  const errRes = await app.inject({
    method: 'POST',
    url: `/v1/research/${run.id}/approve-plan`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      plan: {
        subQuestions: [
          {
            id: 'sub-1',
            question: 'What is service mesh?',
            rationale: 'Understand mesh',
            searchQueries: ['service mesh comparison'],
          },
        ],
      },
    },
  });
  assert.equal(errRes.statusCode, 400);

  // 2. Set status to 'waiting_plan_approval'
  await researchRepo.updateRunStatus(alice.user.id, run.id, 'waiting_plan_approval', {
    plan: {
      subQuestions: [
        {
          id: 'sub-1',
          question: 'Original sub question',
          rationale: 'Original rationale',
          searchQueries: ['original query'],
        },
      ],
    },
  });

  // 3. Approve and modify plan
  const approveRes = await app.inject({
    method: 'POST',
    url: `/v1/research/${run.id}/approve-plan`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      plan: {
        subQuestions: [
          {
            id: 'sub-1',
            question: 'User updated sub question',
            rationale: 'User updated rationale',
            searchQueries: ['service mesh performance'],
          },
        ],
      },
    },
  });
  assert.equal(approveRes.statusCode, 200);
  const approveBody = approveRes.json();
  assert.equal(approveBody.success, true);
  assert.equal(approveBody.run.status, 'running');
  const plan = approveBody.run.plan as ResearchPlan;
  assert.equal(plan.approved, true);
  assert.equal(plan.subQuestions[0]?.question, 'User updated sub question');
});

test('GET /v1/research/config returns server default budgets', async () => {
  const { app } = await setupResearchTest();

  const res = await app.inject({
    method: 'GET',
    url: '/v1/research/config',
  });

  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.ok(data.budgets);
  assert.ok(data.budgets.quick);
  assert.ok(data.budgets.standard);
  assert.ok(data.budgets.deep);
  assert.equal(data.budgets.quick.maxSearches, 2);
  assert.equal(data.budgets.standard.maxSearches, 5);
  assert.equal(data.budgets.deep.maxSearches, 12);
});

test('DELETE /v1/research/:id deletes run and enforces tenant isolation', async () => {
  const { app, alice, bob, project, researchRepo } = await setupResearchTest();

  const run = await researchRepo.createRun({
    userId: alice.user.id,
    projectId: project.id,
    query: 'Query to delete',
    depth: 'quick',
    budgetConfig: { maxSearches: 2, maxPagesRead: 2, maxModelTokens: 4000, maxDurationMs: 30000 },
  });

  // 1. Bob cannot delete Alice's run (returns 404)
  const bobRes = await app.inject({
    method: 'DELETE',
    url: `/v1/research/${run.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobRes.statusCode, 404);

  // 2. Alice deletes her run
  const deleteRes = await app.inject({
    method: 'DELETE',
    url: `/v1/research/${run.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.json().success, true);

  // 3. Run is gone
  const getRes = await app.inject({
    method: 'GET',
    url: `/v1/research/${run.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getRes.statusCode, 404);
});
