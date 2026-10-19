import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareReducer,
  type CompareRunDetail,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { ApiClient } from '../src/api/client.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';

test('Android Compare - ApiClient compare endpoints send correct contracts', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body });

    if (url.endsWith('/v1/compare') && method === 'POST') {
      return new Response(
        JSON.stringify({
          id: 'cmp-android-1',
          prompt: 'Uji respons model',
          modelIds: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
          blindMode: true,
          status: 'running',
          createdAt: new Date().toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-android-1/reveal')) {
      return new Response(
        JSON.stringify({
          id: 'cmp-android-1',
          isRevealed: true,
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-android-1/winner')) {
      return new Response(
        JSON.stringify({
          id: 'cmp-android-1',
          winnerModelId: 'openai/gpt-4o',
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-android-1/synthesize')) {
      return new Response(
        JSON.stringify({
          id: 'cmp-android-1',
          synthesis: 'Perbandingan menunjukkan Model A lebih cepat.',
          synthesisModelId: 'openai/gpt-4o',
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-android-1/promote')) {
      return new Response(
        JSON.stringify({
          conversationId: 'conv-new-1',
          messageId: 'msg-new-1',
          modelId: 'openai/gpt-4o',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-android-1') && method === 'DELETE') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const storage = new InMemoryTokenStorage();
    await storage.setAccessToken('test-jwt-token');
    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:4000',
      storage,
    });

    const run = await client.createCompare({
      prompt: 'Jelaskan mekanisme concurrency di Node.js',
      modelIds: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
      blindMode: true,
    });
    assert.equal(run.id, 'cmp-android-1');

    const revealed = await client.revealCompare('cmp-android-1');
    assert.equal(revealed.isRevealed, true);

    const winner = await client.selectCompareWinner('cmp-android-1', 'openai/gpt-4o');
    assert.equal(winner.winnerModelId, 'openai/gpt-4o');

    const synth = await client.synthesizeCompare('cmp-android-1');
    assert.equal(synth.synthesis, 'Perbandingan menunjukkan Model A lebih cepat.');

    const promoted = await client.promoteCompare('cmp-android-1', { target: 'new' });
    assert.equal(promoted.conversationId, 'conv-new-1');

    const del = await client.deleteCompare('cmp-android-1');
    assert.equal(del.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Android Compare - Streaming events update column content and status incrementally', () => {
  const initial: CompareRunDetail = {
    id: 'cmp-stream-1',
    userId: 'user-1',
    prompt: 'Apa itu event loop?',
    blindMode: true,
    isRevealed: false,
    winnerModelId: null,
    synthesis: null,
    synthesisModelId: null,
    status: 'running',
    createdAt: new Date().toISOString(),
    completedAt: null,
    results: [
      {
        modelId: '',
        columnLabel: 'Model A',
        content: '',
        status: 'pending',
      },
      {
        modelId: '',
        columnLabel: 'Model B',
        content: '',
        status: 'pending',
      },
    ],
  };

  const chunk1: TaskEventEnvelope = {
    id: 'e1',
    taskId: 'cmp-stream-1',
    userId: 'user-android-1',
    eventType: 'compare.chunk',
    createdAt: new Date().toISOString(),
    payload: {
      columnIndex: 0,
      columnLabel: 'Model A',
      delta: 'Event loop adalah ',
    },
  };

  const state1 = compareReducer(initial, chunk1);
  assert.equal(state1.results[0]?.content, 'Event loop adalah ');
  assert.equal(state1.results[0]?.status, 'streaming');
  assert.equal(state1.results[1]?.content, '');

  const chunk2: TaskEventEnvelope = {
    id: 'e2',
    taskId: 'cmp-stream-1',
    userId: 'user-android-1',
    eventType: 'compare.chunk',
    createdAt: new Date().toISOString(),
    payload: {
      columnIndex: 0,
      columnLabel: 'Model A',
      delta: 'mekanisme single-threaded.',
    },
  };

  const state2 = compareReducer(state1, chunk2);
  assert.equal(state2.results[0]?.content, 'Event loop adalah mekanisme single-threaded.');

  const completedEvt: TaskEventEnvelope = {
    id: 'e3',
    taskId: 'cmp-stream-1',
    userId: 'user-android-1',
    eventType: 'compare.model_completed',
    createdAt: new Date().toISOString(),
    payload: {
      columnIndex: 0,
      columnLabel: 'Model A',
      latencyMs: 280,
      promptTokens: 12,
      completionTokens: 25,
      totalTokens: 37,
      cost: 0.00015,
      estimatedCostUsd: 0.00015,
    },
  };

  const state3 = compareReducer(state2, completedEvt);
  assert.equal(state3.results[0]?.status, 'completed');
  assert.equal(state3.results[0]?.latencyMs, 280);
  assert.equal(state3.results[0]?.totalTokens, 37);
  assert.equal(state3.results[0]?.estimatedCostUsd, 0.00015);
  // Status is still running because Model B has not finished
  assert.equal(state3.status, 'running');
});

test('Android Compare - Failure in one model is isolated without fallback substitution', () => {
  const initial: CompareRunDetail = {
    id: 'cmp-err-1',
    userId: 'user-1',
    prompt: 'Uji kegagalan model',
    blindMode: false,
    isRevealed: true,
    winnerModelId: null,
    synthesis: null,
    synthesisModelId: null,
    status: 'running',
    createdAt: new Date().toISOString(),
    completedAt: null,
    results: [
      {
        modelId: 'openai/gpt-4o',
        columnLabel: 'Model A',
        content: 'Berhasil menjawab.',
        status: 'completed',
        latencyMs: 310,
      },
      {
        modelId: 'broken/model',
        columnLabel: 'Model B',
        content: '',
        status: 'running',
      },
    ],
  };

  const failEvent: TaskEventEnvelope = {
    id: 'e-fail',
    taskId: 'cmp-err-1',
    userId: 'user-android-1',
    eventType: 'compare.model_failed',
    createdAt: new Date().toISOString(),
    payload: {
      modelId: 'broken/model',
      columnLabel: 'Model B',
      error: 'Upstream provider connection timeout',
    },
  };

  const state = compareReducer(initial, failEvent);
  const failedResult = state.results.find((r) => r.columnLabel === 'Model B');
  assert.ok(failedResult);
  assert.equal(failedResult.status, 'failed');
  assert.equal(failedResult.error, 'Upstream provider connection timeout');
  // Strict rule: modelId is NOT substituted by fallback
  assert.equal(failedResult.modelId, 'broken/model');
  // All finished: run becomes completed
  assert.equal(state.status, 'completed');
});
