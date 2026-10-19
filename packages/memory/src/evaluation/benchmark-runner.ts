import type { EmbeddingProvider } from '../types.ts';
import { InMemoryMemoryStore } from '../store/in-memory-store.ts';
import { EVAL_CORPUS, EVAL_PAIRS } from './evaluation-dataset.ts';

export interface SearchModeMetrics {
  mode: 'text' | 'semantic' | 'hybrid';
  totalQueries: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number; // Mean Reciprocal Rank
  avgLatencyMs: number;
  categoryRecallAt3: Record<string, number>;
}

export interface BenchmarkReport {
  timestamp: string;
  totalMemories: number;
  totalQueries: number;
  metrics: {
    text: SearchModeMetrics;
    semantic: SearchModeMetrics;
    hybrid: SearchModeMetrics;
  };
  winner: 'text' | 'semantic' | 'hybrid';
  recommendation: string;
  detailedResults: Array<{
    queryId: string;
    query: string;
    expectedMemoryId: string;
    category: string;
    textRank: number;
    semanticRank: number;
    hybridRank: number;
  }>;
}

/**
 * Executes a full comparative benchmark across pure text, pure vector, and hybrid search.
 */
export async function runMemorySearchBenchmark(
  embeddingProvider: EmbeddingProvider,
  topK = 5,
): Promise<BenchmarkReport> {
  const store = new InMemoryMemoryStore();
  const userId = 'benchmark-user';

  // 1. Populate store with pre-computed embeddings
  const contents = EVAL_CORPUS.map((m) => m.content);
  const embeddings = await embeddingProvider.embedBatch(contents);

  for (let i = 0; i < EVAL_CORPUS.length; i++) {
    const item = EVAL_CORPUS[i]!;
    const emb = embeddings[i];
    await store.store(
      {
        userId,
        type: item.type,
        content: item.content,
        scope: item.scope,
        provenance: 'user_explicit',
      },
      emb,
    );
  }

  // Helper to compute metrics for a given mode
  const evaluateMode = async (
    mode: 'text' | 'semantic' | 'hybrid',
  ): Promise<{ metrics: SearchModeMetrics; ranks: number[] }> => {
    let top1Matches = 0;
    let top3Matches = 0;
    let top5Matches = 0;
    let reciprocalRankSum = 0;
    let totalLatency = 0;
    const ranks: number[] = [];
    const catStats: Record<string, { matches: number; total: number }> = {};

    for (const pair of EVAL_PAIRS) {
      if (!catStats[pair.category]) {
        catStats[pair.category] = { matches: 0, total: 0 };
      }
      catStats[pair.category]!.total++;

      const t0 = performance.now();
      const queryEmbedding =
        mode !== 'text' ? await embeddingProvider.embed(pair.query) : undefined;

      const results = await store.searchSemantic(userId, {
        query: pair.query,
        queryEmbedding,
        limit: topK,
        searchMode: mode,
      });
      const t1 = performance.now();
      totalLatency += t1 - t0;

      // Find rank of expected memory in results
      let rank = 0;
      for (let r = 0; r < results.length; r++) {
        const res = results[r]!;
        // Match by exact content since InMemoryMemoryStore assigns generated UUIDs
        const expectedMem = EVAL_CORPUS.find((m) => m.id === pair.expectedMemoryId);
        if (expectedMem && res.memory.content === expectedMem.content) {
          rank = r + 1;
          break;
        }
      }

      ranks.push(rank);

      if (rank === 1) top1Matches++;
      if (rank > 0 && rank <= 3) {
        top3Matches++;
        catStats[pair.category]!.matches++;
      }
      if (rank > 0 && rank <= 5) top5Matches++;
      if (rank > 0) reciprocalRankSum += 1 / rank;
    }

    const n = EVAL_PAIRS.length;
    const categoryRecallAt3: Record<string, number> = {};
    for (const [cat, data] of Object.entries(catStats)) {
      categoryRecallAt3[cat] = Number((data.matches / data.total).toFixed(4));
    }

    return {
      metrics: {
        mode,
        totalQueries: n,
        recallAt1: Number((top1Matches / n).toFixed(4)),
        recallAt3: Number((top3Matches / n).toFixed(4)),
        recallAt5: Number((top5Matches / n).toFixed(4)),
        mrr: Number((reciprocalRankSum / n).toFixed(4)),
        avgLatencyMs: Number((totalLatency / n).toFixed(2)),
        categoryRecallAt3,
      },
      ranks,
    };
  };

  const textRun = await evaluateMode('text');
  const semanticRun = await evaluateMode('semantic');
  const hybridRun = await evaluateMode('hybrid');

  // Determine winner based on MRR, then Recall@3
  let winner: 'text' | 'semantic' | 'hybrid' = 'hybrid';
  const bestMrr = Math.max(textRun.metrics.mrr, semanticRun.metrics.mrr, hybridRun.metrics.mrr);
  if (hybridRun.metrics.mrr === bestMrr) winner = 'hybrid';
  else if (semanticRun.metrics.mrr === bestMrr) winner = 'semantic';
  else winner = 'text';

  const detailedResults = EVAL_PAIRS.map((pair, idx) => ({
    queryId: pair.id,
    query: pair.query,
    expectedMemoryId: pair.expectedMemoryId,
    category: pair.category,
    textRank: textRun.ranks[idx] ?? 0,
    semanticRank: semanticRun.ranks[idx] ?? 0,
    hybridRank: hybridRun.ranks[idx] ?? 0,
  }));

  const recommendation =
    winner === 'hybrid'
      ? `Hybrid search unggul dengan MRR ${hybridRun.metrics.mrr} dan Recall@3 ${hybridRun.metrics.recallAt3 * 100}%. Mode Hybrid direkomendasikan sebagai default karena menggabungkan ketepatan kata kunci leksikal (exact keywords) dengan pemahaman semantik parafrase.`
      : winner === 'semantic'
        ? `Pure Semantic vector search unggul dengan MRR ${semanticRun.metrics.mrr} dan Recall@3 ${semanticRun.metrics.recallAt3 * 100}%.`
        : `Pure Text search unggul dengan MRR ${textRun.metrics.mrr} dan Recall@3 ${textRun.metrics.recallAt3 * 100}%.`;

  return {
    timestamp: new Date().toISOString(),
    totalMemories: EVAL_CORPUS.length,
    totalQueries: EVAL_PAIRS.length,
    metrics: {
      text: textRun.metrics,
      semantic: semanticRun.metrics,
      hybrid: hybridRun.metrics,
    },
    winner,
    recommendation,
    detailedResults,
  };
}
