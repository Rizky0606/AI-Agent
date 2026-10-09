import { randomUUID } from 'node:crypto';
import type {
  MemoryCandidate,
  MemoryFilter,
  MemoryProvenance,
  MemoryRecord,
  SemanticSearchOptions,
  SemanticSearchResult,
} from '../types.ts';
import type { MemoryStore } from './memory-store.ts';

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();

  async store(candidate: MemoryCandidate, embedding?: readonly number[]): Promise<MemoryRecord> {
    const now = new Date();
    const record: MemoryRecord = {
      id: randomUUID(),
      userId: candidate.userId,
      projectId: candidate.projectId ?? null,
      type: candidate.type,
      content: candidate.content,
      scope: candidate.scope,
      provenance: candidate.provenance,
      metadata: candidate.metadata ?? {},
      retention: candidate.retention ?? 'permanent',
      embedding,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.records.set(record.id, record);
    return record;
  }

  async get(userId: string, id: string): Promise<MemoryRecord | null> {
    const item = this.records.get(id);
    if (!item) return null;
    // Strict user isolation
    if (item.userId !== userId) return null;
    if (item.deletedAt) return null;
    return item;
  }

  async list(userId: string, filter?: MemoryFilter): Promise<readonly MemoryRecord[]> {
    const results: MemoryRecord[] = [];

    for (const record of this.records.values()) {
      // 1. Strict user isolation
      if (record.userId !== userId) continue;

      // 2. Deletion filter
      if (!filter?.includeDeleted && record.deletedAt) continue;

      // 3. Project isolation: if filter.projectId specified, matches project or global user record (null)
      if (filter?.projectId !== undefined) {
        if (record.projectId !== filter.projectId && record.projectId !== null) {
          continue;
        }
      }

      // 4. Type filter
      if (filter?.type && record.type !== filter.type) continue;

      // 5. Scope filter
      if (filter?.scope && record.scope !== filter.scope) continue;

      results.push(record);
    }

    // Sort descending by creation date
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  async correct(
    userId: string,
    id: string,
    newContent: string,
    provenance: MemoryProvenance = 'user_correction',
    newEmbedding?: readonly number[],
  ): Promise<MemoryRecord> {
    const existing = await this.get(userId, id);
    if (!existing) {
      throw new Error(`Memory record '${id}' not found for user '${userId}'.`);
    }

    const updated: MemoryRecord = {
      ...existing,
      content: newContent,
      provenance,
      embedding: newEmbedding ?? existing.embedding,
      updatedAt: new Date(),
    };

    this.records.set(id, updated);
    return updated;
  }

  async delete(userId: string, id: string, hardDelete = false): Promise<boolean> {
    const existing = this.records.get(id);
    if (!existing || existing.userId !== userId) {
      return false;
    }

    if (hardDelete) {
      return this.records.delete(id);
    }

    existing.deletedAt = new Date();
    this.records.set(id, existing);
    return true;
  }

  async searchSemantic(
    userId: string,
    options: SemanticSearchOptions,
  ): Promise<readonly SemanticSearchResult[]> {
    const candidates = await this.list(userId, {
      projectId: options.projectId,
      type: options.type,
      includeDeleted: false,
    });

    const results: SemanticSearchResult[] = [];
    const threshold = options.threshold ?? 0.0;

    for (const mem of candidates) {
      let score = 0;
      if (options.queryEmbedding && mem.embedding) {
        score = cosineSimilarity(options.queryEmbedding, mem.embedding);
      } else {
        // Keyword fallback matching
        const qWords = options.query.toLowerCase().split(/\s+/).filter(Boolean);
        const memText = mem.content.toLowerCase();
        let matches = 0;
        for (const w of qWords) {
          if (memText.includes(w)) matches++;
        }
        score = qWords.length > 0 ? matches / qWords.length : 0;
      }

      if (score >= threshold) {
        results.push({ memory: mem, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = options.limit ?? 10;
    return results.slice(0, limit);
  }
}
