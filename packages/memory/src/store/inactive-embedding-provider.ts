import type { EmbeddingProvider } from '../types.ts';

/**
 * InactiveEmbeddingProvider is used when no live embedding model has been verified
 * and configured per architectural assessment (docs/assessment.md).
 *
 * It explicitly signals that semantic search / vector embedding generation is inactive,
 * preventing false claims of capability.
 */
export class InactiveEmbeddingProvider implements EmbeddingProvider {
  readonly isAvailable = false;
  readonly status = 'inactive' as const;
  readonly reason =
    'Semantic search is currently inactive: No embedding provider configured or verified per docs/assessment.md decisions.';

  async embed(): Promise<readonly number[]> {
    throw new Error(this.reason);
  }

  async embedBatch(): Promise<readonly (readonly number[])[]> {
    throw new Error(this.reason);
  }
}
