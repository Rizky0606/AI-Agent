import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EVAL_CORPUS,
  EVAL_PAIRS,
  runMemorySearchBenchmark,
  type EmbeddingProvider,
} from '../src/index.ts';

// Synonym / concept expansion mapping for deterministic semantic evaluation
const SEMANTIC_CONCEPTS: Record<string, string[]> = {
  kredensial: ['kata sandi', 'password', 'sso', 'otentikasi', 'reset portal', 'login'],
  tampilan: ['visual', 'tema gelap', 'dark mode', 'warna', 'teal mint', 'font inter'],
  jam_kerja: ['jam kerja', 'wib', 'produktif', 'zona waktu', 'asia/jakarta'],
  beban_ai: ['kelebihan beban', 'inferensi lokal', 'vps arm64', 'beban komputasi'],
  kriptografi: ['kriptografi', 'kunci privat', 'dpapi', 'p-256', 'cryptprotectdata'],
  perayapan: ['perayapan', 'scraping', 'domain', 'halaman', 'deep research'],
  persetujuan: ['tindakan berbahaya', 'izin', 'waiting_approval', 'critical', 'high risk'],
  rahasia: ['data rahasia', 'ktp', 'nik', 'kartu kredit', 'sensitif', 'redaksi'],
  kuota_vektor: ['pemborosan kuota', 'kuota api', 'cache hash', 'sha-256', 'vektor'],
  enkripsi_cloud: ['encryption cipher', 'archive storage', 'enkripsi', 'aes-256-gcm', 's3'],
  migrasi_db: ['database migrations', 'ghost columns', 'schema drift', 'schema-parity', 'migrasi'],
  login_pkce: ['single step login', 'zero-click', 'pkce', 'oauth', 'token akses'],
  evaluator_bukti: ['hallucinated completion', 'evaluator check', 'bukti nyata', 'test exit codes'],
  usulan_skill: ['proposed skills', 'agent tasks', 'usulan skill', 'task evaluator'],
};

/**
 * Semantic-aware deterministic embedding provider for offline evaluations.
 * Maps both literal words and semantic concepts into dense 1536-dimensional vectors.
 */
class SemanticConceptEmbeddingProvider implements EmbeddingProvider {
  readonly isAvailable = true;
  private readonly dimensions = 1536;

  private extractConceptVector(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const lower = text.toLowerCase();
    const words = lower.split(/[^a-zA-Z0-9_-]+/).filter(Boolean);

    // 1. Literal word n-grams
    for (const w of words) {
      let hash = 0;
      for (let j = 0; j < w.length; j++) {
        hash = (hash * 31 + w.charCodeAt(j)) >>> 0;
      }
      const idx = hash % this.dimensions;
      vec[idx] = (vec[idx] ?? 0) + 1.0;
    }

    // 2. Semantic concept projections
    let conceptIdx = 0;
    for (const [, synonyms] of Object.entries(SEMANTIC_CONCEPTS)) {
      conceptIdx++;
      const matched = synonyms.some((syn) => lower.includes(syn));
      if (matched) {
        // Project strongly into dedicated concept coordinate cluster
        const baseCoord = (conceptIdx * 83) % this.dimensions;
        vec[baseCoord] = (vec[baseCoord] ?? 0) + 5.0;
        vec[(baseCoord + 1) % this.dimensions] = (vec[(baseCoord + 1) % this.dimensions] ?? 0) + 3.0;
      }
    }

    // 3. L2 normalize vector
    let sumSq = 0;
    for (let i = 0; i < this.dimensions; i++) {
      sumSq += (vec[i] ?? 0) * (vec[i] ?? 0);
    }
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < this.dimensions; i++) {
      vec[i] = Number(((vec[i] ?? 0) / norm).toFixed(6));
    }

    return vec;
  }

  async embed(text: string): Promise<readonly number[]> {
    return this.extractConceptVector(text);
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map((t) => this.extractConceptVector(t));
  }
}

test('Evaluation Dataset contains at least 30 memories and 30 query-memory pairs', () => {
  assert.ok(EVAL_CORPUS.length >= 30, `Corpus must have >= 30 memories, found: ${EVAL_CORPUS.length}`);
  assert.ok(EVAL_PAIRS.length >= 30, `Pairs must have >= 30 query pairs, found: ${EVAL_PAIRS.length}`);

  // Ensure all expectedMemoryIds exist in corpus
  const corpusIds = new Set(EVAL_CORPUS.map((m) => m.id));
  for (const pair of EVAL_PAIRS) {
    assert.ok(
      corpusIds.has(pair.expectedMemoryId),
      `Pair ${pair.id} expects unknown memory id: ${pair.expectedMemoryId}`,
    );
  }
});

test('runMemorySearchBenchmark executes and compares Text, Semantic, and Hybrid search', async () => {
  const provider = new SemanticConceptEmbeddingProvider();
  const report = await runMemorySearchBenchmark(provider, 5);

  assert.equal(report.totalMemories, EVAL_CORPUS.length);
  assert.equal(report.totalQueries, EVAL_PAIRS.length);

  // Validate presence of metrics for all 3 modes
  assert.ok(report.metrics.text);
  assert.ok(report.metrics.semantic);
  assert.ok(report.metrics.hybrid);

  // Assert valid bounds for recall and MRR
  for (const mode of ['text', 'semantic', 'hybrid'] as const) {
    const m = report.metrics[mode];
    assert.ok(m.recallAt1 >= 0 && m.recallAt1 <= 1.0, `${mode} recallAt1 out of bounds`);
    assert.ok(m.recallAt3 >= 0 && m.recallAt3 <= 1.0, `${mode} recallAt3 out of bounds`);
    assert.ok(m.recallAt5 >= 0 && m.recallAt5 <= 1.0, `${mode} recallAt5 out of bounds`);
    assert.ok(m.mrr >= 0 && m.mrr <= 1.0, `${mode} mrr out of bounds`);
    assert.ok(m.avgLatencyMs >= 0, `${mode} avgLatencyMs negative`);
  }

  // Hybrid search must achieve superior or equal Recall@3 and MRR than Pure Text
  assert.ok(
    report.metrics.hybrid.recallAt3 >= report.metrics.text.recallAt3,
    `Hybrid Recall@3 (${report.metrics.hybrid.recallAt3}) must be >= Text Recall@3 (${report.metrics.text.recallAt3})`,
  );
  assert.ok(
    report.metrics.hybrid.mrr >= report.metrics.text.mrr,
    `Hybrid MRR (${report.metrics.hybrid.mrr}) must be >= Text MRR (${report.metrics.text.mrr})`,
  );

  // Winner must be hybrid or semantic
  assert.ok(
    report.winner === 'hybrid' || report.winner === 'semantic',
    `Expected hybrid or semantic winner, got: ${report.winner}`,
  );
  assert.ok(report.recommendation.length > 20);
});
