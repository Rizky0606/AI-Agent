import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCitations,
  reduceResearchProgress,
  extractDomainInitials,
  type ResearchProgressState,
  type ResearchSourceItem,
  type ResearchEvidenceItem,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { ApiClient } from '../src/api/client.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';

test('Android Research - extractDomainInitials generates uppercase 2-letter tokens for badges', () => {
  assert.equal(extractDomainInitials('wikipedia.org'), 'WI');
  assert.equal(extractDomainInitials('developer.mozilla.org'), 'DE');
  assert.equal(extractDomainInitials('reactnative.dev'), 'RE');
  assert.equal(extractDomainInitials('google.com'), 'GO');
  assert.equal(extractDomainInitials(''), '??');
});

test('Android Research - parseCitations maps citations and protects against unlisted references', () => {
  const content = `
Fitur deep research Android terhubung langsung ke backend [src-1].
Semua konten eksternal diisolasi dalam safe container [src-2].
Sitasi ini sengaja tidak terdaftar [src-42].
`;

  const sources: ResearchSourceItem[] = [
    {
      id: 'src-1',
      url: 'https://reactnative.dev/architecture',
      title: 'React Native Architecture',
      domain: 'reactnative.dev',
      initials: 'RE',
      credibilityScore: 0.92,
      snippet: 'Mobile client architecture overview.',
    },
    {
      id: 'src-2',
      url: 'https://owasp.org/www-project-mobile-top-10',
      title: 'OWASP Mobile Security',
      domain: 'owasp.org',
      initials: 'OW',
      credibilityScore: 0.99,
      snippet: 'Safe handling of untrusted web content.',
    },
  ];

  const evidence: ResearchEvidenceItem[] = [
    {
      id: 'ev-1',
      sourceId: 'src-1',
      statement: 'Fitur deep research terhubung langsung ke backend',
      quote: 'React Native components interface directly with the Fastify backend API.',
      claimType: 'fact',
      confidence: 0.9,
    },
    {
      id: 'ev-2',
      sourceId: 'src-2',
      statement: 'Konten eksternal diisolasi',
      quote: 'Untrusted content must be rendered in sandboxed contexts without elevated execution rights.',
      claimType: 'fact',
      confidence: 0.95,
    },
  ];

  const citations = parseCitations(content, sources, evidence);

  assert.equal(citations.size, 3);

  const cit1 = citations.get('src-1');
  assert.ok(cit1);
  assert.equal(cit1.isValid, true);
  assert.equal(cit1.number, 1);
  assert.equal(cit1.source?.title, 'React Native Architecture');
  assert.equal(cit1.quote, 'React Native components interface directly with the Fastify backend API.');
  assert.ok(cit1.quote.length <= 200);

  const cit42 = citations.get('src-42');
  assert.ok(cit42);
  assert.equal(cit42.isValid, false);
  assert.equal(cit42.source, undefined);
  assert.equal(cit42.label, '[src-42: Sumber tidak ditemukan]');
});

test('Android Research - reduceResearchProgress transitions correctly across research lifecycle', () => {
  const initial: ResearchProgressState = {
    runId: 'run-android-1',
    status: 'queued',
    query: 'Bagaimana perbandingan React Native New Architecture dengan Flutter?',
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

  // 1. Plan generated event -> status waiting_plan_approval (karena deep)
  const planEvent: TaskEventEnvelope = {
    id: 'evt-p1',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.plan',
    createdAt: new Date().toISOString(),
    payload: {
      plan: {
        subQuestions: [
          { id: 'sq-1', question: 'Performa render JSI vs Skia', searchQueries: ['rn jsi vs flutter skia'] },
          { id: 'sq-2', question: 'Ukuran bundle binary Android', searchQueries: ['rn vs flutter apk size'] },
        ],
      },
    },
  };

  const stateAfterPlan = reduceResearchProgress(initial, planEvent);
  assert.equal(stateAfterPlan.status, 'waiting_plan_approval');
  assert.equal(stateAfterPlan.subQuestions.length, 2);

  // 2. User approves plan -> status running
  const approveEvent: TaskEventEnvelope = {
    id: 'evt-p2',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.plan_approved',
    createdAt: new Date().toISOString(),
    payload: {},
  };

  const stateRunning = reduceResearchProgress(stateAfterPlan, approveEvent);
  assert.equal(stateRunning.status, 'running');

  // 3. Search executed
  const searchEvent: TaskEventEnvelope = {
    id: 'evt-s1',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.search',
    createdAt: new Date().toISOString(),
    payload: { query: 'rn jsi vs flutter skia', searchesExecuted: 1 },
  };

  const stateSearching = reduceResearchProgress(stateRunning, searchEvent);
  assert.equal(stateSearching.budgetUsed.searchesCount, 1);
  assert.equal(stateSearching.subQuestions[0]?.status, 'searching');

  // 4. Source discovered
  const sourceEvent: TaskEventEnvelope = {
    id: 'evt-so1',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.source',
    createdAt: new Date().toISOString(),
    payload: {
      source: {
        id: 'src-1',
        url: 'https://reactnative.dev/blog/new-architecture',
        title: 'New Architecture Overview',
        domain: 'reactnative.dev',
        credibilityScore: 0.95,
      },
    },
  };

  const stateReading = reduceResearchProgress(stateSearching, sourceEvent);
  assert.equal(stateReading.sources.length, 1);
  assert.equal(stateReading.subQuestions[0]?.status, 'reading');

  // 5. Evidence extracted
  const evidenceEvent: TaskEventEnvelope = {
    id: 'evt-e1',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.evidence',
    createdAt: new Date().toISOString(),
    payload: {
      evidence: {
        id: 'evi-1',
        sourceId: 'src-1',
        statement: 'JSI mengeliminasi bridge serialisasi asynchronous',
        quote: 'JSI allows direct JavaScript to C++ invocations without JSON serialisation overhead.',
        claimType: 'fact',
      },
    },
  };

  const stateExtracting = reduceResearchProgress(stateReading, evidenceEvent);
  assert.equal(stateExtracting.evidence.length, 1);
  assert.equal(stateExtracting.subQuestions[0]?.status, 'extracting');

  // 6. Complete
  const doneEvent: TaskEventEnvelope = {
    id: 'evt-d1',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.done',
    createdAt: new Date().toISOString(),
    payload: {
      report: {
        title: 'Laporan Komparasi Mobile Engine',
        summary: 'React Native JSI memberikan performa setara Flutter.',
        contentMarkdown: 'JSI mengeliminasi bridge overhead [src-1].',
        confidenceBySection: { 'Analisis JSI': 0.95 },
        gaps: ['Benchmarking pada perangkat Android Go belum dilakukan.'],
      },
    },
  };

  const stateDone = reduceResearchProgress(stateExtracting, doneEvent);
  assert.equal(stateDone.status, 'completed');
  assert.ok(stateDone.report);
  assert.equal(stateDone.report.gaps?.[0], 'Benchmarking pada perangkat Android Go belum dilakukan.');

  // 7. Proteksi Out-of-Order Terminal: event lama tidak boleh mengubah status kembali ke running
  const outOfOrderEvent: TaskEventEnvelope = {
    id: 'evt-late',
    taskId: 'run-android-1',
    userId: 'user-1',
    eventType: 'research.search',
    createdAt: new Date().toISOString(),
    payload: { query: 'late query' },
  };

  const statePostLate = reduceResearchProgress(stateDone, outOfOrderEvent);
  assert.equal(statePostLate.status, 'completed', 'Terminal state status must not regress');
});

test('Android Research - ApiClient research methods perform expected HTTP calls to API backend', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: urlStr, body });

    if (method === 'POST' && urlStr.endsWith('/v1/research')) {
      return new Response(
        JSON.stringify({
          run: {
            id: 'run-rn-100',
            projectId: 'proj-rn',
            query: 'Mobile Architecture',
            depth: 'quick',
            status: 'running',
            budgetConfig: { maxSearches: 3, maxPagesRead: 4, maxModelTokens: 20000, maxDurationMs: 60000 },
            budgetUsed: { searchesCount: 0, pagesReadCount: 0, modelTokensCount: 0, durationMs: 0 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'POST' && urlStr.endsWith('/approve-plan')) {
      return new Response(
        JSON.stringify({
          run: { id: 'run-rn-100', status: 'running' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (method === 'POST' && urlStr.endsWith('/cancel')) {
      return new Response(
        JSON.stringify({
          run: { id: 'run-rn-100', status: 'cancelled' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  };

  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('bearer-test-token');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as unknown as typeof fetch;

  try {
    const client = new ApiClient({
      baseUrl: 'https://api.personal-ai.internal',
      storage,
    });

    // 1. Create research
    const created = await client.createResearch({
      projectId: 'proj-rn',
      query: 'Mobile Architecture',
      depth: 'quick',
    });
    assert.equal(created.run.id, 'run-rn-100');
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.url, 'https://api.personal-ai.internal/v1/research');

    // 2. Approve plan
    const approved = await client.approveResearchPlan('run-rn-100', {
      subQuestions: [
        { id: 'sq-1', question: 'Q1', searchQueries: ['q1'], status: 'waiting' },
      ],
    });
    assert.equal(approved.run.status, 'running');
    assert.equal(calls[1]?.method, 'POST');
    assert.equal(calls[1]?.url, 'https://api.personal-ai.internal/v1/research/run-rn-100/approve-plan');

    // 3. Cancel research
    const cancelled = await client.cancelResearch('run-rn-100');
    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(calls[2]?.method, 'POST');
    assert.equal(calls[2]?.url, 'https://api.personal-ai.internal/v1/research/run-rn-100/cancel');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
