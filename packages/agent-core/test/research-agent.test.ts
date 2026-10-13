import assert from 'node:assert/strict';
import test from 'node:test';
import { ResearchAgent, type ResearchEnvironment } from '../src/index.ts';

test('ResearchAgent: executes 9-step workflow with multi-source metadata, scoring, and contradiction detection', async () => {
  const mockEnv: ResearchEnvironment = {
    async search(query: string) {
      assert.ok(typeof query === 'string');
      return [
        {
          url: 'https://nodejs.org/api/test.html',
          title: 'Node.js Test Runner Documentation',
          domain: 'nodejs.org',
          author: 'Node.js Core Team',
          publishedDate: '2026-01-15',
          snippet:
            'The node:test module provides an integrated test framework without third-party deps.',
        },
        {
          url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
          title: 'MDN Web JavaScript Guide',
          domain: 'developer.mozilla.org',
          author: 'MDN Contributors',
          publishedDate: '2026-02-01',
          snippet: 'Standard modern JavaScript performance and module loading behaviors.',
        },
      ];
    },
  };

  const agent = new ResearchAgent();

  const report = await agent.execute({
    taskId: 'task-research-01',
    userId: 'user-researcher',
    query: 'Keunggulan native test runner Node.js dibanding framework eksternal',
    environment: mockEnv,
    mockClaims: [
      {
        id: 'claim-1',
        statement: 'Node.js test runner tidak memerlukan instalasi library tambahan seperti Jest.',
        type: 'sourced_fact',
        sourceIds: ['src-1'],
        confidence: 0.98,
      },
      {
        id: 'claim-2',
        statement: 'Waktu startup lebih cepat karena tidak ada overhead transpiler.',
        type: 'inference',
        sourceIds: [],
        confidence: 0.85,
      },
      {
        id: 'claim-3',
        statement: 'Dukungan mock module pada versi legacy Node 18 memiliki keterbatasan.',
        type: 'unverified',
        sourceIds: [],
        confidence: 0.6,
      },
    ],
    mockContradictions: [
      {
        id: 'contra-1',
        topic: 'Performa benchmark eksekusi test runner',
        sourceIdA: 'src-1',
        claimA: 'Waktu eksekusi 2x lebih hemat memori',
        sourceIdB: 'src-2',
        claimB: 'Selisih performa memori di bawah 15% pada workload riil',
        explanation: 'Perbedaan metodologi pengukuran lingkungan benchmark.',
      },
    ],
  });

  // Verify full 9-step execution
  assert.equal(report.status, 'completed');
  assert.equal(report.workflowStage, 'report');
  assert.equal(report.sources.length, 2);

  // Verify source metadata & scoring
  const s1 = report.sources[0];
  assert.equal(s1?.domain, 'nodejs.org');
  assert.ok((s1?.credibilityScore ?? 0) >= 0.6);

  // Verify claim categorization
  assert.equal(report.categorizedClaims.sourcedFacts.length, 1);
  assert.equal(report.categorizedClaims.inferences.length, 1);
  assert.equal(report.categorizedClaims.unverified.length, 1);

  // Verify contradiction logging
  assert.equal(report.contradictions.length, 1);
  assert.equal(report.contradictions[0]?.topic, 'Performa benchmark eksekusi test runner');

  // Verify ResearchEvaluator validation
  assert.equal(report.evaluationResult.passed, true);
  assert.equal(report.evaluationResult.score, 1.0);
  assert.equal(report.artifacts.length, 1);
  assert.match(report.artifacts[0]?.content ?? '', /Research Synthesis Report/);
});

test('ResearchAgent: Evaluator strictly BLOCKS completed status if fabricated citations are detected', async () => {
  const agent = new ResearchAgent();

  const report = await agent.execute({
    taskId: 'task-fake-cite',
    userId: 'user-researcher',
    query: 'Analisis AI OS',
    mockSources: [
      {
        id: 'src-real-1',
        url: 'https://example.org/article',
        title: 'Article',
        domain: 'example.org',
        credibilityScore: 0.88,
        snippet: 'Real article content',
      },
    ],
    mockClaims: [
      {
        id: 'claim-fake',
        statement: 'Klaim fakta dengan sitasi sumber fiktif yang tidak pernah diekstraksi.',
        type: 'sourced_fact',
        sourceIds: ['src-hallucinated-999'], // Fabricated source!
        confidence: 0.9,
      },
    ],
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.evaluationResult.passed, false);
  assert.match(
    report.evaluationResult.completionBlockedReason ?? '',
    /Fabricated citations detected|Citation mapping/i,
  );
});

test('ResearchAgent: Evaluator strictly BLOCKS completed status if no valid sources are provided', async () => {
  const agent = new ResearchAgent();

  const report = await agent.execute({
    taskId: 'task-empty-sources',
    userId: 'user-researcher',
    query: 'Riset tanpa sumber nyata',
    mockSources: [],
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.evaluationResult.passed, false);
  assert.match(report.evaluationResult.completionBlockedReason ?? '', /No valid sources provided/i);
});

test('ResearchAgent: without an environment it produces no sources and no fabricated claims', async () => {
  const agent = new ResearchAgent();

  const report = await agent.execute({
    taskId: 'task-no-environment',
    userId: 'user-researcher',
    query: 'Riset tanpa jalur pencarian',
  });

  assert.equal(report.status, 'failed');
  assert.deepEqual(report.sources, []);
  assert.deepEqual(report.claims, []);
  assert.equal(report.evaluationResult.passed, false);
});

test('ResearchAgent: fetches every searched source and cites the page it came from', async () => {
  const agent = new ResearchAgent();
  const fetched: string[] = [];

  const report = await agent.execute({
    taskId: 'task-browse',
    userId: 'user-researcher',
    query: 'durable execution',
    environment: {
      async search() {
        return [
          {
            url: 'https://example.org/durable',
            title: 'Durable execution explained',
            domain: 'example.org',
            snippet: 'search-engine snippet that must be replaced',
          },
          {
            url: 'https://example.com/checkpoints',
            title: 'Checkpointing workflows',
            domain: 'example.com',
            snippet: 'another search-engine snippet',
          },
          {
            url: 'https://example.net/broken',
            title: 'Broken page',
            domain: 'example.net',
            snippet: 'this source never resolves',
          },
        ];
      },
      async fetchContent(url: string) {
        fetched.push(url);
        if (url.endsWith('/broken')) throw new Error('HTTP 403');
        return {
          url,
          title: 'Fetched page title',
          content:
            'Durable execution persists each step of a workflow so a crash resumes from the last checkpoint instead of restarting the whole run.',
        };
      },
    },
  });

  assert.deepEqual(fetched, [
    'https://example.org/durable',
    'https://example.com/checkpoints',
    'https://example.net/broken',
  ]);
  assert.equal(report.status, 'completed');
  assert.equal(report.workflowStage, 'report');
  assert.deepEqual(
    report.sources.map((s) => s.url),
    ['https://example.org/durable', 'https://example.com/checkpoints'],
  );
  assert.match(report.sources[0]?.snippet ?? '', /Durable execution persists each step/);
  assert.doesNotMatch(report.sources[0]?.snippet ?? '', /search-engine snippet/);
  assert.equal(report.claims.length, 2);
  assert.ok(report.claims.every((claim) => claim.type === 'sourced_fact'));
  assert.deepEqual(report.claims[0]?.sourceIds, ['src-1']);
  assert.deepEqual(report.claims[1]?.sourceIds, ['src-2']);
  assert.ok(report.limitations.some((line) => line.includes('https://example.net/broken')));
  assert.ok(
    report.limitations.some((line) => line.includes('tidak disintesis lintas sumber')),
    'auto-derived facts must state that no model synthesized them',
  );
});

test('ResearchAgent: a search provider outage ends as a failed report, not a thrown error', async () => {
  const agent = new ResearchAgent();

  const report = await agent.execute({
    taskId: 'task-search-outage',
    userId: 'user-researcher',
    query: 'durable execution in PostgreSQL',
    environment: {
      async search() {
        throw new Error('Pencarian web tidak dapat diparsing: endpoint membalas HTTP 202.');
      },
    },
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.evaluationResult.passed, false);
  assert.equal(report.sources.length, 0);
  assert.match(report.summary, /HTTP 202/);
  assert.ok(report.limitations.some((line) => line.includes('HTTP 202')));
});
