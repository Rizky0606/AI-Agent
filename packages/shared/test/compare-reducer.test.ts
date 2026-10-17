import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReducer } from '../src/compare/compare-reducer.ts';
import type { CompareRunData } from '../src/compare/types.ts';

const createMockRun = (overrides?: Partial<CompareRunData>): CompareRunData => ({
  id: 'run-123',
  userId: 'user-abc',
  projectId: 'proj-xyz',
  prompt: 'Bandingkan arsitektur microservices vs monolith',
  blindMode: true,
  revealed: false,
  status: 'running',
  tokenBudget: 4000,
  totalTokensUsed: 0,
  results: [
    {
      id: 'res-1',
      columnIndex: 0,
      modelAlias: 'Model A',
      content: '',
      status: 'pending',
      isWinner: false,
    },
    {
      id: 'res-2',
      columnIndex: 1,
      modelAlias: 'Model B',
      content: '',
      status: 'pending',
      isWinner: false,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

test('compareReducer handles SET_RUN', () => {
  const run = createMockRun();
  const next = compareReducer(null, { type: 'SET_RUN', payload: run });
  assert.deepEqual(next, run);
});

test('compareReducer handles STREAM_CHUNK per column without cross-contamination', () => {
  const initial = createMockRun();
  let state = compareReducer(initial, {
    type: 'STREAM_CHUNK',
    payload: { columnIndex: 0, delta: 'Halo dari ' },
  });
  state = compareReducer(state, {
    type: 'STREAM_CHUNK',
    payload: { columnIndex: 0, delta: 'Model A.' },
  });
  state = compareReducer(state, {
    type: 'STREAM_CHUNK',
    payload: { columnIndex: 1, delta: 'Salam dari Model B.' },
  });

  assert.equal(state?.results[0].content, 'Halo dari Model A.');
  assert.equal(state?.results[0].status, 'streaming');
  assert.equal(state?.results[1].content, 'Salam dari Model B.');
  assert.equal(state?.results[1].status, 'streaming');
});

test('compareReducer handles MODEL_COMPLETED and aggregates token usage', () => {
  const initial = createMockRun();
  let state = compareReducer(initial, {
    type: 'MODEL_COMPLETED',
    payload: {
      columnIndex: 0,
      latencyMs: 350,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cost: 0.0001,
      content: 'Jawaban final A',
    },
  });

  assert.equal(state?.results[0].status, 'completed');
  assert.equal(state?.results[0].latencyMs, 350);
  assert.equal(state?.results[0].totalTokens, 30);
  assert.equal(state?.results[0].cost, 0.0001);
  assert.equal(state?.status, 'running'); // Model B is still pending

  state = compareReducer(state, {
    type: 'MODEL_COMPLETED',
    payload: {
      columnIndex: 1,
      latencyMs: 400,
      promptTokens: 10,
      completionTokens: 30,
      totalTokens: 40,
      cost: 0.0002,
      content: 'Jawaban final B',
    },
  });

  // Now both models are finished
  assert.equal(state?.results[1].status, 'completed');
  assert.equal(state?.status, 'completed');
  assert.equal(state?.totalTokensUsed, 70); // 30 + 40
});

test('compareReducer handles MODEL_FAILED without fallback and marks column failed', () => {
  const initial = createMockRun();
  let state = compareReducer(initial, {
    type: 'MODEL_FAILED',
    payload: {
      columnIndex: 0,
      error: 'Batas kuota 429 terlampaui',
    },
  });

  assert.equal(state?.results[0].status, 'failed');
  assert.equal(state?.results[0].error, 'Batas kuota 429 terlampaui');
  assert.equal(state?.status, 'running'); // Column 1 still running

  state = compareReducer(state, {
    type: 'MODEL_COMPLETED',
    payload: {
      columnIndex: 1,
      latencyMs: 200,
      totalTokens: 50,
      content: 'Jawaban Sukses B',
    },
  });

  assert.equal(state?.results[1].status, 'completed');
  assert.equal(state?.status, 'completed'); // Both finished
});

test('compareReducer handles REVEAL mapping without leaking prior to action', () => {
  const initial = createMockRun({ blindMode: true, revealed: false });
  assert.equal(initial.results[0].modelId, undefined);
  assert.equal(initial.results[1].modelId, undefined);

  const state = compareReducer(initial, {
    type: 'REVEAL',
    payload: {
      mapping: {
        0: 'anthropic/claude-3-5-sonnet',
        1: 'google/gemini-2.5-pro',
      },
    },
  });

  assert.equal(state?.revealed, true);
  assert.equal(state?.results[0].modelId, 'anthropic/claude-3-5-sonnet');
  assert.equal(state?.results[1].modelId, 'google/gemini-2.5-pro');
});

test('compareReducer handles SET_WINNER, marks winner column and automatically reveals', () => {
  const initial = createMockRun({ blindMode: true, revealed: false });
  const state = compareReducer(initial, {
    type: 'SET_WINNER',
    payload: {
      winnerModelId: 'google/gemini-2.5-pro',
      winnerResultId: 'res-2',
      mapping: {
        0: 'anthropic/claude-3-5-sonnet',
        1: 'google/gemini-2.5-pro',
      },
    },
  });

  assert.equal(state?.winnerModelId, 'google/gemini-2.5-pro');
  assert.equal(state?.revealed, true);
  assert.equal(state?.results[0].isWinner, false);
  assert.equal(state?.results[1].isWinner, true);
  assert.equal(state?.results[1].modelId, 'google/gemini-2.5-pro');
});

test('compareReducer handles synthesis lifecycle (start, chunk, completed, failed)', () => {
  const initial = createMockRun();
  let state = compareReducer(initial, {
    type: 'SYNTHESIS_START',
    payload: { model: 'google/gemini-2.5-flash' },
  });

  assert.equal(state?.synthesis?.status, 'running');
  assert.equal(state?.synthesis?.model, 'google/gemini-2.5-flash');
  assert.equal(state?.synthesis?.content, '');

  state = compareReducer(state, {
    type: 'SYNTHESIS_CHUNK',
    payload: { delta: '## Persamaan\nKedua model sepakat...' },
  });

  assert.equal(state?.synthesis?.content, '## Persamaan\nKedua model sepakat...');

  state = compareReducer(state, {
    type: 'SYNTHESIS_COMPLETED',
    payload: {
      content: '## Persamaan\nKedua model sepakat...\n\n## Rekomendasi\nModel B lebih unggul.',
      usage: { totalTokens: 120 },
    },
  });

  assert.equal(state?.synthesis?.status, 'completed');
  assert.equal(state?.synthesis?.usage?.totalTokens, 120);

  // Failure scenario
  state = compareReducer(state, {
    type: 'SYNTHESIS_FAILED',
    payload: { error: 'Gagal membuat sintesis' },
  });

  assert.equal(state?.synthesis?.status, 'failed');
  assert.equal(state?.synthesis?.error, 'Gagal membuat sintesis');
});
