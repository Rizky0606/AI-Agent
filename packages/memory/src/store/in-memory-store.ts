import { randomUUID } from 'node:crypto';
import type {
  MemoryCandidate,
  MemoryFilter,
  MemoryProvenance,
  MemoryRecord,
  MemoryStatus,
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
      isProposal: candidate.metadata?.['isProposal'] === true,
      status: (candidate.metadata?.['status'] as MemoryStatus | undefined) ?? (candidate.metadata?.['isProposal'] === true ? 'proposed' : undefined),
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

      // 6. Proposal filter: by default omit proposed items unless includeProposals is true
      if (
        !filter?.includeProposals &&
        (record.metadata['isProposal'] === true || record.metadata['status'] === 'proposed')
      ) {
        continue;
      }

      results.push(record);
    }

    // Sort descending by creation date
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  async listProposals(userId: string, projectId?: string | null | undefined): Promise<readonly MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const record of this.records.values()) {
      if (record.userId !== userId) continue;
      if (record.deletedAt) continue;
      if (projectId !== undefined && record.projectId !== projectId && record.projectId !== null) {
        continue;
      }
      if (record.metadata['isProposal'] === true || record.metadata['status'] === 'proposed') {
        results.push(record);
      }
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results;
  }

  async createProposal(candidate: MemoryCandidate): Promise<MemoryRecord> {
    return this.store({
      ...candidate,
      metadata: {
        ...(candidate.metadata ?? {}),
        isProposal: true,
        status: 'proposed',
      },
    });
  }

  async approveProposal(userId: string, id: string): Promise<MemoryRecord> {
    const existing = this.records.get(id);
    if (!existing || existing.userId !== userId) {
      throw new Error(`Proposal '${id}' not found for user '${userId}'.`);
    }
    const updated: MemoryRecord = {
      ...existing,
      isProposal: false,
      status: 'approved',
      metadata: {
        ...existing.metadata,
        isProposal: false,
        status: 'approved',
      },
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    return updated;
  }

  async rejectProposal(userId: string, id: string): Promise<boolean> {
    const existing = this.records.get(id);
    if (!existing || existing.userId !== userId) return false;
    existing.deletedAt = new Date();
    existing.isProposal = false;
    existing.status = 'rejected';
    existing.metadata = {
      ...existing.metadata,
      status: 'rejected',
    };
    this.records.set(id, existing);
    return true;
  }

  sweep(now: Date = new Date()): string[] {
    const sweptIds: string[] = [];
    for (const record of this.records.values()) {
      if (record.deletedAt) continue;
      const ageMs = now.getTime() - record.createdAt.getTime();
      let expired = false;
      if (record.retention === 'ephemeral' && ageMs >= 3_600_000) expired = true;
      else if (record.retention === 'session' && ageMs >= 86_400_000) expired = true;
      else if (record.retention === '30d' && ageMs >= 30 * 86_400_000) expired = true;
      else if (record.retention === '90d' && ageMs >= 90 * 86_400_000) expired = true;

      if (expired) {
        record.deletedAt = now;
        sweptIds.push(record.id);
      }
    }
    return sweptIds;
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

    const mode = options.searchMode ?? (options.queryEmbedding ? 'hybrid' : 'text_fallback');

    for (const mem of candidates) {
      // 1. Text keyword score
      const qWords = options.query.toLowerCase().split(/\s+/).filter(Boolean);
      const memText = mem.content.toLowerCase();
      let matches = 0;
      for (const w of qWords) {
        if (memText.includes(w)) matches++;
      }
      const textScore = qWords.length > 0 ? matches / qWords.length : 0;

      // 2. Vector cosine score
      const vectorScore =
        options.queryEmbedding && mem.embedding
          ? Math.max(0, cosineSimilarity(options.queryEmbedding, mem.embedding))
          : 0;

      let score = 0;
      let effectiveMode: 'semantic' | 'text' | 'hybrid' | 'text_fallback' = 'text_fallback';

      if (mode === 'text') {
        score = textScore;
        effectiveMode = 'text';
      } else if (mode === 'semantic') {
        score = options.queryEmbedding && mem.embedding ? vectorScore : textScore;
        effectiveMode = options.queryEmbedding && mem.embedding ? 'semantic' : 'text_fallback';
      } else if (mode === 'hybrid') {
        if (options.queryEmbedding && mem.embedding) {
          score = Number(((vectorScore * 0.65) + (textScore * 0.35)).toFixed(4));
          effectiveMode = 'hybrid';
        } else {
          score = textScore;
          effectiveMode = 'text_fallback';
        }
      } else {
        score = options.queryEmbedding && mem.embedding ? vectorScore : textScore;
        effectiveMode = options.queryEmbedding && mem.embedding ? 'semantic' : 'text_fallback';
      }

      if (score >= threshold) {
        results.push({
          memory: mem,
          score,
          searchMode: effectiveMode,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = options.limit ?? 10;
    return results.slice(0, limit);
  }
}
