import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelGatewayError,
  NineRouterGateway,
  MockModelGateway,
  MockEmbeddingProvider,
  NineRouterEmbeddingProvider,
  sanitizeMessage,
} from '../src/index.ts';

test('sanitizeMessage redacts secret from text', () => {
  const secret = 'super-secret-key-12345';
  const text = `Failed request with Bearer ${secret} in payload`;
  const sanitized = sanitizeMessage(text, secret);
  assert.equal(sanitized.includes(secret), false);
  assert.equal(sanitized.includes('[REDACTED]'), true);
});

test('MockModelGateway returns chat response and streams chunks', async () => {
  const gateway = new MockModelGateway({
    chatResponse: 'Hello from mock',
    streamChunks: ['Chunk 1 ', 'Chunk 2'],
    streamDelayMs: 5,
  });

  const chatRes = await gateway.chat({
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hi' }],
  });
  assert.equal(chatRes.content, 'Hello from mock');
  assert.equal(chatRes.usage?.totalTokens, 30);

  const chunks: string[] = [];
  for await (const chunk of gateway.stream({
    model: 'test-model',
    messages: [{ role: 'user', content: 'Stream test' }],
  })) {
    if (chunk.delta) chunks.push(chunk.delta);
  }
  assert.deepEqual(chunks, ['Chunk 1 ', 'Chunk 2']);
});

test('MockModelGateway stream cancellation terminates cleanly', async () => {
  const gateway = new MockModelGateway({
    streamChunks: ['Part 1', 'Part 2', 'Part 3', 'Part 4'],
    streamDelayMs: 50,
  });

  const controller = new AbortController();
  const stream = gateway.stream({
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hi' }],
    signal: controller.signal,
  });

  const received: string[] = [];
  await assert.rejects(
    async () => {
      for await (const chunk of stream) {
        received.push(chunk.delta);
        if (received.length === 1) {
          controller.abort();
        }
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof ModelGatewayError);
      assert.equal(err.code, 'STREAM_ABORTED');
      return true;
    },
  );

  assert.equal(received.length, 1);
});

test('NineRouterGateway chat succeeds with mock fetch', async () => {
  const fakeResponse = {
    id: 'chatcmpl-test',
    model: 'openai/gpt-4o',
    choices: [{ message: { content: 'Hasil analisis selesai.' } }],
    usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
  };

  const customFetch: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://9router.ojixx.my.id/v1/chat/completions');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer valid-secret-key');
    return new Response(JSON.stringify(fakeResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const gateway = new NineRouterGateway({
    apiKey: 'valid-secret-key',
    fetchFn: customFetch,
  });

  const res = await gateway.chat({
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'Analisis' }],
  });

  assert.equal(res.id, 'chatcmpl-test');
  assert.equal(res.content, 'Hasil analisis selesai.');
  assert.equal(res.usage?.totalTokens, 40);
});

test('NineRouterGateway normalizes 401 error and redacts key', async () => {
  const secret = 'leaked-test-key-999';
  const customFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: `Invalid key ${secret}` } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

  const gateway = new NineRouterGateway({
    apiKey: secret,
    fetchFn: customFetch,
    maxRetries: 0,
  });

  await assert.rejects(
    () =>
      gateway.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
      }),
    (err: unknown) => {
      assert.ok(err instanceof ModelGatewayError);
      assert.equal(err.code, 'AUTHENTICATION_ERROR');
      assert.equal(err.retryable, false);
      assert.equal(err.message.includes(secret), false);
      assert.equal(err.message.includes('[REDACTED]'), true);
      return true;
    },
  );
});

test('NineRouterGateway retries on 429 rate limit then succeeds', async () => {
  let attempts = 0;
  const customFetch: typeof fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        id: 'success-id',
        choices: [{ message: { content: 'Berhasil setelah retry' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const gateway = new NineRouterGateway({
    apiKey: 'test-key',
    fetchFn: customFetch,
    maxRetries: 2,
    initialBackoffMs: 10,
    maxBackoffMs: 50,
  });

  const res = await gateway.chat({
    model: 'test-model',
    messages: [{ role: 'user', content: 'Test' }],
  });

  assert.equal(attempts, 2);
  assert.equal(res.content, 'Berhasil setelah retry');
});

test('NineRouterGateway streams SSE chunks correctly', async () => {
  const sseBody = [
    'data: {"choices":[{"delta":{"content":"Halo"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" dunia"}}]}\n\n',
    'data: [DONE]\n\n',
  ].join('');

  const customFetch: typeof fetch = async () =>
    new Response(sseBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

  const gateway = new NineRouterGateway({
    apiKey: 'test-key',
    fetchFn: customFetch,
  });

  const chunks: string[] = [];
  for await (const chunk of gateway.stream({
    model: 'test-model',
    messages: [{ role: 'user', content: 'Sapa' }],
  })) {
    if (chunk.delta) chunks.push(chunk.delta);
  }

  assert.deepEqual(chunks, ['Halo', ' dunia']);
});

test('MockEmbeddingProvider generates normalized vectors deterministically', async () => {
  const provider = new MockEmbeddingProvider({ dimensions: 1536 });
  assert.equal(provider.getDimensions(), 1536);

  const vectors = await provider.embed([
    'typescript coding',
    'typescript coding',
    'python machine learning',
  ]);
  assert.equal(vectors.length, 3);
  assert.equal(vectors[0]?.length, 1536);

  // Exact same text must yield identical vectors
  assert.deepEqual(vectors[0], vectors[1]);

  // Different text must differ
  assert.notDeepEqual(vectors[0], vectors[2]);
});

test('NineRouterEmbeddingProvider calls /embeddings endpoint and handles retry', async () => {
  let callCount = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    callCount++;
    const url = String(input);
    assert.match(url, /\/embeddings$/);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer secret-key-xyz');

    if (callCount === 1) {
      return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const provider = new NineRouterEmbeddingProvider({
    apiKey: 'secret-key-xyz',
    dimensions: 3,
    initialBackoffMs: 10,
    maxRetries: 2,
    fetchFn: mockFetch,
  });

  const res = await provider.embed(['pertama', 'kedua']);
  assert.equal(res.length, 2);
  assert.deepEqual(res[0], [0.1, 0.2, 0.3]);
  assert.deepEqual(res[1], [0.4, 0.5, 0.6]);
  assert.equal(callCount, 2);
});
