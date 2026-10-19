import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialResearchProgressState,
  extractCitationIds,
  extractDomainInitials,
  parseCitations,
  reduceResearchProgress,
  type ResearchEvidenceItem,
  type ResearchSourceItem,
} from '../src/index.ts';

test('extractDomainInitials extracts clean 2-letter uppercase badges without external network', () => {
  assert.equal(extractDomainInitials('wikipedia.org'), 'WI');
  assert.equal(extractDomainInitials('https://developer.mozilla.org/api'), 'DE');
  assert.equal(extractDomainInitials('nodejs.org'), 'NO');
  assert.equal(extractDomainInitials('tauri.app'), 'TA');
  assert.equal(extractDomainInitials(''), '??');
  assert.equal(extractDomainInitials('a.io'), 'AI');
});

test('parseCitations: parses valid citations and handles non-existent IDs without crashing', () => {
  const sources: ResearchSourceItem[] = [
    {
      id: 'src-1',
      url: 'https://en.wikipedia.org/wiki/Claude',
      title: 'Claude AI',
      domain: 'en.wikipedia.org',
      initials: 'EN',
      credibilityScore: 0.9,
    },
    {
      id: 'src-2',
      url: 'https://anthropic.com',
      title: 'Anthropic Official',
      domain: 'anthropic.com',
      initials: 'AN',
      credibilityScore: 0.95,
    },
  ];

  const evidence: ResearchEvidenceItem[] = [
    {
      id: 'ev-1',
      sourceId: 'src-1',
      statement: 'Claude dikembangkan oleh Anthropic.',
      claimType: 'sourced_fact',
      quote: 'Kutipan resmi dari Wikipedia mengenai Claude.',
      confidence: 0.9,
    },
  ];

  const text =
    'Claude dikembangkan oleh Anthropic [src-1]. Perusahaan berbasis di San Francisco [src-2]. ' +
    'Klaim tak bersumber menunjuk ke ID fiktif [src-999] dan [src-42].';

  const citationMap = parseCitations(text, sources, evidence);

  // 1. Valid citation src-1
  const c1 = citationMap.get('src-1');
  assert.ok(c1);
  assert.equal(c1.isValid, true);
  assert.equal(c1.number, 1);
  assert.equal(c1.source?.title, 'Claude AI');
  assert.equal(c1.quote, 'Kutipan resmi dari Wikipedia mengenai Claude.');

  // 2. Valid citation src-2 (no quote in evidence, but source exists)
  const c2 = citationMap.get('src-2');
  assert.ok(c2);
  assert.equal(c2.isValid, true);
  assert.equal(c2.number, 2);
  assert.equal(c2.source?.title, 'Anthropic Official');

  // 3. Non-existent citation src-999 (MUST NOT crash!)
  const c999 = citationMap.get('src-999');
  assert.ok(c999);
  assert.equal(c999.isValid, false);
  assert.equal(c999.number, 999);
  assert.equal(c999.source, undefined);
  assert.match(c999.label, /Sumber tidak ditemukan/i);

  // 4. Non-existent citation src-42 (MUST NOT crash!)
  const c42 = citationMap.get('src-42');
  assert.ok(c42);
  assert.equal(c42.isValid, false);
  assert.equal(c42.number, 42);

  // 5. extractCitationIds
  const ids = extractCitationIds(text);
  assert.deepEqual(ids, ['src-1', 'src-2', 'src-999', 'src-42']);
});

test('reduceResearchProgress: handles out-of-order events and prevents terminal state regression', () => {
  let state = createInitialResearchProgressState({
    runId: 'run-001',
    query: 'Analisis arsitektur sistem operasi AI',
    depth: 'standard',
  });

  assert.equal(state.status, 'queued');

  // 1. Out-of-order: search arrives before plan
  state = reduceResearchProgress(state, {
    id: 'evt-search-1',
    eventType: 'research.search',
    payload: { query: 'arsitektur mikrokernel', searchesExecuted: 1 },
    createdAt: '2026-10-17T10:00:01Z',
  });
  assert.equal(state.status, 'running');
  assert.equal(state.budgetUsed.searchesCount, 1);

  // 2. Plan arrives after search
  state = reduceResearchProgress(state, {
    id: 'evt-plan-1',
    eventType: 'research.plan',
    payload: {
      plan: {
        subQuestions: [
          {
            id: 'sub-1',
            question: 'Apa prinsip dasar mikrokernel?',
            searchQueries: ['arsitektur mikrokernel'],
          },
          {
            id: 'sub-2',
            question: 'Bagaimana konsumsi memori?',
            searchQueries: ['overhead memori'],
          },
        ],
        approved: true,
      },
    },
    createdAt: '2026-10-17T10:00:02Z',
  });
  assert.equal(state.subQuestions.length, 2);
  assert.equal(state.status, 'running');

  // 3. Mark completed via research.done
  state = reduceResearchProgress(state, {
    id: 'evt-done-1',
    eventType: 'research.done',
    payload: {
      passed: true,
      report: {
        title: 'Laporan Selesai',
        contentMarkdown: '# Selesai [src-1]',
        confidenceBySection: { Intro: 0.95 },
      },
    },
    createdAt: '2026-10-17T10:00:10Z',
  });
  assert.equal(state.status, 'completed');
  assert.ok(state.report);
  assert.equal(state.report.title, 'Laporan Selesai');

  // 4. Stale event arrives AFTER completion (e.g. late search/started)
  // MUST NOT regress state.status from completed back to running!
  const stateAfterStale = reduceResearchProgress(state, {
    id: 'evt-stale-search',
    eventType: 'research.search',
    payload: { query: 'stale query' },
    createdAt: '2026-10-17T10:00:11Z',
  });
  assert.equal(stateAfterStale.status, 'completed');
});

test('reduceResearchProgress: suppresses duplicate events (idempotency)', () => {
  const initial = createInitialResearchProgressState({
    runId: 'run-002',
    query: 'Kueri tes deduplikasi',
  });

  const event1 = {
    id: 'duplicate-event-id-123',
    eventType: 'research.source',
    payload: {
      source: {
        id: 'src-1',
        url: 'https://example.org/test',
        title: 'Contoh',
        domain: 'example.org',
      },
    },
  };

  // First application: source added
  const state1 = reduceResearchProgress(initial, event1);
  assert.equal(state1.sources.length, 1);
  assert.equal(state1.seenEventIds.length, 1);

  // Second application with identical ID: state must be unchanged
  const state2 = reduceResearchProgress(state1, event1);
  assert.equal(state2.sources.length, 1);
  assert.equal(state2, state1);
});

test('reduceResearchProgress: handles WebSocket reconnect replay seamlessly', () => {
  let state = createInitialResearchProgressState({
    runId: 'run-003',
    query: 'Replay Test',
    depth: 'deep',
  });

  const fullHistory = [
    {
      id: 'h-1',
      eventType: 'research.started',
      payload: {},
    },
    {
      id: 'h-2',
      eventType: 'research.plan',
      payload: {
        plan: {
          subQuestions: [
            { id: 'q-1', question: 'Tanya 1', searchQueries: ['kueri 1'] },
          ],
          approved: false,
        },
      },
    },
    {
      id: 'h-3',
      eventType: 'research.source',
      payload: {
        source: {
          id: 'src-1',
          url: 'https://docs.kernel.org',
          title: 'Kernel Docs',
          domain: 'docs.kernel.org',
        },
      },
    },
    {
      id: 'h-4',
      eventType: 'research.evidence',
      payload: {
        evidence: {
          id: 'ev-1',
          sourceId: 'src-1',
          statement: 'Kernel menggunakan sistem modular.',
          quote: 'Sistem modular.',
        },
      },
    },
  ];

  // Client was disconnected and receives entire history from replay
  for (const evt of fullHistory) {
    state = reduceResearchProgress(state, evt);
  }

  assert.equal(state.status, 'waiting_plan_approval');
  assert.equal(state.sources.length, 1);
  assert.equal(state.evidence.length, 1);
  assert.equal(state.sources[0]?.domain, 'docs.kernel.org');
  assert.equal(state.sources[0]?.initials, 'DO');
  assert.equal(state.seenEventIds.length, 4);
});
