import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  ModelGateway,
} from '@personal-ai-os/model-gateway';
import { CompareEngine } from '../src/compare/compare-engine.ts';
import type { CompareEngineEvent } from '../src/compare/types.ts';

class MockCompareGateway implements ModelGateway {
  private readonly responses: Map<string, string[]>;
  private readonly failModels: Set<string>;
  public streamCallCount = 0;
  public calledModels: string[] = [];

  constructor(
    responses: Record<string, string[]> = {},
    failModels: string[] = [],
  ) {
    this.responses = new Map(Object.entries(responses));
    this.failModels = new Set(failModels);
  }

  async chat(): Promise<ChatCompletionResponse> {
    throw new Error('Not implemented in mock');
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    this.streamCallCount++;
    this.calledModels.push(request.model);

    if (this.failModels.has(request.model)) {
      throw new Error(`Model ${request.model} gagal merespons: Kuota 429`);
    }

    const chunks = this.responses.get(request.model) ?? [
      `Respons default untuk ${request.model}`,
    ];

    for (const chunk of chunks) {
      if (request.signal?.aborted) {
        throw new Error('Aborted');
      }
      yield {
        delta: chunk,
        done: false,
        usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
      };
    }

    yield {
      delta: '',
      done: true,
      usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
    };
  }

  async listModels() {
    return [];
  }
}

test('CompareEngine validates 2 to 3 models requirement', async () => {
  const engine = new CompareEngine({ modelGateway: new MockCompareGateway() });

  await assert.rejects(
    () =>
      engine.run({
        runId: 'run-1',
        userId: 'u1',
        projectId: 'p1',
        prompt: 'test',
        models: ['model-1'], // Only 1 model
      }),
    /Perbandingan membutuhkan 2 hingga 3 model/,
  );

  await assert.rejects(
    () =>
      engine.run({
        runId: 'run-1',
        userId: 'u1',
        projectId: 'p1',
        prompt: 'test',
        models: ['m1', 'm2', 'm3', 'm4'], // 4 models
      }),
    /Perbandingan membutuhkan 2 hingga 3 model/,
  );
});

test('CompareEngine runs models in parallel and collects chunks and events', async () => {
  const mockGateway = new MockCompareGateway({
    'openai/gpt-4o': ['Halo ', 'dari ', 'GPT-4o'],
    'anthropic/claude-3-5-sonnet': ['Salam ', 'dari ', 'Claude'],
    'google/gemini-2.5-pro': ['Hai ', 'dari ', 'Gemini'],
  });

  const engine = new CompareEngine({ modelGateway: mockGateway });
  const events: CompareEngineEvent[] = [];

  const result = await engine.run(
    {
      runId: 'run-parallel',
      userId: 'u1',
      projectId: 'p1',
      prompt: 'Jelaskan perbedaan SQL dan NoSQL',
      models: [
        'openai/gpt-4o',
        'anthropic/claude-3-5-sonnet',
        'google/gemini-2.5-pro',
      ],
      blindMode: true,
      tokenBudget: 6000,
    },
    {
      onEvent: (evt) => {
        events.push(evt);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.columns.length, 3);

  assert.equal(result.columns[0].modelId, 'openai/gpt-4o');
  assert.equal(result.columns[0].modelAlias, 'Model A');
  assert.equal(result.columns[0].content, 'Halo dari GPT-4o');
  assert.equal(result.columns[0].status, 'completed');
  assert.ok((result.columns[0].latencyMs ?? 0) >= 0);

  assert.equal(result.columns[1].modelId, 'anthropic/claude-3-5-sonnet');
  assert.equal(result.columns[1].modelAlias, 'Model B');
  assert.equal(result.columns[1].content, 'Salam dari Claude');

  assert.equal(result.columns[2].modelId, 'google/gemini-2.5-pro');
  assert.equal(result.columns[2].modelAlias, 'Model C');
  assert.equal(result.columns[2].content, 'Hai dari Gemini');

  // Verify events emitted
  const startedEvt = events.find((e) => e.type === 'compare.started');
  assert.ok(startedEvt);
  assert.equal(startedEvt.modelsCount, 3);
  assert.equal(startedEvt.blindMode, true);

  const completedEvt = events.find((e) => e.type === 'compare.completed');
  assert.ok(completedEvt);
});

test('CompareEngine strictly enforces NO FALLBACK when one model fails', async () => {
  const mockGateway = new MockCompareGateway(
    {
      'openai/gpt-4o': ['Jawaban sukses dari GPT'],
      'google/gemini-2.5-pro': ['Jawaban sukses dari Gemini'],
    },
    ['anthropic/claude-3-5-sonnet'], // Model that fails
  );

  const engine = new CompareEngine({ modelGateway: mockGateway });
  const events: CompareEngineEvent[] = [];

  const result = await engine.run(
    {
      runId: 'run-fail-one',
      userId: 'u1',
      projectId: 'p1',
      prompt: 'Jelaskan ACID properties',
      models: [
        'openai/gpt-4o',
        'anthropic/claude-3-5-sonnet',
        'google/gemini-2.5-pro',
      ],
    },
    {
      onEvent: (evt) => {
        events.push(evt);
      },
    },
  );

  assert.equal(result.status, 'completed'); // Overall run completes because 2 models succeeded
  assert.equal(result.columns[0].status, 'completed');
  assert.equal(result.columns[0].content, 'Jawaban sukses dari GPT');

  // Failed column must be marked failed directly with exact error, NO fallback
  assert.equal(result.columns[1].status, 'failed');
  assert.match(
    result.columns[1].error ?? '',
    /Model anthropic\/claude-3-5-sonnet gagal merespons: Kuota 429/,
  );

  assert.equal(result.columns[2].status, 'completed');
  assert.equal(result.columns[2].content, 'Jawaban sukses dari Gemini');

  // Ensure no other fallback model was queried
  assert.deepEqual(mockGateway.calledModels, [
    'openai/gpt-4o',
    'anthropic/claude-3-5-sonnet',
    'google/gemini-2.5-pro',
  ]);

  const failedEvt = events.find(
    (e) => e.type === 'compare.model_failed' && e.columnIndex === 1,
  );
  assert.ok(failedEvt);
});

test('CompareEngine synthesis generates structured comparison and identifies model', async () => {
  const mockGateway = new MockCompareGateway({
    'synthesis-model': [
      '### Persamaan\nSemua model menjelaskan konsep yang sama.\n\n### Perbedaan\nModel B lebih detil.\n\n### Rekomendasi\nGunakan Model B.',
    ],
  });

  const engine = new CompareEngine({
    modelGateway: mockGateway,
    defaultSynthesisModel: 'synthesis-model',
  });
  const events: CompareEngineEvent[] = [];

  const synthResult = await engine.synthesize(
    {
      runId: 'run-synth',
      prompt: 'Apa itu dependency injection?',
      columns: [
        {
          columnIndex: 0,
          modelId: 'm1',
          modelAlias: 'Model A',
          content: 'Jawaban A',
          status: 'completed',
        },
        {
          columnIndex: 1,
          modelId: 'm2',
          modelAlias: 'Model B',
          content: 'Jawaban B',
          status: 'completed',
        },
      ],
      synthesisModel: 'synthesis-model',
    },
    {
      onEvent: (evt) => {
        events.push(evt);
      },
    },
  );

  assert.equal(synthResult.model, 'synthesis-model');
  assert.match(synthResult.content, /### Persamaan/);
  assert.match(synthResult.content, /### Perbedaan/);
  assert.match(synthResult.content, /### Rekomendasi/);

  const completedEvt = events.find(
    (e) => e.type === 'compare.synthesis_completed',
  );
  assert.ok(completedEvt);
});
