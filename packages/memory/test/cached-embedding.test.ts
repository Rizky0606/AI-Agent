import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CachedEmbeddingProvider,
  hashTextForEmbedding,
} from '../src/store/cached-embedding-provider.ts';
import { GatewayEmbeddingAdapter } from '../src/store/gateway-embedding-adapter.ts';
import type { EmbeddingProvider } from '../src/types.ts';

class CountingMockEmbeddingProvider implements EmbeddingProvider {
  readonly isAvailable = true;
  callCount = 0;
  batchCallCount = 0;
  totalTextsEmbedded = 0;
  lastTextsReceived: string[] = [];

  async embed(text: string): Promise<readonly number[]> {
    this.callCount++;
    this.totalTextsEmbedded++;
    this.lastTextsReceived = [text];
    // Return deterministic mock vector of length 4 based on text length
    return [text.length, text.charCodeAt(0) || 0, 0.5, 0.99];
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.batchCallCount++;
    this.totalTextsEmbedded += texts.length;
    this.lastTextsReceived = [...texts];
    return texts.map((t) => [t.length, t.charCodeAt(0) || 0, 0.5, 0.99]);
  }
}

test('hashTextForEmbedding produces consistent SHA-256 hex string', () => {
  const h1 = hashTextForEmbedding('hello world');
  const h2 = hashTextForEmbedding('  hello world  ');
  const h3 = hashTextForEmbedding('hello world 2');

  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 64);
});

test('CachedEmbeddingProvider caches single embed calls by hash', async () => {
  const mock = new CountingMockEmbeddingProvider();
  const cached = new CachedEmbeddingProvider(mock, { maxEntries: 10 });

  // First call -> miss
  const v1 = await cached.embed('preferensi tema gelap');
  assert.equal(mock.callCount, 1);
  assert.deepEqual(v1, [21, 'p'.charCodeAt(0), 0.5, 0.99]);

  // Second call with identical text -> hit
  const v2 = await cached.embed('preferensi tema gelap');
  assert.equal(mock.callCount, 1); // No new call!
  assert.deepEqual(v2, v1);

  // Third call with whitespace padded -> hit
  const v3 = await cached.embed('  preferensi tema gelap  ');
  assert.equal(mock.callCount, 1);
  assert.deepEqual(v3, v1);

  const stats = cached.getStats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 1);
  assert.equal(stats.size, 1);
  assert.equal(stats.hitRate, 0.6667);
});

test('CachedEmbeddingProvider embedBatch only calls provider for uncached texts', async () => {
  const mock = new CountingMockEmbeddingProvider();
  const cached = new CachedEmbeddingProvider(mock, { maxEntries: 20 });

  // Pre-cache item 1
  await cached.embed('item satu');
  assert.equal(mock.totalTextsEmbedded, 1);

  // Batch query with 3 items: item satu (cached), item dua (new), item tiga (new)
  const batchRes = await cached.embedBatch(['item satu', 'item dua', 'item tiga']);

  assert.equal(batchRes.length, 3);
  // Provider should only have been called for item dua and item tiga (2 items)
  assert.equal(mock.batchCallCount, 1);
  assert.deepEqual(mock.lastTextsReceived, ['item dua', 'item tiga']);
  assert.equal(mock.totalTextsEmbedded, 3);

  // Calling all 3 again should result in 100% cache hit
  const batchRes2 = await cached.embedBatch(['item satu', 'item dua', 'item tiga']);
  assert.deepEqual(batchRes2, batchRes);
  assert.equal(mock.batchCallCount, 1); // No new batch calls!

  const stats = cached.getStats();
  assert.equal(stats.hits, 4); // 1 in batch1, 3 in batch2
  assert.equal(stats.misses, 3); // 1 pre-cache, 2 in batch1
});

test('CachedEmbeddingProvider evicts oldest entries when capacity exceeded', async () => {
  const mock = new CountingMockEmbeddingProvider();
  const cached = new CachedEmbeddingProvider(mock, { maxEntries: 2 });

  await cached.embed('A');
  await cached.embed('B');
  assert.equal(cached.getStats().size, 2);

  // Insert C -> evicts oldest (A)
  await cached.embed('C');
  assert.equal(cached.getStats().size, 2);

  // B is still cached
  await cached.embed('B');
  assert.equal(mock.totalTextsEmbedded, 3); // no new call for B

  // A was evicted, so querying A calls mock again
  await cached.embed('A');
  assert.equal(mock.totalTextsEmbedded, 4); // new call for A
});

test('CachedEmbeddingProvider sanitizes sensitive tokens before hashing and sending', async () => {
  const mock = new CountingMockEmbeddingProvider();
  const cached = new CachedEmbeddingProvider(mock, { sanitizeInput: true });

  const rawTextWithKey = 'Simpan kunci api sk-1234567890abcdef123456 untuk integrasi';
  await cached.embed(rawTextWithKey);

  // Inner mock must NOT have received the raw API key!
  assert.ok(mock.lastTextsReceived[0]);
  assert.doesNotMatch(mock.lastTextsReceived[0], /sk-1234567890abcdef123456/);
  assert.match(mock.lastTextsReceived[0], /\[REDACTED_API_KEY\]/);
});

test('GatewayEmbeddingAdapter bridges gateway embed signature to memory interface', async () => {
  const gatewaySource = {
    isAvailable: true,
    async embed(texts: readonly string[]) {
      return texts.map((t) => [t.length, 1.23]);
    },
    getDimensions() {
      return 1536;
    },
  };

  const adapter = new GatewayEmbeddingAdapter(gatewaySource);
  assert.equal(adapter.isAvailable, true);
  assert.equal(adapter.getDimensions(), 1536);

  const single = await adapter.embed('halo');
  assert.deepEqual(single, [4, 1.23]);

  const batch = await adapter.embedBatch(['a', 'bc']);
  assert.deepEqual(batch, [
    [1, 1.23],
    [2, 1.23],
  ]);
});
