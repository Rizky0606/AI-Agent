import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCitations,
  reduceResearchProgress,
  deriveDomainInitials,
  type ResearchProgressState,
  type ResearchSourceItem,
  type ResearchEvidenceItem,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { ApiClient } from '../src/api/client.ts';

test('Research UI - deriveDomainInitials generates consistent uppercase initials', () => {
  assert.equal(deriveDomainInitials('wikipedia.org'), 'WI');
  assert.equal(deriveDomainInitials('developer.mozilla.org'), 'DE');
  assert.equal(deriveDomainInitials('nodejs.org'), 'NO');
  assert.equal(deriveDomainInitials('github.com'), 'GI');
  assert.equal(deriveDomainInitials('a.com'), 'AC');
});

test('Research UI - parseCitations maps [src-X] to source and short evidence quote', () => {
  const markdown = `
### Temuan Utama
Sistem operasi AI modern menggunakan arsitektur modular [src-1].
Selain itu, protokol memori berbasis pgvector [src-2] memungkinkan pencarian cepat.
Sebuah sumber yang tidak valid juga dicoba [src-99].
`;

  const sources: ResearchSourceItem[] = [
    {
      id: 'src-1',
      url: 'https://arxiv.org/abs/2401.0001',
      title: 'Modular AI Operating Systems',
      domain: 'arxiv.org',
      initials: 'AR',
      credibilityScore: 0.95,
      snippet: 'A paper on modular AI OS architectures.',
    },
    {
      id: 'src-2',
      url: 'https://postgresql.org/docs/vector',
      title: 'PostgreSQL pgvector Documentation',
      domain: 'postgresql.org',
      initials: 'PG',
      credibilityScore: 0.98,
      snippet: 'Vector indexing and semantic search in PostgreSQL.',
    },
  ];

  const evidence: ResearchEvidenceItem[] = [
    {
      id: 'evi-1',
      sourceId: 'src-1',
      statement: 'Sistem operasi AI modern menggunakan arsitektur modular',
      quote: 'Modern AI operating systems adopt modular service meshes for resilience.',
      claimType: 'fact',
      confidence: 0.9,
    },
    {
      id: 'evi-2',
      sourceId: 'src-2',
      statement: 'pgvector memungkinkan pencarian cepat',
      quote: 'HNSW indexing on pgvector enables sub-millisecond retrieval.',
      claimType: 'fact',
      confidence: 0.95,
    },
  ];

  const citationMap = parseCitations(markdown, sources, evidence);

  assert.equal(citationMap.size, 3);

  const cit1 = citationMap.get('src-1');
  assert.ok(cit1);
  assert.equal(cit1.isValid, true);
  assert.equal(cit1.number, 1);
  assert.equal(cit1.source?.domain, 'arxiv.org');
  assert.equal(cit1.quote, 'Modern AI operating systems adopt modular service meshes for resilience.');
  assert.ok(cit1.quote.length <= 200, 'Verbatim quote is bounded within 200 chars');

  const cit2 = citationMap.get('src-2');
  assert.ok(cit2);
  assert.equal(cit2.isValid, true);
  assert.equal(cit2.number, 2);
  assert.equal(cit2.source?.domain, 'postgresql.org');

  const cit99 = citationMap.get('src-99');
  assert.ok(cit99);
  assert.equal(cit99.isValid, false);
  assert.equal(cit99.source, undefined);
});

test('Research UI - reduceResearchProgress handles real-time event updates and idempotency', () => {
  const initial: ResearchProgressState = {
    runId: 'run-test-1',
    status: 'planning',
    query: 'Bandingkan arsitektur Fastify vs Express',
    depth: 'deep',
    subQuestions: [],
    sources: [],
    evidence: [],
    budgetConfig: {
      maxSearches: 15,
      maxPagesRead: 20,
      maxModelTokens: 100000,
      maxDurationMs: 600000,
    },
    budgetUsed: {
      searchesCount: 0,
      pagesReadCount: 0,
      modelTokensCount: 0,
      durationMs: 0,
    },
    seenEventIds: [],
    updatedAt: 1000,
  };

  // Event 1: plan generated
  const event1: TaskEventEnvelope = {
    id: 'evt-1',
    taskId: 'run-test-1',
    userId: 'user-1',
    eventType: 'research.plan',
    createdAt: new Date().toISOString(),
    payload: {
      plan: {
        subQuestions: [
          { id: 'sq-1', question: 'Performa HTTP throughput', searchQueries: ['fastify vs express benchmark'] },
          { id: 'sq-2', question: 'Ekosistem plugin dan middleware', searchQueries: ['fastify plugin ecosystem'] },
        ],
      },
    },
  };

  const state1 = reduceResearchProgress(initial, event1);
  assert.equal(state1.status, 'waiting_plan_approval');
  assert.equal(state1.subQuestions.length, 2);
  assert.equal(state1.subQuestions[0]?.status, 'waiting');

  // Duplicate Event 1 should be ignored (idempotent)
  const state1Dupe = reduceResearchProgress(state1, event1);
  assert.equal(state1Dupe.updatedAt, state1.updatedAt);

  // Event 1b: plan approved
  const event1b: TaskEventEnvelope = {
    id: 'evt-1b',
    taskId: 'run-test-1',
    userId: 'user-1',
    eventType: 'research.plan_approved',
    createdAt: new Date().toISOString(),
    payload: {},
  };
  const state1Approved = reduceResearchProgress(state1, event1b);
  assert.equal(state1Approved.status, 'running');

  // Event 2: search query executed
  const event2: TaskEventEnvelope = {
    id: 'evt-2',
    taskId: 'run-test-1',
    userId: 'user-1',
    eventType: 'research.search',
    createdAt: new Date().toISOString(),
    payload: { query: 'fastify vs express benchmark', searchesExecuted: 1 },
  };

  const state2 = reduceResearchProgress(state1Approved, event2);
  assert.equal(state2.status, 'running');
  assert.equal(state2.subQuestions[0]?.status, 'searching');

  // Event 3: source discovered
  const event3: TaskEventEnvelope = {
    id: 'evt-3',
    taskId: 'run-test-1',
    userId: 'user-1',
    eventType: 'research.source',
    createdAt: new Date().toISOString(),
    payload: {
      source: {
        id: 'src-1',
        url: 'https://fastify.dev/benchmarks',
        title: 'Fastify Benchmarks',
        domain: 'fastify.dev',
        initials: 'FS',
        credibilityScore: 0.9,
      },
      budgetUsed: {
        searchesCount: 1,
        pagesReadCount: 0,
        modelTokensCount: 150,
        durationMs: 1200,
      },
    },
  };

  const state3 = reduceResearchProgress(state2, event3);
  assert.equal(state3.sources.length, 1);
  assert.equal(state3.budgetUsed.searchesCount, 1);

  // Event 4: completed
  const event4: TaskEventEnvelope = {
    id: 'evt-4',
    taskId: 'run-test-1',
    userId: 'user-1',
    eventType: 'research.completed',
    createdAt: new Date().toISOString(),
    payload: {
      report: {
        id: 'rep-1',
        title: 'Laporan Komparasi Fastify vs Express',
        summary: 'Fastify menunjukkan throughput 2x lebih tinggi.',
        contentMarkdown: 'Fastify mencatat 30k req/s [src-1].',
        confidenceBySection: { Kesimpulan: 0.92 },
        gaps: ['Benchmarking di Node 22 belum teruji'],
      },
    },
  };

  const state4 = reduceResearchProgress(state3, event4);
  assert.equal(state4.status, 'completed');
  assert.ok(state4.report);
  assert.equal(state4.report.title, 'Laporan Komparasi Fastify vs Express');
  assert.equal(state4.report.gaps?.length, 1);
});

test('Research UI - ApiClient deep research endpoints communicate with server contract', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: urlStr, body });

    if (urlStr.includes('/v1/research/config')) {
      return new Response(
        JSON.stringify({
          budgets: {
            quick: { maxSearches: 3, maxPagesRead: 4, maxModelTokens: 20000, maxDurationMs: 60000 },
            standard: { maxSearches: 8, maxPagesRead: 12, maxModelTokens: 50000, maxDurationMs: 180000 },
            deep: { maxSearches: 15, maxPagesRead: 20, maxModelTokens: 100000, maxDurationMs: 600000 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'POST' && urlStr.endsWith('/v1/research')) {
      return new Response(
        JSON.stringify({
          run: {
            id: 'run-123',
            projectId: 'proj-1',
            query: 'Test Query',
            depth: 'standard',
            status: 'running',
            budgetConfig: { maxSearches: 8, maxPagesRead: 12, maxModelTokens: 50000, maxDurationMs: 180000 },
            budgetUsed: { searchesCount: 0, pagesReadCount: 0, modelTokensCount: 0, durationMs: 0 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'GET' && urlStr.includes('/v1/research/run-123')) {
      return new Response(
        JSON.stringify({
          run: {
            id: 'run-123',
            projectId: 'proj-1',
            query: 'Test Query',
            depth: 'standard',
            status: 'completed',
            budgetConfig: { maxSearches: 8, maxPagesRead: 12, maxModelTokens: 50000, maxDurationMs: 180000 },
            budgetUsed: { searchesCount: 2, pagesReadCount: 3, modelTokensCount: 1200, durationMs: 4000 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          sources: [],
          evidence: [],
          report: {
            id: 'rep-1',
            runId: 'run-123',
            title: 'Test Report',
            summary: 'Summary',
            contentMarkdown: 'Report body',
            confidenceBySection: {},
            gaps: [],
            evaluatorScore: 0.9,
            createdAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'POST' && urlStr.endsWith('/approve-plan')) {
      return new Response(
        JSON.stringify({
          run: {
            id: 'run-123',
            status: 'running',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'POST' && urlStr.endsWith('/cancel')) {
      return new Response(
        JSON.stringify({
          run: {
            id: 'run-123',
            status: 'cancelled',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'GET' && urlStr.includes('/v1/research')) {
      return new Response(
        JSON.stringify({
          runs: [],
          total: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  };

  const client = new ApiClient({
    baseUrl: () => 'http://localhost:3000',
    token: () => 'test-token',
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  // Test getResearchConfig
  const config = await client.getResearchConfig();
  assert.equal(config.budgets.quick.maxSearches, 3);
  assert.equal(calls[0]?.url, 'http://localhost:3000/v1/research/config');

  // Test createResearch
  const created = await client.createResearch({
    projectId: 'proj-1',
    query: 'Test Query',
    depth: 'standard',
  });
  assert.equal(created.run.id, 'run-123');
  assert.equal(calls[1]?.method, 'POST');
  assert.equal(calls[1]?.url, 'http://localhost:3000/v1/research');

  // Test getResearch
  const details = await client.getResearch('run-123');
  assert.equal(details.run.status, 'completed');
  assert.equal(details.report?.title, 'Test Report');

  // Test approveResearchPlan
  const approved = await client.approveResearchPlan('run-123', {
    subQuestions: [{ id: 'sq-1', question: 'Q1', searchQueries: ['q1'], status: 'waiting' }],
  });
  assert.equal(approved.run.status, 'running');

  // Test cancelResearch
  const cancelled = await client.cancelResearch('run-123');
  assert.equal(cancelled.run.status, 'cancelled');

  // Test listResearch
  const list = await client.listResearch({ status: 'completed' });
  assert.equal(list.total, 0);
});
