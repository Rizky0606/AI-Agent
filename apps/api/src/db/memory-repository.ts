import {
  InMemoryMemoryStore,
  MemoryWritePolicy,
  type MemoryCandidate,
  type MemoryFilter,
  type MemoryProvenance,
  type MemoryRecord,
  type MemoryWriteEvaluation,
  type SemanticSearchOptions,
  type SemanticSearchResult,
  type EmbeddingProvider,
} from '@personal-ai-os/memory';
import type { Database } from './client.ts';
import { auditLogs, memories, type MemoryRow } from './schema.ts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

export interface MemoryRepository {
  evaluateCandidate(candidate: MemoryCandidate): MemoryWriteEvaluation;
  createMemory(
    candidate: MemoryCandidate,
    embedding?: readonly number[],
  ): Promise<MemoryRecord | MemoryRow>;
  createProposal(candidate: MemoryCandidate): Promise<MemoryRecord | MemoryRow>;
  listProposals(
    userId: string,
    filter?: { projectId?: string | undefined } | undefined,
  ): Promise<readonly (MemoryRecord | MemoryRow)[]>;
  approveProposal(userId: string, id: string): Promise<MemoryRecord | MemoryRow>;
  rejectProposal(userId: string, id: string): Promise<boolean>;
  getMemory(userId: string, id: string): Promise<MemoryRecord | MemoryRow | null>;
  listMemories(
    userId: string,
    filter?: MemoryFilter,
  ): Promise<readonly (MemoryRecord | MemoryRow)[]>;
  correctMemory(
    userId: string,
    id: string,
    newContent: string,
    provenance?: MemoryProvenance,
    newEmbedding?: readonly number[],
  ): Promise<MemoryRecord | MemoryRow>;
  deleteMemory(userId: string, id: string): Promise<boolean>;
  searchSemantic(
    userId: string,
    options: SemanticSearchOptions,
  ): Promise<readonly SemanticSearchResult[]>;
  sweepExpiredMemories(now?: Date): Promise<{ sweptCount: number; memoryIds: string[] }>;
  backfillEmbeddings?(
    batchSize?: number,
    maxRows?: number,
  ): Promise<{ processed: number; success: number; failed: number }>;
  isSemanticSearchActive?(): boolean;
}

/**
 * Durable memory store. Production always constructs this with a real database; the in-memory
 * store is only reached when a caller explicitly passes no database (route unit tests).
 *
 * Database failures are never swallowed. An earlier version wrapped every query in `catch {}`
 * and fell back to the per-process store, which turned "the `memories` table does not exist"
 * into a silent 201 followed by total data loss on the next restart.
 */
export class DrizzleMemoryRepository implements MemoryRepository {
  private readonly db: Database;
  private readonly policy = new MemoryWritePolicy();
  private readonly fallbackStore = new InMemoryMemoryStore();
  private readonly embeddingProvider?: EmbeddingProvider | undefined;

  constructor(db: Database, embeddingProvider?: EmbeddingProvider) {
    this.db = db;
    this.embeddingProvider = embeddingProvider;
  }

  isSemanticSearchActive(): boolean {
    if (!this.embeddingProvider) return false;
    if (
      'isAvailable' in this.embeddingProvider &&
      !(this.embeddingProvider as { isAvailable: boolean }).isAvailable
    ) {
      return false;
    }
    return true;
  }

  evaluateCandidate(candidate: MemoryCandidate): MemoryWriteEvaluation {
    return this.policy.evaluate(candidate);
  }

  async createMemory(
    candidate: MemoryCandidate,
    embedding?: readonly number[],
  ): Promise<MemoryRecord | MemoryRow> {
    if (!this.db) {
      return this.fallbackStore.store(candidate, embedding);
    }

    const [inserted] = await this.db
      .insert(memories)
      .values({
        userId: candidate.userId,
        projectId: candidate.projectId ?? null,
        type: candidate.type,
        content: candidate.content,
        scope: candidate.scope,
        provenance: candidate.provenance,
        metadata: candidate.metadata ?? {},
        retention: candidate.retention ?? 'permanent',
        embedding: embedding && embedding.length > 0 ? Array.from(embedding) : undefined,
      })
      .returning();

    return inserted as MemoryRow;
  }

  async createProposal(candidate: MemoryCandidate): Promise<MemoryRecord | MemoryRow> {
    if (!this.db) {
      return this.fallbackStore.createProposal(candidate);
    }
    const metadata = {
      ...(candidate.metadata ?? {}),
      isProposal: true,
      status: 'proposed',
    };
    const row = await this.createMemory({
      ...candidate,
      metadata,
    });
    return {
      ...row,
      isProposal: true,
      status: 'proposed' as const,
    } as MemoryRecord;
  }

  async listProposals(
    userId: string,
    filter?: { projectId?: string | undefined } | undefined,
  ): Promise<readonly (MemoryRecord | MemoryRow)[]> {
    if (!this.db) {
      return this.fallbackStore.listProposals(userId, filter?.projectId);
    }
    const conditions = [
      eq(memories.userId, userId),
      isNull(memories.deletedAt),
      sql`(${memories.metadata}->>'isProposal' = 'true' OR ${memories.metadata}->>'status' = 'proposed')`,
    ];
    if (filter?.projectId) {
      conditions.push(eq(memories.projectId, filter.projectId));
    }
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.createdAt));
    return rows as MemoryRow[];
  }

  async approveProposal(userId: string, id: string): Promise<MemoryRecord | MemoryRow> {
    if (!this.db) {
      return this.fallbackStore.approveProposal(userId, id);
    }
    const [updated] = await this.db
      .update(memories)
      .set({
        metadata: sql`jsonb_set(jsonb_set(COALESCE(${memories.metadata}, '{}'::jsonb), '{isProposal}', 'false'::jsonb), '{status}', '"approved"'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(eq(memories.id, id), eq(memories.userId, userId), isNull(memories.deletedAt)))
      .returning();
    if (!updated) {
      throw new Error(`Proposal '${id}' not found for user '${userId}'.`);
    }
    return updated as MemoryRow;
  }

  async rejectProposal(userId: string, id: string): Promise<boolean> {
    if (!this.db) {
      return this.fallbackStore.rejectProposal(userId, id);
    }
    const [updated] = await this.db
      .update(memories)
      .set({
        deletedAt: new Date(),
        metadata: sql`jsonb_set(COALESCE(${memories.metadata}, '{}'::jsonb), '{status}', '"rejected"'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(eq(memories.id, id), eq(memories.userId, userId), isNull(memories.deletedAt)))
      .returning({ id: memories.id });
    return Boolean(updated);
  }

  async getMemory(userId: string, id: string): Promise<MemoryRecord | MemoryRow | null> {
    if (!this.db) {
      return this.fallbackStore.get(userId, id);
    }

    const [found] = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId), isNull(memories.deletedAt)))
      .limit(1);

    return (found as MemoryRow) ?? null;
  }

  async listMemories(
    userId: string,
    filter?: MemoryFilter,
  ): Promise<readonly (MemoryRecord | MemoryRow)[]> {
    if (!this.db) {
      return this.fallbackStore.list(userId, filter);
    }

    const conditions = [eq(memories.userId, userId)];
    if (!filter?.includeDeleted) {
      conditions.push(isNull(memories.deletedAt));
    }
    if (!filter?.includeProposals) {
      conditions.push(
        sql`(${memories.metadata}->>'isProposal' IS NULL OR ${memories.metadata}->>'isProposal' != 'true')`,
      );
    }
    if (filter?.type) {
      conditions.push(eq(memories.type, filter.type));
    }
    if (filter?.scope) {
      conditions.push(eq(memories.scope, filter.scope));
    }
    if (filter?.projectId) {
      conditions.push(eq(memories.projectId, filter.projectId));
    }

    const rows = await this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.createdAt))
      .limit(filter?.limit ?? 100);

    return rows as MemoryRow[];
  }

  async correctMemory(
    userId: string,
    id: string,
    newContent: string,
    provenance: MemoryProvenance = 'user_correction',
    newEmbedding?: readonly number[],
  ): Promise<MemoryRecord | MemoryRow> {
    if (!this.db) {
      return this.fallbackStore.correct(userId, id, newContent, provenance, newEmbedding);
    }

    const [updated] = await this.db
      .update(memories)
      .set({
        content: newContent,
        provenance,
        embedding: newEmbedding ? Array.from(newEmbedding) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning();

    if (!updated) {
      throw new Error(`Memory record '${id}' not found for user '${userId}'.`);
    }
    return updated as MemoryRow;
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    if (!this.db) {
      return this.fallbackStore.delete(userId, id);
    }

    const [updated] = await this.db
      .update(memories)
      .set({ deletedAt: new Date() })
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning({ id: memories.id });

    return Boolean(updated);
  }

  /**
   * Hybrid memory search:
   * 1. If embedding provider is verified & active, performs pgvector cosine similarity search.
   * 2. If semantic search is inactive, gracefully falls back to PostgreSQL full-text (tsvector)
   *    and keyword search with truthful non-semantic labeling.
   */
  async searchSemantic(
    userId: string,
    options: SemanticSearchOptions,
  ): Promise<readonly SemanticSearchResult[]> {
    if (!this.db) {
      return this.fallbackStore.searchSemantic(userId, options);
    }

    const q = options.query?.trim() ?? '';
    if (!q) return [];

    const baseConditions = [
      eq(memories.userId, userId),
      isNull(memories.deletedAt),
      sql`(${memories.metadata}->>'isProposal' IS NULL OR ${memories.metadata}->>'isProposal' != 'true')`,
    ];
    if (options.projectId) {
      baseConditions.push(eq(memories.projectId, options.projectId));
    }
    if (options.type) {
      baseConditions.push(eq(memories.type, options.type));
    }

    // 1. Live semantic vector search if active
    if (this.isSemanticSearchActive() && this.embeddingProvider) {
      try {
        const queryVector =
          options.queryEmbedding ?? (await this.embeddingProvider.embed(options.query));
        if (queryVector && queryVector.length > 0) {
          const vectorSql = sql.raw(`'[${queryVector.join(',')}]'::vector`);
          const similarityExpr = sql<number>`1 - (${memories.embedding} <=> ${vectorSql})`;

          const rows = await this.db
            .select({
              row: memories,
              score: similarityExpr,
            })
            .from(memories)
            .where(and(...baseConditions, sql`${memories.embedding} IS NOT NULL`))
            .orderBy(desc(similarityExpr))
            .limit(options.limit ?? 10);

          return rows.map((r) => ({
            memory: r.row as unknown as MemoryRecord,
            score: Number(Math.max(0, Math.min(1.0, r.score || 0)).toFixed(2)),
            searchMode: 'semantic' as const,
          }));
        }
      } catch {
        // Fall through to PostgreSQL full-text fallback on provider error
      }
    }

    // 2. Truthful non-semantic fallback: PostgreSQL full-text search (tsvector) + ILIKE
    const rankExpr = sql<number>`ts_rank(to_tsvector('simple', ${memories.content}), plainto_tsquery('simple', ${q}))`;
    const searchFilter = sql`(
      to_tsvector('simple', ${memories.content}) @@ plainto_tsquery('simple', ${q})
      OR ${memories.content} ILIKE ${'%' + q + '%'}
    )`;

    const textRows = await this.db
      .select({
        row: memories,
        rank: rankExpr,
      })
      .from(memories)
      .where(and(...baseConditions, searchFilter))
      .orderBy(desc(rankExpr), desc(memories.createdAt))
      .limit(options.limit ?? 10);

    return textRows.map((r) => {
      const rawScore = Number(r.rank);
      const score = Number((isNaN(rawScore) || rawScore <= 0 ? 0.5 : Math.min(1.0, rawScore + 0.1)).toFixed(2));
      return {
        memory: r.row as unknown as MemoryRecord,
        score,
        searchMode: 'text_fallback' as const,
      };
    });
  }

  async sweepExpiredMemories(
    now: Date = new Date(),
  ): Promise<{ sweptCount: number; memoryIds: string[] }> {
    if (!this.db) {
      const sweptIds = this.fallbackStore.sweep(now);
      return { sweptCount: sweptIds.length, memoryIds: sweptIds };
    }

    const expiredCondition = sql`(
      (${memories.retention} = 'ephemeral' AND ${memories.createdAt} < NOW() - INTERVAL '1 day')
      OR (${memories.retention} = 'session' AND ${memories.createdAt} < NOW() - INTERVAL '7 days')
      OR (${memories.retention} = '30d' AND ${memories.createdAt} < NOW() - INTERVAL '30 days')
      OR (${memories.retention} = '90d' AND ${memories.createdAt} < NOW() - INTERVAL '90 days')
    )`;

    const updated = await this.db
      .update(memories)
      .set({ deletedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(and(isNull(memories.deletedAt), expiredCondition))
      .returning({ id: memories.id });

    const memoryIds = updated.map((r) => r.id);
    const sweptCount = memoryIds.length;

    if (sweptCount > 0) {
      await this.db
        .insert(auditLogs)
        .values({
          action: 'memory.retention_sweep',
          resourceType: 'memory',
          resourceId: `${sweptCount} memories`,
          decision: 'expired',
          metadata: { sweptCount, memoryIds },
        })
        .catch((err) => {
          console.error('Failed to write audit log for memory sweep:', err);
        });
    }

    return { sweptCount, memoryIds };
  }

  async backfillEmbeddings(
    batchSize = 20,
    maxRows = 100,
  ): Promise<{ processed: number; success: number; failed: number }> {
    if (!this.isSemanticSearchActive() || !this.embeddingProvider || !this.db) {
      return { processed: 0, success: 0, failed: 0 };
    }

    const rows = await this.db
      .select({ id: memories.id, content: memories.content })
      .from(memories)
      .where(and(isNull(memories.embedding), isNull(memories.deletedAt)))
      .limit(Math.min(maxRows, 500));

    let success = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      try {
        const texts = batch.map((r) => r.content);
        const embeddings = await this.embeddingProvider.embedBatch(texts);
        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const emb = embeddings[j];
          if (row && emb) {
            await this.db
              .update(memories)
              .set({ embedding: Array.from(emb), updatedAt: new Date() })
              .where(eq(memories.id, row.id));
            success++;
          }
        }
      } catch {
        failed += batch.length;
      }
    }

    return { processed: rows.length, success, failed };
  }
}
