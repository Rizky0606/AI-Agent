import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '../types.ts';
import { redactSensitiveData } from '../policy/sensitive-data-filter.ts';

export interface CachedEmbeddingProviderOptions {
  /**
   * Maximum number of embedding vectors retained in the LRU-style cache.
   * Default: 5000 entries.
   */
  maxEntries?: number;
  /**
   * Automatically run sensitive data redaction before hashing and embedding.
   * Default: true.
   */
  sanitizeInput?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

/**
 * Computes a SHA-256 hash of normalized text for deterministic cache lookup.
 */
export function hashTextForEmbedding(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

/**
 * CachedEmbeddingProvider wraps any EmbeddingProvider with an in-memory hash cache.
 * It prevents redundant remote API calls for identical texts and guarantees that
 * all texts passed to the upstream provider are sanitized of sensitive tokens.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  private readonly inner: EmbeddingProvider;
  private readonly maxEntries: number;
  private readonly sanitizeInput: boolean;
  private readonly cache = new Map<string, readonly number[]>();
  private hitsCount = 0;
  private missesCount = 0;

  constructor(inner: EmbeddingProvider, options: CachedEmbeddingProviderOptions = {}) {
    this.inner = inner;
    this.maxEntries = options.maxEntries ?? 5000;
    this.sanitizeInput = options.sanitizeInput ?? true;
  }

  get isAvailable(): boolean {
    return 'isAvailable' in this.inner
      ? Boolean((this.inner as { isAvailable: boolean }).isAvailable)
      : true;
  }

  getStats(): CacheStats {
    const total = this.hitsCount + this.missesCount;
    return {
      hits: this.hitsCount,
      misses: this.missesCount,
      size: this.cache.size,
      hitRate: total > 0 ? Number((this.hitsCount / total).toFixed(4)) : 0,
    };
  }

  clearCache(): void {
    this.cache.clear();
    this.hitsCount = 0;
    this.missesCount = 0;
  }

  private sanitize(text: string): string {
    if (!this.sanitizeInput) return text;
    return redactSensitiveData(text).sanitized;
  }

  private touch(hash: string, vector: readonly number[]): void {
    // Evict oldest if reaching capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(hash)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    // Delete and re-set to mark as recently used
    this.cache.delete(hash);
    this.cache.set(hash, vector);
  }

  async embed(text: string): Promise<readonly number[]> {
    const sanitized = this.sanitize(text);
    const hash = hashTextForEmbedding(sanitized);

    const cached = this.cache.get(hash);
    if (cached) {
      this.hitsCount++;
      this.touch(hash, cached);
      return cached;
    }

    this.missesCount++;
    const vector = await this.inner.embed(sanitized);
    this.touch(hash, vector);
    return vector;
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];

    const sanitizedTexts = texts.map((t) => this.sanitize(t));
    const hashes = sanitizedTexts.map((t) => hashTextForEmbedding(t));
    const results: Array<readonly number[] | undefined> = new Array(texts.length);
    const missingIndices: number[] = [];
    const missingTexts: string[] = [];

    for (let i = 0; i < hashes.length; i++) {
      const hash = hashes[i]!;
      const cached = this.cache.get(hash);
      if (cached) {
        this.hitsCount++;
        this.touch(hash, cached);
        results[i] = cached;
      } else {
        this.missesCount++;
        missingIndices.push(i);
        missingTexts.push(sanitizedTexts[i]!);
      }
    }

    if (missingTexts.length > 0) {
      const fetched = await this.inner.embedBatch(missingTexts);
      for (let j = 0; j < missingIndices.length; j++) {
        const origIdx = missingIndices[j]!;
        const hash = hashes[origIdx]!;
        const vector = fetched[j]!;
        this.touch(hash, vector);
        results[origIdx] = vector;
      }
    }

    return results as readonly (readonly number[])[];
  }
}
