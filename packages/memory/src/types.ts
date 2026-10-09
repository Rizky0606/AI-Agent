export type MemoryType =
  'session' | 'long-term' | 'project' | 'task' | 'preference' | 'knowledge' | 'decision';

export type MemoryRetention = 'ephemeral' | 'session' | '30d' | '90d' | 'permanent';

export type MemoryProvenance =
  'user_explicit' | 'task_result' | 'conversation_extraction' | 'system' | 'user_correction';

export interface MemoryRecord {
  id: string;
  userId: string;
  projectId?: string | null | undefined;
  type: MemoryType;
  content: string;
  scope: string;
  provenance: MemoryProvenance;
  metadata: Record<string, unknown>;
  retention: MemoryRetention;
  embedding?: readonly number[] | null | undefined;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null | undefined;
}

export interface MemoryCandidate {
  userId: string;
  projectId?: string | null | undefined;
  type: MemoryType;
  content: string;
  scope: string;
  provenance: MemoryProvenance;
  metadata?: Record<string, unknown> | undefined;
  retention?: MemoryRetention | undefined;
}

export interface MemoryWriteEvaluation {
  shouldStore: boolean;
  reason: string;
  candidateType: MemoryType;
  sanitizedContent: string;
  confidence: number;
  sensitiveDataDetected: boolean;
  redactedCategories: readonly string[];
}

export interface MemoryFilter {
  projectId?: string | null | undefined;
  type?: MemoryType | undefined;
  scope?: string | undefined;
  includeDeleted?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SemanticSearchOptions {
  query: string;
  queryEmbedding?: readonly number[] | undefined;
  projectId?: string | null | undefined;
  type?: MemoryType | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
}

export interface SemanticSearchResult {
  memory: MemoryRecord;
  score: number;
}
