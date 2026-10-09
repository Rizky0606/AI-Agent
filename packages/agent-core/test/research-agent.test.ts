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
    mockEnvironment: mockEnv,
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
