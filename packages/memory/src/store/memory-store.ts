import type {
  MemoryCandidate,
  MemoryFilter,
  MemoryProvenance,
  MemoryRecord,
  SemanticSearchOptions,
  SemanticSearchResult,
} from '../types.ts';

export interface MemoryStore {
  store(candidate: MemoryCandidate, embedding?: readonly number[]): Promise<MemoryRecord>;
  get(userId: string, id: string): Promise<MemoryRecord | null>;
  list(userId: string, filter?: MemoryFilter): Promise<readonly MemoryRecord[]>;
  correct(
    userId: string,
    id: string,
    newContent: string,
    provenance?: MemoryProvenance,
    newEmbedding?: readonly number[],
  ): Promise<MemoryRecord>;
  delete(userId: string, id: string, hardDelete?: boolean): Promise<boolean>;
  searchSemantic(
    userId: string,
    options: SemanticSearchOptions,
  ): Promise<readonly SemanticSearchResult[]>;
}
