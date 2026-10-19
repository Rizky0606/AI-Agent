import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryCompareRepository } from '../src/db/compare-repository.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { CompareEngine } from '@personal-ai-os/agent-core';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  ModelGateway,
} from '@personal-ai-os/model-gateway';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';

class TestCompareGateway implements ModelGateway {
  private readonly responses: Map<string, string[]>;
  private readonly failModels: Set<string>;
  public streamCalls: string[] = [];

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
    this.streamCalls.push(request.model);

    if (this.failModels.has(request.model)) {
      throw new Error(`Model ${request.model} gagal merespons: Kuota 429`);
    }

    const chunks = this.responses.get(request.model) ?? [
      `Respons default dari model ${request.model}`,
    ];

    for (const chunk of chunks) {
      if (request.signal?.aborted) {
        throw new Error('Dibatalkan');
      }
      yield {
        delta: chunk,
        done: false,
        usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 },
      };
    }

    yield {
      delta: '',
      done: true,
      usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 },
    };
  }

  async listModels() {
    return [];
  }
}

const setupCompareTest = async (options?: {
  responses?: Record<string, string[]>;
  failModels?: string[];
}) => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-secret-at-least-thirty-two-chars-long');
  const projectRepo = new InMemoryProjectRepository();
  const chatRepo = new InMemoryChatRepository();
  const compareRepo = new InMemoryCompareRepository();
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const mockGateway = new TestCompareGateway(
    options?.responses ?? {
      'openai/gpt-4o': ['Halo dari GPT-4o.'],
      'anthropic/claude-3-5-sonnet': ['Salam dari Claude.'],
      'google/gemini-2.5-flash': ['Hai dari Gemini.'],
      'synthesis-model': [
        '### Persamaan\nSemua model sepakat.\n\n### Perbedaan\nModel berbeda gaya.\n\n### Rekomendasi\nGunakan Claude untuk analisis.',
      ],
    },
    options?.failModels ?? [],
  );

  const engine = new CompareEngine({
    modelGateway: mockGateway,
    defaultSynthesisModel: 'synthesis-model',
  });

  const app = await buildApp({
    auth,
    health: { database: async () => true, redis: async () => true },
    project: { projectRepo, chatRepo },
    compare: {
      compareRepo,
      chatRepo,
      broadcaster,
      engine,
      modelGateway: mockGateway,
      defaultSynthesisModel: 'synthesis-model',
    },
  });

  const alice = await auth.register('alice.compare@example.com', 'ValidPassword123!');
  const bob = await auth.register('bob.compare@example.com', 'ValidPassword123!');
  const aliceProject = await projectRepo.createProject(alice.user.id, 'Proyek Komparasi Alice');
  const bobProject = await projectRepo.createProject(bob.user.id, 'Proyek Bob');

  return {
    app,
    auth,
    compareRepo,
    chatRepo,
    broadcaster,
    mockGateway,
    alice,
    bob,
    aliceProject,
    bobProject,
  };
};

test('POST /v1/compare: Validasi batas model (menolak <2 dan >3 model)', async () => {
  const { app, alice, aliceProject } = await setupCompareTest();

  // Less than 2 models
  const res1 = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Jelaskan perbedaan microservices dan monolith',
      models: ['openai/gpt-4o'],
    },
  });
  assert.equal(res1.statusCode, 400);
  assert.match(res1.json().error.message, /fewer than 2 items/i);

  // More than 3 models
  const res2 = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Jelaskan perbedaan microservices dan monolith',
      models: ['m1', 'm2', 'm3', 'm4'],
    },
  });
  assert.equal(res2.statusCode, 400);
});

test('POST /v1/compare: Menjalankan 2 model secara paralel dan menyiarkan event', async () => {
  const { app, alice, aliceProject, broadcaster } = await setupCompareTest();
  const events: TaskEventEnvelope[] = [];
  broadcaster.subscribe((evt) => {
    events.push(evt);
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Bandingkan Rust vs Go',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
      blindMode: false,
      tokenBudget: 4000,
    },
  });

  assert.equal(res.statusCode, 201);
  const data = res.json();
  assert.ok(data.run.id);
  assert.equal(data.results.length, 2);
  assert.equal(data.results[0].modelAlias, 'Model A');
  assert.equal(data.results[1].modelAlias, 'Model B');

  // Wait briefly for background execution to complete
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Check detail
  const detailRes = await app.inject({
    method: 'GET',
    url: `/v1/compare/${data.run.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(detailRes.statusCode, 200);
  const detail = detailRes.json();
  assert.equal(detail.run.status, 'completed');
  assert.equal(detail.results[0].status, 'completed');
  assert.equal(detail.results[0].content, 'Halo dari GPT-4o.');
  assert.equal(detail.results[1].status, 'completed');
  assert.equal(detail.results[1].content, 'Salam dari Claude.');
});

test('Compare Strictly NO FALLBACK: jika 1 model gagal, kolom ditandai gagal tanpa retry fallback', async () => {
  const { app, alice, aliceProject, mockGateway } = await setupCompareTest({
    failModels: ['anthropic/claude-3-5-sonnet'], // Model B will fail
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Jelaskan ACID properties',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
    },
  });

  assert.equal(res.statusCode, 201);
  const runId = res.json().run.id;

  await new Promise((resolve) => setTimeout(resolve, 80));

  const detailRes = await app.inject({
    method: 'GET',
    url: `/v1/compare/${runId}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  const detail = detailRes.json();

  // Model A succeeds
  assert.equal(detail.results[0].status, 'completed');
  assert.equal(detail.results[0].content, 'Halo dari GPT-4o.');

  // Model B strictly marked failed, NO fallback substitution
  assert.equal(detail.results[1].status, 'failed');
  assert.match(detail.results[1].error, /Kuota 429/);

  // Called models only the 2 requested, no extra fallback model
  assert.deepEqual(mockGateway.streamCalls, ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet']);
});

test('Mode Buta (Blind Mode): identitas model tidak bocor sebelum Ungkap / Pilih Pemenang', async () => {
  const { app, alice, bob, aliceProject } = await setupCompareTest();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Apa itu distributed tracing?',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
      blindMode: true,
    },
  });

  assert.equal(res.statusCode, 201);
  const runId = res.json().run.id;

  // Initial POST response must NOT leak modelId
  assert.equal(res.json().results[0].modelId, undefined);
  assert.equal(res.json().results[1].modelId, undefined);

  await new Promise((resolve) => setTimeout(resolve, 80));

  // GET details before reveal MUST NOT leak modelId
  const getBefore = await app.inject({
    method: 'GET',
    url: `/v1/compare/${runId}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getBefore.json().results[0].modelId, undefined);
  assert.equal(getBefore.json().results[1].modelId, undefined);
  assert.equal(getBefore.json().run.revealed, false);

  // Bob cannot read Alice's run (isolation)
  const bobRes = await app.inject({
    method: 'GET',
    url: `/v1/compare/${runId}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobRes.statusCode, 404);

  // Now Reveal
  const revealRes = await app.inject({
    method: 'POST',
    url: `/v1/compare/${runId}/reveal`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(revealRes.statusCode, 200);
  assert.equal(revealRes.json().run.revealed, true);
  assert.equal(revealRes.json().results[0].modelId, 'openai/gpt-4o');
  assert.equal(revealRes.json().results[1].modelId, 'anthropic/claude-3-5-sonnet');
});

test('Pilih Pemenang: mencatat pilihan pengguna dan otomatis mengungkap nama model', async () => {
  const { app, alice, aliceProject } = await setupCompareTest();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Bandingkan Redis dan Memcached',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
      blindMode: true,
    },
  });

  const runId = res.json().run.id;
  const result1Id = res.json().results[1].id;

  await new Promise((resolve) => setTimeout(resolve, 80));

  const winRes = await app.inject({
    method: 'POST',
    url: `/v1/compare/${runId}/winner`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { resultId: result1Id },
  });

  assert.equal(winRes.statusCode, 200);
  const data = winRes.json();
  assert.equal(data.run.winnerModelId, 'anthropic/claude-3-5-sonnet');
  assert.equal(data.run.revealed, true);
  assert.equal(data.results[0].isWinner, false);
  assert.equal(data.results[1].isWinner, true);
});

test('Sintesis Komparatif: merangkum persamaan, perbedaan, dan rekomendasi dengan label model', async () => {
  const { app, alice, aliceProject } = await setupCompareTest();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Jelaskan konsep zero trust architecture',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
    },
  });

  const runId = res.json().run.id;
  await new Promise((resolve) => setTimeout(resolve, 80));

  const synthRes = await app.inject({
    method: 'POST',
    url: `/v1/compare/${runId}/synthesize`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { model: 'synthesis-model' },
  });

  assert.equal(synthRes.statusCode, 200);
  const synth = synthRes.json().synthesis;
  assert.equal(synth.status, 'completed');
  assert.equal(synth.model, 'synthesis-model');
  assert.match(synth.content, /### Persamaan/);
  assert.match(synth.content, /### Perbedaan/);
  assert.match(synth.content, /### Rekomendasi/);
});

test('Promote to Conversation: menjadikan jawaban pemenang lanjutan percakapan di chat', async () => {
  const { app, alice, aliceProject, chatRepo } = await setupCompareTest();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Bagaimana cara setup WebSocket di Fastify?',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
    },
  });

  const runId = res.json().run.id;
  const result0Id = res.json().results[0].id;
  await new Promise((resolve) => setTimeout(resolve, 80));

  const promoteRes = await app.inject({
    method: 'POST',
    url: `/v1/compare/${runId}/promote`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { resultId: result0Id, title: 'Diskusi WebSocket Fastify' },
  });

  assert.equal(promoteRes.statusCode, 201);
  const { conversationId, title } = promoteRes.json();
  assert.ok(conversationId);
  assert.equal(title, 'Diskusi WebSocket Fastify');

  // Verify conversation and messages exist in chat repo
  const conv = await chatRepo.getConversation(alice.user.id, conversationId);
  assert.ok(conv);
  assert.equal(conv.title, 'Diskusi WebSocket Fastify');

  const messages = await chatRepo.getMessages(alice.user.id, conversationId);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Bagaimana cara setup WebSocket di Fastify?');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'Halo dari GPT-4o.');
});

test('GET & DELETE /v1/compare: pagination dan penghapusan', async () => {
  const { app, alice, aliceProject } = await setupCompareTest();

  // Create 2 runs
  const res1 = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Prompt 1',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
    },
  });
  const run1Id = res1.json().run.id;

  const res2 = await app.inject({
    method: 'POST',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      projectId: aliceProject.id,
      prompt: 'Prompt 2',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
    },
  });
  const run2Id = res2.json().run.id;

  // List
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().total, 2);

  // Delete run 1
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/v1/compare/${run1Id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.json().success, true);

  // Check list again
  const listAfter = await app.inject({
    method: 'GET',
    url: '/v1/compare',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(listAfter.json().total, 1);
  assert.equal(listAfter.json().runs[0].id, run2Id);
});
