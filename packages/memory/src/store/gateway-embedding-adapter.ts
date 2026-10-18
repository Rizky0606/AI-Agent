import type { EmbeddingProvider as MemoryEmbeddingProvider } from '../types.ts';

/**
 * Interface representing model-gateway's embedding provider signature.
 */
export interface GatewayEmbeddingSource {
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>;
  getDimensions?(): number;
  isAvailable?: boolean;
}

/**
 * GatewayEmbeddingAdapter bridges between @personal-ai-os/model-gateway's
 * array-based EmbeddingProvider and @personal-ai-os/memory's EmbeddingProvider.
 */
export class GatewayEmbeddingAdapter implements MemoryEmbeddingProvider {
  private readonly gateway: GatewayEmbeddingSource;
  readonly isAvailable: boolean;

  constructor(gateway: GatewayEmbeddingSource) {
    this.gateway = gateway;
    this.isAvailable = gateway.isAvailable !== false;
  }

  getDimensions(): number {
    return this.gateway.getDimensions?.() ?? 1536;
  }

  async embed(text: string): Promise<readonly number[]> {
    const results = await this.gateway.embed([text]);
    if (!results || results.length === 0 || !results[0]) {
      throw new Error('Gateway returned empty embedding result');
    }
    return results[0];
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    return this.gateway.embed(texts);
  }
}
