import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodingEvaluator,
  DEFAULT_CODING_CRITERIA,
  DEFAULT_RESEARCH_CRITERIA,
  GenericEvaluator,
  ResearchEvaluator,
} from '../src/index.ts';

test('GenericEvaluator: evaluates criteria against evidence and calculates score', () => {
  const evaluator = new GenericEvaluator();

  const criteria = [
    {
      id: 'spec_artifact',
      description: 'Menghasilkan dokumen spesifikasi arsitektur',
      category: 'generic' as const,
      required: true,
      expectedEvidenceType: 'artifact',
    },
    {
      id: 'summary_output',
      description: 'Menyediakan ringkasan eksekutif dalam output',
      category: 'generic' as const,
      required: true,
      expectedEvidenceType: 'output',
    },
  ];

  const result = evaluator.evaluate(criteria, {
    artifacts: [{ title: 'spec_artifact.md', content: 'Dokumen arsitektur v1' }],
    outputs: { summary: 'Ringkasan eksekutif telah selesai' },
    logs: ['Penyusunan spesifikasi sukses'],
  });

  assert.equal(result.passed, true);
  assert.equal(result.score, 1.0);
  assert.equal(result.remainingIssues.length, 0);
  assert.equal(result.selfClaimRejected, false);
});

test('GenericEvaluator: rejects when no concrete evidence accompanies the claim', () => {
  const evaluator = new GenericEvaluator();

  const criteria = [
    {
      id: 'spec_artifact',
      description: 'Menghasilkan dokumen spesifikasi',
      category: 'generic' as const,
      required: true,
    },
  ];

  // Agent claims done but provides no artifacts/outputs/logs
  const result = evaluator.evaluate(criteria, {});

  assert.equal(result.passed, false);
  assert.equal(result.selfClaimRejected, true);
  assert.match(result.remainingIssues[0] ?? '', /klaim selesai ditolak/i);
});

test('CodingEvaluator: STRICTLY REJECTS agent self-claim without tooling proof (AGENTS.md rule 7)', () => {
  const evaluator = new CodingEvaluator();

  // Agent says "I am done and fixed everything", but gives no tooling proofs
  const selfClaimOnlyResult = evaluator.evaluate({
    selfClaimOnly: true,
  });

  assert.equal(selfClaimOnlyResult.passed, false);
  assert.equal(selfClaimOnlyResult.selfClaimRejected, true);
  assert.equal(selfClaimOnlyResult.score, 0);
  assert.match(
    selfClaimOnlyResult.remainingIssues[0] ?? '',
    /Agent tidak boleh menyatakan selesai berdasarkan klaimnya sendiri/i,
  );

  // Empty evidence object also rejected
  const emptyEvidenceResult = evaluator.evaluate({});
  assert.equal(emptyEvidenceResult.passed, false);
  assert.equal(emptyEvidenceResult.selfClaimRejected, true);
});

test('CodingEvaluator: rejects when any required check fails (lint, test, build, diff)', () => {
  const evaluator = new CodingEvaluator();

  // Test fails
  const failedTestResult = evaluator.evaluate({
    lintPassed: true,
    typecheckPassed: true,
    testsPassed: false,
    testsFailedCount: 2,
    testOutput: '2 tests failed in worker.test.ts',
    buildPassed: true,
    diffAvailable: true,
  });

  assert.equal(failedTestResult.passed, false);
  assert.equal(failedTestResult.selfClaimRejected, false);
  assert.ok(failedTestResult.score < 1.0);
  assert.match(failedTestResult.remainingIssues[0] ?? '', /Test issue/i);

  // Diff not available
  const missingDiffResult = evaluator.evaluate({
    lintPassed: true,
    typecheckPassed: true,
    testsPassed: true,
    testsFailedCount: 0,
    buildPassed: true,
    diffAvailable: false,
  });

  assert.equal(missingDiffResult.passed, false);
  assert.match(missingDiffResult.remainingIssues[0] ?? '', /Diff issue/i);
});

test('CodingEvaluator: passes with 100% score when concrete evidence for all checks is verified', () => {
  const evaluator = new CodingEvaluator();

  const passedResult = evaluator.evaluate({
    lintPassed: true,
    lintOutput: 'ESLint passed (0 errors, 0 warnings)',
    typecheckPassed: true,
    typecheckOutput: 'tsc --noEmit passed',
    testsPassed: true,
    testsPassedCount: 42,
    testsFailedCount: 0,
    testOutput: 'All 42 tests passed',
    buildPassed: true,
    buildOutput: 'All packages built successfully',
    diffAvailable: true,
    diffSummary: 'Working tree matches expected changes',
  });

  assert.equal(passedResult.passed, true);
  assert.equal(passedResult.score, 1.0);
  assert.equal(passedResult.remainingIssues.length, 0);
  assert.equal(passedResult.selfClaimRejected, false);
  assert.equal(passedResult.evaluatedCriteria.length, DEFAULT_CODING_CRITERIA.length);
});

test('CodingEvaluator: rejects when security check or requirement coverage fails', () => {
  const evaluator = new CodingEvaluator();

  // Security check failed
  const securityFailResult = evaluator.evaluate({
    lintPassed: true,
    typecheckPassed: true,
    testsPassed: true,
    buildPassed: true,
    diffAvailable: true,
    securityCheckPassed: false,
    securityCheckDetails: 'Hardcoded API secret found in src/config.ts',
  });

  assert.equal(securityFailResult.passed, false);
  assert.match(securityFailResult.remainingIssues[0] ?? '', /Security issue/i);

  // Requirement coverage below 80%
  const coverageFailResult = evaluator.evaluate({
    lintPassed: true,
    typecheckPassed: true,
    testsPassed: true,
    buildPassed: true,
    diffAvailable: true,
    securityCheckPassed: true,
    requirementCoverage: 0.6,
    requirementIssues: ['Missing diff self-review endpoint'],
  });

  assert.equal(coverageFailResult.passed, false);
  assert.match(coverageFailResult.remainingIssues[0] ?? '', /Coverage issue/i);
});

test('ResearchEvaluator: rejects self-claim without real sources (anti-hallucination)', () => {
  const evaluator = new ResearchEvaluator();

  const selfClaimResult = evaluator.evaluate({
    selfClaimOnly: true,
    sources: [],
    claims: [],
  });

  assert.equal(selfClaimResult.passed, false);
  assert.equal(selfClaimResult.selfClaimRejected, true);
  assert.ok(selfClaimResult.completionBlockedReason?.includes('No valid sources'));
});

test('ResearchEvaluator: rejects when fabricated citations are detected', () => {
  const evaluator = new ResearchEvaluator();

  const fabricatedResult = evaluator.evaluate({
    sources: [
      {
        id: 's1',
        url: 'https://example.com/doc',
        title: 'Doc',
        domain: 'example.com',
        credibilityScore: 0.9,
      },
    ],
    claims: [
      {
        id: 'c1',
        statement: 'Statement from nowhere',
        type: 'sourced_fact',
        sourceIds: ['s1'],
      },
    ],
    hasFabricatedCitations: true,
  });

  assert.equal(fabricatedResult.passed, false);
  assert.ok(fabricatedResult.completionBlockedReason?.includes('Fabricated citations detected'));
});

test('ResearchEvaluator: passes with comprehensive sources, citation mapping, and categorized claims', () => {
  const evaluator = new ResearchEvaluator();

  const passedResult = evaluator.evaluate({
    sources: [
      {
        id: 'src-1',
        url: 'https://developer.mozilla.org/doc',
        title: 'MDN Web Docs',
        domain: 'developer.mozilla.org',
        credibilityScore: 0.95,
      },
      {
        id: 'src-2',
        url: 'https://nodejs.org/api',
        title: 'Node.js Docs',
        domain: 'nodejs.org',
        credibilityScore: 0.9,
      },
    ],
    claims: [
      {
        id: 'cl-1',
        statement: 'TypeScript compiles to JS',
        type: 'sourced_fact',
        sourceIds: ['src-1', 'src-2'],
      },
      {
        id: 'cl-2',
        statement: 'Adoption will grow further',
        type: 'inference',
      },
      {
        id: 'cl-3',
        statement: 'Future Node 24 support',
        type: 'unverified',
      },
    ],
    contradictions: [],
    totalTopicsCount: 2,
    topicsCoveredCount: 2,
  });

  assert.equal(passedResult.passed, true);
  assert.equal(passedResult.score, 1.0);
  assert.equal(passedResult.remainingIssues.length, 0);
  assert.equal(passedResult.evaluatedCriteria.length, DEFAULT_RESEARCH_CRITERIA.length);
});

test('ResearchEvaluator: evaluateAsync re-fetches URL sources and verifies claim support and query relevance', async () => {
  const evaluator = new ResearchEvaluator();

  const fetchedUrls: string[] = [];
  const fakeUrlFetcher = async (url: string) => {
    fetchedUrls.push(url);
    if (url.includes('postgres')) {
      return 'PostgreSQL provides advisory locks for application-level concurrency control and worker coordination.';
    }
    return 'Redis provides distributed locking and atomic primitives.';
  };

  const result = await evaluator.evaluateAsync(
    {
      query: 'PostgreSQL advisory locks for workers',
      sources: [
        {
          id: 'src-pg',
          url: 'https://postgresql.org/docs/advisory-locks',
          title: 'PostgreSQL Advisory Locks',
          domain: 'postgresql.org',
          snippet: 'Initial snippet',
          credibilityScore: 0.95,
        },
        {
          id: 'src-redis',
          url: 'https://redis.io/docs/manual/patterns/distributed-locks',
          title: 'Redis Distributed Locks',
          domain: 'redis.io',
          snippet: 'Initial snippet',
          credibilityScore: 0.9,
        },
      ],
      claims: [
        {
          id: 'c-1',
          statement: 'PostgreSQL provides advisory locks for concurrency control',
          type: 'sourced_fact',
          sourceIds: ['src-pg', 'src-redis'],
        },
      ],
      contradictions: [],
      totalTopicsCount: 1,
      topicsCoveredCount: 1,
    },
    { urlFetcher: fakeUrlFetcher },
  );

  assert.equal(result.passed, true);
  assert.equal(result.score, 1.0);
  assert.deepEqual(fetchedUrls.sort(), [
    'https://postgresql.org/docs/advisory-locks',
    'https://redis.io/docs/manual/patterns/distributed-locks',
  ].sort());
  const supportCriterion = result.evaluatedCriteria.find((c) => c.criterionId === 'claim_support');
  assert.ok(supportCriterion?.passed);
  const relevanceCriterion = result.evaluatedCriteria.find((c) => c.criterionId === 'query_relevance');
  assert.ok(relevanceCriterion?.passed);
});

test('ResearchEvaluator: rejects when claims lack support in re-fetched content or fail query relevance', async () => {
  const evaluator = new ResearchEvaluator();

  // 1. Unsupported claim: cited page talks about something totally unrelated
  const unsupportedResult = await evaluator.evaluateAsync(
    {
      query: 'PostgreSQL performance',
      sources: [
        {
          id: 'src-1',
          url: 'https://gardening.org/flowers',
          title: 'Gardening Guide',
          domain: 'gardening.org',
          snippet: 'Roses and sunflowers require water and sunlight daily.',
          credibilityScore: 0.8,
        },
      ],
      claims: [
        {
          id: 'c-1',
          statement: 'PostgreSQL indexes speed up database queries dramatically',
          type: 'sourced_fact',
          sourceIds: ['src-1'],
        },
      ],
      contradictions: [],
      totalTopicsCount: 1,
      topicsCoveredCount: 1,
    },
    {
      urlFetcher: async () => 'Roses and sunflowers require water and sunlight daily. Plant in rich soil.',
    },
  );

  assert.equal(unsupportedResult.passed, false);
  const claimSupportCrit = unsupportedResult.evaluatedCriteria.find((c) => c.criterionId === 'claim_support');
  assert.equal(claimSupportCrit?.passed, false);
  assert.match(claimSupportCrit?.reason ?? '', /tidak didukung oleh isi sumber/);

  // 2. Irrelevant claims to the query
  const irrelevantResult = evaluator.evaluate({
    query: 'Quantum computing hardware architecture',
    sources: [
      {
        id: 'src-1',
        url: 'https://recipe.com/pasta',
        title: 'Pasta Recipe',
        domain: 'recipe.com',
        snippet: 'Boil water, add salt and pasta for 10 minutes.',
        credibilityScore: 0.8,
      },
    ],
    claims: [
      {
        id: 'c-1',
        statement: 'Boil water and add salt for making pasta',
        type: 'sourced_fact',
        sourceIds: ['src-1'],
      },
    ],
    contradictions: [],
    totalTopicsCount: 1,
    topicsCoveredCount: 1,
  });

  assert.equal(irrelevantResult.passed, false);
  const relevanceCrit = irrelevantResult.evaluatedCriteria.find((c) => c.criterionId === 'query_relevance');
  assert.equal(relevanceCrit?.passed, false);
  assert.match(relevanceCrit?.reason ?? '', /tidak memiliki relevansi memadai/);
});

