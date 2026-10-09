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
}

export class DrizzleMemoryRepository implements MemoryRepository {
  private readonly db: Database;
  private readonly policy = new MemoryWritePolicy();
  private readonly fallbackStore = new InMemoryMemoryStore();

  constructor(db: Database) {
    this.db = db;
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

    try {
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
    } catch {
      return this.fallbackStore.store(candidate, embedding);
    }
  }

  async getMemory(userId: string, id: string): Promise<MemoryRecord | MemoryRow | null> {
    if (!this.db) {
      return this.fallbackStore.get(userId, id);
    }

    try {
      const [found] = await this.db
        .select()
        .from(memories)
        .where(and(eq(memories.id, id), eq(memories.userId, userId), isNull(memories.deletedAt)))
        .limit(1);

      return (found as MemoryRow) ?? null;
    } catch {
      return this.fallbackStore.get(userId, id);
    }
  }

  async listMemories(
    userId: string,
    filter?: MemoryFilter,
  ): Promise<readonly (MemoryRecord | MemoryRow)[]> {
    if (!this.db) {
      return this.fallbackStore.list(userId, filter);
    }

    try {
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
    } catch {
      return this.fallbackStore.list(userId, filter);
    }
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

    try {
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
    } catch {
      return this.fallbackStore.correct(userId, id, newContent, provenance, newEmbedding);
    }
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    if (!this.db) {
      return this.fallbackStore.delete(userId, id);
    }

    try {
      const [updated] = await this.db
        .update(memories)
        .set({ deletedAt: new Date() })
        .where(and(eq(memories.id, id), eq(memories.userId, userId)))
        .returning({ id: memories.id });

      return Boolean(updated);
    } catch {
      return this.fallbackStore.delete(userId, id);
    }
  }

  async searchSemantic(
    userId: string,
    options: SemanticSearchOptions,
  ): Promise<readonly SemanticSearchResult[]> {
    // Uses fallback store for semantic cosine similarity retrieval
    return this.fallbackStore.searchSemantic(userId, options);
  }
}
