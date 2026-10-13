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
import { memories, type MemoryRow } from './schema.ts';
import { and, desc, eq, isNull } from 'drizzle-orm';

export interface MemoryRepository {
  evaluateCandidate(candidate: MemoryCandidate): MemoryWriteEvaluation;
  createMemory(
    candidate: MemoryCandidate,
    embedding?: readonly number[],
  ): Promise<MemoryRecord | MemoryRow>;
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
        embedding: embedding ? Array.from(embedding) : undefined,
      })
      .returning();

    return inserted as MemoryRow;
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
   * Vector search needs a live embedding provider. Without one there is nothing to compare
   * against, so this returns an empty result rather than scanning the fallback store.
   */
  async searchSemantic(
    userId: string,
    options: SemanticSearchOptions,
  ): Promise<readonly SemanticSearchResult[]> {
    if (!this.db) {
      return this.fallbackStore.searchSemantic(userId, options);
    }
    if (!this.isSemanticSearchActive()) {
      return [];
    }
    return this.fallbackStore.searchSemantic(userId, options);
  }
}
