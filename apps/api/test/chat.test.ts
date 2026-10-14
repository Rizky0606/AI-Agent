import assert from 'node:assert/strict';
import test from 'node:test';
import { MockModelGateway } from '@personal-ai-os/model-gateway';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryModelConfigRepository } from '../src/db/model-config-repository.ts';
import { ModelRouter } from '../src/services/model-router.ts';

const setupChatApp = async (options?: { mockGateway?: MockModelGateway; seedModels?: boolean }) => {
  const authRepo = new InMemoryAuthRepository();
  const authService = createAuthService(authRepo, 'test-secret-test-secret-test-secret-32');
  const chatRepo = new InMemoryChatRepository();
  const modelConfigRepo = new InMemoryModelConfigRepository();

  if (options?.seedModels !== false) {
    const provider = await modelConfigRepo.upsertProvider(
      '9router',
      'https://9router.ojixx.my.id/v1',
    );
    // Model 1: Primary chat & streaming (no vision verified!)
    await modelConfigRepo.upsertModelConfig(
      provider.id,
      'anthropic/claude-3-5-sonnet',
      ['chat', 'streaming', 'tool_calling'],
      200_000,
    );
    // Model 2: Fallback model
    await modelConfigRepo.upsertModelConfig(
      provider.id,
      'openai/gpt-4o-mini',
      ['chat', 'streaming'],
      128_000,
    );
  }

  const gateway =
    options?.mockGateway ??
    new MockModelGateway({
      chatResponse: 'Jawaban dari asisten AI.',
      streamChunks: ['Halo, ', 'saya ', 'adalah ', 'Personal AI OS.'],
      streamDelayMs: 15,
    });

  const router = new ModelRouter(modelConfigRepo, gateway);

  const app = await buildApp({
    auth: authService,
    health: { database: async () => true, redis: async () => true },
    chat: {
      chatRepo,
      router,
    },
  });

  return { app, authService, chatRepo, modelConfigRepo, gateway, router };
};

test('ModelRouter rejects unverified vision and falls back on provider failure', async () => {
  const { router, gateway } = await setupChatApp();

  // 1. Vision rejection when no active model has vision capability
  const visionCheck = await router.resolveModel({ requiresVision: true });
  assert.equal(visionCheck.ok, false);
  if (!visionCheck.ok) {
    assert.equal(visionCheck.error, 'VISION_NOT_VERIFIED');
    assert.match(visionCheck.message, /belum diverifikasi/);
  }

  // 2. Normal resolution selects primary
  const normalCheck = await router.resolveModel({ requiresStreaming: true });
  assert.equal(normalCheck.ok, true);
  if (normalCheck.ok) {
    assert.equal(normalCheck.primary.model, 'anthropic/claude-3-5-sonnet');
    assert.equal(normalCheck.fallback?.model, 'openai/gpt-4o-mini');
  }

  // 3. Fallback on primary failure
  gateway.setFailures(1); // Primary fails once
  const chatResult = await router.chat({
    messages: [{ role: 'user', content: 'Tes fallback' }],
  });
  assert.equal(chatResult.resolvedModel, 'openai/gpt-4o-mini');
  assert.equal(chatResult.fallbackUsed, true);

  // 4. Exceeding context budget returns NO_COMPATIBLE_MODEL
  const oversizedCheck = await router.resolveModel({ estimatedTokens: 500_000 });
  assert.equal(oversizedCheck.ok, false);
  if (!oversizedCheck.ok) {
    assert.equal(oversizedCheck.error, 'NO_COMPATIBLE_MODEL');
  }
});

test('HTTP POST /v1/chat sends text message and denies unverified vision attachments', async () => {
  const { app, authService, chatRepo } = await setupChatApp();
  const alice = await authService.register('alice@chat.com', 'password-123456');

  // 1. Unauthenticated request rejected
  const unauthRes = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: { content: 'Halo' },
  });
  assert.equal(unauthRes.statusCode, 401);

  // 2. Image attachment rejected with explanation because vision is not verified
  const visionRes = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      content: 'Lihat gambar ini',
      attachments: [{ type: 'image', url: 'https://example.com/pic.png' }],
    },
  });
  assert.equal(visionRes.statusCode, 400);
  assert.equal(visionRes.json().error.code, 'VISION_NOT_VERIFIED');
  assert.match(visionRes.json().error.message, /belum diverifikasi/);

  // 3. Valid text chat completes and persists to conversation and messages
  const chatRes = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { content: 'Siapa nama Anda?' },
  });
  assert.equal(chatRes.statusCode, 200);
  const data = chatRes.json();
  assert.ok(data.conversationId);
  assert.equal(data.message.role, 'assistant');
  assert.equal(data.message.content, 'Jawaban dari asisten AI.');

  // Verify DB persistence
  const history = await chatRepo.getMessages(alice.user.id, data.conversationId);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.role, 'user');
  assert.equal(history[0]?.content, 'Siapa nama Anda?');
  assert.equal(history[1]?.role, 'assistant');
  assert.equal(history[1]?.content, 'Jawaban dari asisten AI.');

  await app.close();
});

test('WebSocket /v1/chat/ws streams deltas, completes, and persists messages', async () => {
  const { app, authService, chatRepo } = await setupChatApp();
  const bob = await authService.register('bob@chat.com', 'password-123456');

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/chat/ws?token=${bob.accessToken}`);

  const events: Array<Record<string, unknown>> = [];
  const authPromise = new Promise<void>((resolve) => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString()) as Record<string, unknown>;
      events.push(data);
      if (data.type === 'auth.ok') resolve();
    };
  });

  await authPromise;
  assert.equal(events[0]?.type, 'auth.ok');

  // Send chat message
  const completionPromise = new Promise<void>((resolve) => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString()) as Record<string, unknown>;
      events.push(data);
      if (data.type === 'message.completed') resolve();
    };
  });

  ws.send(JSON.stringify({ type: 'chat.send', content: 'Halo dari WS' }));
  await completionPromise;

  const deltas = events.filter((e) => e.type === 'message.delta');
  const completed = events.find((e) => e.type === 'message.completed');

  assert.ok(deltas.length >= 4);
  assert.ok(completed);
  const completedMessage = completed.message as { id: string; content: string };
  assert.equal(completedMessage.content, 'Halo, saya adalah Personal AI OS.');
  assert.equal(completedMessage.id, completed.messageId);

  // Verify messages persisted
  const convCreated = events.find((e) => e.type === 'conversation.created');
  const conversationId = (convCreated?.conversationId ?? completed.conversationId) as string;
  assert.ok(conversationId);

  const history = await chatRepo.getMessages(bob.user.id, conversationId);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.role, 'user');
  assert.equal(history[0]?.content, 'Halo dari WS');
  assert.equal(history[1]?.role, 'assistant');
  assert.equal(history[1]?.content, 'Halo, saya adalah Personal AI OS.');

  ws.close();
  await app.close();
});

test('WebSocket /v1/chat/ws supports stream cancellation mid-stream', async () => {
  const slowGateway = new MockModelGateway({
    streamChunks: ['Chunk A ', 'Chunk B ', 'Chunk C ', 'Chunk D '],
    streamDelayMs: 40,
  });

  const { app, authService, chatRepo } = await setupChatApp({ mockGateway: slowGateway });
  const carol = await authService.register('carol@chat.com', 'password-123456');

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/chat/ws?token=${carol.accessToken}`);

  await new Promise<void>((resolve) => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString()) as Record<string, unknown>;
      if (data.type === 'auth.ok') resolve();
    };
  });

  let conversationId = '';
  let messageIdToCancel = '';
  const cancelPromise = new Promise<void>((resolve) => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString()) as Record<string, unknown>;
      if (data.type === 'conversation.created') {
        conversationId = data.conversationId as string;
      }
      if (data.type === 'message.delta' && !messageIdToCancel) {
        messageIdToCancel = data.messageId as string;
        // Cancel stream immediately after receiving first delta
        ws.send(JSON.stringify({ type: 'chat.cancel', messageId: messageIdToCancel }));
      }
      if (data.type === 'message.cancelled') {
        resolve();
      }
    };
  });

  ws.send(JSON.stringify({ type: 'chat.send', content: 'Generate long response' }));
  await cancelPromise;

  // Verify cancelled state in persistence
  assert.ok(conversationId);
  const history = await chatRepo.getMessages(carol.user.id, conversationId);
  const assistantMsg = history.find((m) => m.role === 'assistant');
  assert.ok(assistantMsg);
  assert.equal(assistantMsg.metadata?.cancelled, true);

  ws.close();
  await app.close();
});

test('WebSocket rejects unverified vision attachment via WS', async () => {
  const { app, authService } = await setupChatApp();
  const dave = await authService.register('dave@chat.com', 'password-123456');

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/chat/ws?token=${dave.accessToken}`);

  await new Promise<void>((resolve) => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString()) as Record<string, unknown>;
      if (data.type === 'auth.ok') resolve();
    };
  });

  const errorPromise = new Promise<Record<string, unknown>>((resolve) => {
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString()) as Record<string, unknown>;
      if (data.type === 'error') resolve(data);
    };
  });

  ws.send(
    JSON.stringify({
      type: 'chat.send',
      content: 'Tolong baca gambar ini',
      attachments: [{ type: 'image', url: 'https://example.com/unverified.png' }],
    }),
  );

  const errorEvent = await errorPromise;
  assert.equal(errorEvent.code, 'VISION_NOT_VERIFIED');
  assert.match(String(errorEvent.message), /belum diverifikasi/);

  ws.close();
  await app.close();
});
