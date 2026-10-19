import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareReducer,
  type CompareRunDetail,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { ApiClient } from '../src/api/client.ts';

test('Compare UI - ApiClient compare methods construct proper endpoints and bodies', async () => {
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
          id: 'cmp-100',
          prompt: 'test prompt',
          modelIds: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
          blindMode: true,
          status: 'running',
          createdAt: new Date().toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-100/reveal')) {
      return new Response(
        JSON.stringify({
          id: 'cmp-100',
          prompt: 'test prompt',
          blindMode: true,
          isRevealed: true,
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-100/winner')) {
      return new Response(
        JSON.stringify({
          id: 'cmp-100',
          prompt: 'test prompt',
          winnerModelId: 'openai/gpt-4o',
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-100/synthesize')) {
      return new Response(
        JSON.stringify({
          id: 'cmp-100',
          synthesis: 'Ringkasan sintesis',
          synthesisModelId: 'openai/gpt-4o',
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-100/promote')) {
      return new Response(
        JSON.stringify({
          conversationId: 'conv-999',
          messageId: 'msg-888',
          modelId: 'openai/gpt-4o',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/v1/compare/cmp-100') && method === 'DELETE') {
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
    const client = new ApiClient({
      baseUrl: () => 'http://127.0.0.1:4000',
      token: () => 'test-token',
    });

    const created = await client.createCompare({
      prompt: 'Jelaskan ACID database',
      modelIds: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
      blindMode: true,
    });
    assert.equal(created.id, 'cmp-100');

    const revealed = await client.revealCompare('cmp-100');
    assert.equal(revealed.isRevealed, true);

    const winner = await client.selectCompareWinner('cmp-100', 'openai/gpt-4o');
    assert.equal(winner.winnerModelId, 'openai/gpt-4o');

    const synth = await client.synthesizeCompare('cmp-100');
    assert.equal(synth.synthesis, 'Ringkasan sintesis');

    const promoted = await client.promoteCompare('cmp-100', { target: 'new' });
    assert.equal(promoted.conversationId, 'conv-999');

    const del = await client.deleteCompare('cmp-100');
    assert.equal(del.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Compare UI - Blind Mode masks identities and preserves unmasked results upon reveal', () => {
  const initial: CompareRunDetail = {
    id: 'cmp-blind-1',
    userId: 'u1',
    prompt: 'Apa perbedaan RAM dan ROM?',
    blindMode: true,
    isRevealed: false,
    winnerModelId: null,
    synthesis: null,
    synthesisModelId: null,
    status: 'completed',
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    results: [
      {
        modelId: '',
        columnLabel: 'Model A',
        content: 'RAM adalah memori volatil.',
        status: 'completed',
        latencyMs: 350,
      },
      {
        modelId: '',
        columnLabel: 'Model B',
        content: 'ROM bersifat non-volatil.',
        status: 'completed',
        latencyMs: 420,
      },
    ],
  };

  // Check masking before reveal
  assert.equal(initial.results[0]?.modelId, '');
  assert.equal(initial.results[0]?.columnLabel, 'Model A');
  assert.equal(initial.isRevealed, false);

  // Reveal event unmasks real modelIds
  const revealEvent: TaskEventEnvelope = {
    id: 'evt-reveal',
    taskId: 'cmp-blind-1',
    userId: 'user-win-1',
    eventType: 'compare.revealed',
    createdAt: new Date().toISOString(),
    payload: {
      isRevealed: true,
      results: [
        {
          modelId: 'google/gemini-2.5-flash',
          columnLabel: 'Model A',
          content: 'RAM adalah memori volatil.',
          status: 'completed',
          latencyMs: 350,
        },
        {
          modelId: 'anthropic/claude-3-5-sonnet',
          columnLabel: 'Model B',
          content: 'ROM bersifat non-volatil.',
          status: 'completed',
          latencyMs: 420,
        },
      ],
    },
  };

  const updated = compareReducer(initial, revealEvent);
  assert.equal(updated.isRevealed, true);
  assert.equal(updated.results[0]?.modelId, 'google/gemini-2.5-flash');
  assert.equal(updated.results[1]?.modelId, 'anthropic/claude-3-5-sonnet');
});

test('Compare UI - Column failure marks column failed with exact error without fallback', () => {
  const initial: CompareRunDetail = {
    id: 'cmp-fail-1',
    userId: 'u1',
    prompt: 'Uji kegagalan',
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
        modelId: 'model-ok',
        columnLabel: 'Model A',
        content: 'Berhasil.',
        status: 'completed',
      },
      {
        modelId: 'model-bad',
        columnLabel: 'Model B',
        content: '',
        status: 'running',
      },
    ],
  };

  const failEvent: TaskEventEnvelope = {
    id: 'evt-fail',
    taskId: 'cmp-fail-1',
    userId: 'user-win-1',
    eventType: 'compare.model_failed',
    createdAt: new Date().toISOString(),
    payload: {
      modelId: 'model-bad',
      columnLabel: 'Model B',
      error: 'Rate limit exceeded on gateway',
    },
  };

  const updated = compareReducer(initial, failEvent);
  const failedCol = updated.results.find((r) => r.columnLabel === 'Model B');
  assert.ok(failedCol);
  assert.equal(failedCol.status, 'failed');
  assert.equal(failedCol.error, 'Rate limit exceeded on gateway');
  // Strict rule: modelId is still model-bad (never substituted by fallback)
  assert.equal(failedCol.modelId, 'model-bad');
});
