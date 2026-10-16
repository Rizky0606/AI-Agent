import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletionRequest, ChatStreamChunk, ModelGateway } from '@personal-ai-os/model-gateway';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryModelConfigRepository } from '../src/db/model-config-repository.ts';
import { ModelRouter } from '../src/services/model-router.ts';
import { ChatConnection } from '../../windows/src/connection/agent-connection.ts';
import { ApiClient } from '../../android/src/api/client.ts';
import { ChatWebSocketClient } from '../../android/src/services/chat-websocket.ts';
import { InMemoryTokenStorage } from '../../android/src/storage/secure-store.ts';
import { useChatStore, type ChatState } from '../../android/src/state/chat-store.ts';

type Message = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};
type Frame = {
  type: string;
  conversationId?: string;
  messageId?: string;
  message?: Message;
  delta?: string;
  code?: string;
  userId?: string;
};

// Explicit deterministic test double: exercises the real router, not a production model.
class LifecycleGateway implements ModelGateway {
  readonly requests: ChatCompletionRequest[] = [];
  readonly aborted: string[] = [];

  async chat(): Promise<never> { throw new Error('Unexpected non-streaming request'); }
  async listModels() { return []; }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    this.requests.push(request);
    const content = request.messages.at(-1)?.content;
    if (content === 'cancel-return' || content === 'cancel-throw') {
      yield { delta: 'Saved partial', done: false };
      assert.ok(request.signal);
      const signal = request.signal;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      this.aborted.push(content);
      if (content === 'cancel-throw') throw new DOMException('Gateway aborted', 'AbortError');
      return;
    }
    if (content === 'stream-error') {
      yield { delta: 'Unfinished', done: false };
      throw new Error('Controlled stream failure');
    }
    yield { delta: 'Hello ', done: false };
    yield { delta: 'world', done: false };
    yield { delta: '', done: true, usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } };
  }
}

const messageOf = (frame: Frame): Message => {
  assert.ok(frame.message);
  assert.match(frame.message.id, /^[0-9a-f-]{36}$/);
  assert.equal(frame.message.conversationId, frame.conversationId);
  assert.ok(Number.isFinite(Date.parse(frame.message.createdAt)));
  return frame.message;
};

test('Chat lifecycle over listening HTTP/WebSocket: auth race, history, cancellation, validation and stream failure', { timeout: 15000 }, async (t) => {
  const auth = createAuthService(new InMemoryAuthRepository(), 'chat-lifecycle-secret-at-least-thirty-two');
  const alice = await auth.register('lifecycle@example.com', 'ValidPassword123!');
  const bob = await auth.register('other-lifecycle@example.com', 'ValidPassword123!');
  let releaseAuth!: () => void;
  const authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
  let authPending = false;
  const chatRepo = new InMemoryChatRepository();
  const modelConfigs = new InMemoryModelConfigRepository();
  const provider = await modelConfigs.upsertProvider('test-double', 'http://gateway.invalid/v1');
  await modelConfigs.upsertModelConfig(provider.id, 'lifecycle-model', ['chat', 'streaming'], 32000);
  const gateway = new LifecycleGateway();
  const router = new ModelRouter(modelConfigs, gateway);
  const app = await buildApp({
    auth: {
      ...auth,
      async authenticate(token: string) {
        authPending = true;
        await authGate;
        authPending = false;
        return auth.authenticate(token);
      },
    },
    chat: { chatRepo, modelConfigs, gateway, router },
  });
  app.log.level = 'silent';
  t.after(async () => { releaseAuth(); await app.close(); });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  // Observe receipt before releasing authentication; no sleep-based race assumption.
  const receivedWhileAuthenticating = new Promise<void>((resolve) => {
    app.websocketServer.once('connection', (socket) => {
      socket.once('message', () => { assert.equal(authPending, true); resolve(); });
    });
  });
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/v1/chat/ws?token=${encodeURIComponent(alice.accessToken)}`);
  t.after(() => ws.close());
  const frames: Frame[] = [];
  let pending: { predicate: (frame: Frame) => boolean; resolve: (frame: Frame) => void; reject: (error: Error) => void } | undefined;
  ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    frames.push(frame);
    if (pending?.predicate(frame)) {
      const waiter = pending;
      pending = undefined;
      waiter.resolve(frame);
    }
  };
  ws.onerror = () => pending?.reject(new Error('WebSocket transport failed'));
  const waitFor = async (predicate: (frame: Frame) => boolean, from = 0): Promise<Frame> => {
    const existing = frames.slice(from).find(predicate);
    if (existing) return existing;
    return new Promise<Frame>((resolve, reject) => {
      pending = { predicate, resolve, reject };
    });
  };
  const send = (payload: unknown) => ws.send(JSON.stringify(payload));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      send({ type: 'chat.send', content: 'hello', mode: 'fast', model: 'lifecycle-model' });
      resolve();
    };
    ws.onerror = () => reject(new Error('WebSocket failed to open'));
  });
  await receivedWhileAuthenticating;
  releaseAuth();
  const completed = await waitFor((frame) => frame.type === 'message.completed');
  assert.deepEqual(frames.map((frame) => frame.type), [
    'auth.ok', 'conversation.created', 'message.created', 'message.created',
    'message.delta', 'message.delta', 'message.completed',
  ]);
  assert.equal(frames[0]?.userId, alice.user.id);
  const conversationId = frames[1]?.conversationId;
  assert.ok(conversationId);
  assert.match(conversationId, /^[0-9a-f-]{36}$/);
  const user = messageOf(frames[2]!);
  const assistant = messageOf(frames[3]!);
  assert.equal(user.role, 'user');
  assert.equal(user.content, 'hello');
  assert.equal(user.metadata?.mode, 'fast');
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.content, '');
  assert.notEqual(user.id, assistant.id);
  assert.equal(messageOf(completed).id, assistant.id);
  assert.equal(messageOf(completed).content, 'Hello world');
  for (const frame of frames.slice(1)) assert.equal(frame.conversationId, conversationId);
  for (const frame of frames.slice(4)) assert.equal(frame.messageId, assistant.id);
  assert.equal(frames.filter((frame) => frame.type === 'message.delta').map((frame) => frame.delta).join(''), 'Hello world');
  assert.equal(gateway.requests[0]?.model, 'lifecycle-model');
  assert.deepEqual(gateway.requests[0]?.messages, [{ role: 'user', content: 'hello' }]);

  const history = async (id = conversationId): Promise<Message[]> => {
    const response = await fetch(`${base}/v1/conversations/${id}/messages`, { headers: { authorization: `Bearer ${alice.accessToken}` } });
    assert.equal(response.status, 200);
    return (await response.json() as { messages: Message[] }).messages;
  };
  let saved = await history();
  assert.deepEqual(saved.map(({ id, role, content }) => ({ id, role, content })), [
    { id: user.id, role: 'user', content: 'hello' },
    { id: assistant.id, role: 'assistant', content: 'Hello world' },
  ]);
  assert.deepEqual(saved[1]?.metadata?.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  const list = await fetch(`${base}/v1/conversations`, { headers: { authorization: `Bearer ${alice.accessToken}` } });
  assert.equal(list.status, 200);
  assert.equal((await list.json() as { conversations: Array<{ id: string }> }).conversations[0]?.id, conversationId);
  assert.equal((await fetch(`${base}/v1/conversations/${conversationId}/messages`)).status, 401);
  assert.equal((await fetch(`${base}/v1/conversations/${conversationId}/messages`, { headers: { authorization: `Bearer ${bob.accessToken}` } })).status, 404);

  for (const content of ['cancel-return', 'cancel-throw']) {
    const from = frames.length;
    send({ type: 'chat.send', conversationId, content });
    const delta = await waitFor((frame) => frame.type === 'message.delta', from);
    assert.equal(delta.delta, 'Saved partial');
    send({ type: 'chat.cancel', messageId: delta.messageId });
    const cancelled = await waitFor((frame) => frame.type === 'message.cancelled', from);
    const created = frames.slice(from).find((frame) => frame.type === 'message.created' && frame.message?.role === 'assistant');
    assert.ok(created);
    assert.equal(messageOf(cancelled).id, messageOf(created).id);
    assert.equal(cancelled.messageId, delta.messageId);
    assert.equal(cancelled.conversationId, conversationId);
    assert.equal(messageOf(cancelled).content, 'Saved partial');
    assert.equal(messageOf(cancelled).metadata?.cancelled, true);
    assert.ok(!frames.slice(from).some((frame) => frame.type === 'error' || frame.type === 'message.completed' || frame.type === 'conversation.created'));
    saved = await history();
    assert.deepEqual(saved.at(-1), { ...messageOf(cancelled), userId: alice.user.id });
  }
  assert.deepEqual(gateway.aborted, ['cancel-return', 'cancel-throw']);
  assert.equal(saved.length, 6);
  assert.equal(gateway.requests[2]?.messages.length, 5);

  const invalids = [
    { payload: null, code: 'INVALID_FRAME' },
    { payload: { type: 'chat.send', content: ' ' }, code: 'INVALID_CONTENT' },
    { payload: { type: 'chat.send', content: 'bad', conversationId: 'not-a-uuid' }, code: 'INVALID_PAYLOAD' },
    { payload: { type: 'chat.send', content: 'bad', attachments: [{ type: 'image', url: 'file:///secret' }] }, code: 'INVALID_PAYLOAD' },
  ];
  for (const { payload, code } of invalids) {
    const from = frames.length;
    send(payload);
    assert.equal((await waitFor((frame) => frame.type === 'error', from)).code, code);
  }
  const malformedFrom = frames.length;
  ws.send('{');
  assert.equal((await waitFor((frame) => frame.type === 'error', malformedFrom)).code, 'INVALID_JSON');
  assert.equal(gateway.requests.length, 3);
  assert.equal((await history()).length, 6);

  const errorFrom = frames.length;
  send({ type: 'chat.send', conversationId, content: 'stream-error' });
  const failure = await waitFor((frame) => frame.type === 'error', errorFrom);
  assert.equal(failure.code, 'STREAM_ERROR');
  assert.equal(failure.conversationId, conversationId);
  const failedAssistant = frames.slice(errorFrom).find((frame) => frame.type === 'message.created' && frame.message?.role === 'assistant');
  assert.ok(failedAssistant);
  assert.equal(failure.messageId, messageOf(failedAssistant).id);
  assert.equal(frames.slice(errorFrom).find((frame) => frame.type === 'message.delta')?.delta, 'Unfinished');
  assert.ok(!frames.slice(errorFrom).some((frame) => frame.type === 'message.completed' || frame.type === 'message.cancelled'));
  saved = await history();
  assert.equal(saved.length, 8);
  assert.equal(saved.at(-2)?.content, 'stream-error');
  assert.equal(saved.at(-1)?.id, failure.messageId);
  assert.equal(saved.at(-1)?.content, 'Unfinished');
  assert.deepEqual(saved.at(-1)?.metadata, { failed: true, error: 'Controlled stream failure' });
  const pingFrom = frames.length;
  send({ type: 'ping' });
  await waitFor((frame) => frame.type === 'pong', pingFrom);
  ws.close();

  const client = new ChatConnection({
    serverUrl: base,
    token: alice.accessToken,
    onFrame(incoming) {
      const frame = incoming as Frame;
      frames.push(frame);
      if (pending?.predicate(frame)) {
        const waiter = pending;
        pending = undefined;
        waiter.resolve(frame);
      }
    },
  });
  t.after(() => client.disconnect());
  const clientFrom = frames.length;
  client.sendChatMessage({ type: 'chat.send', content: 'Windows client hello' });
  const clientCompleted = await waitFor((frame) => frame.type === 'message.completed', clientFrom);
  const clientFrames = frames.slice(clientFrom);
  assert.equal(clientFrames[0]?.type, 'auth.ok');
  const clientId = clientFrames.find((frame) => frame.type === 'conversation.created')?.conversationId;
  assert.ok(clientId);
  const clientUser = clientFrames.find((frame) => frame.type === 'message.created' && frame.message?.role === 'user');
  const clientAssistant = clientFrames.find((frame) => frame.type === 'message.created' && frame.message?.role === 'assistant');
  assert.ok(clientUser && clientAssistant);
  assert.equal(messageOf(clientUser).content, 'Windows client hello');
  assert.equal(messageOf(clientCompleted).id, messageOf(clientAssistant).id);
  assert.equal(messageOf(clientCompleted).content, 'Hello world');
  assert.equal((await history(clientId))[1]?.id, messageOf(clientCompleted).id);
  const clientCancelFrom = frames.length;
  client.sendChatMessage({ type: 'chat.send', conversationId: clientId, content: 'cancel-throw' });
  const clientDelta = await waitFor((frame) => frame.type === 'message.delta', clientCancelFrom);
  client.cancelChat();
  const clientCancelled = await waitFor((frame) => frame.type === 'message.cancelled', clientCancelFrom);
  assert.equal(clientCancelled.messageId, clientDelta.messageId);
  assert.equal(messageOf(clientCancelled).content, 'Saved partial');
  assert.equal((await history(clientId)).at(-1)?.id, clientDelta.messageId);
  const clientErrorFrom = frames.length;
  client.sendChatMessage({ type: 'chat.send', conversationId: clientId, content: 'stream-error' });
  assert.equal((await waitFor((frame) => frame.type === 'error', clientErrorFrom)).code, 'STREAM_ERROR');
  client.disconnect();

  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken(alice.accessToken);
  const androidApi = new ApiClient({ storage, baseUrl: base });
  const android = new ChatWebSocketClient({ client: androidApi, conversationId: '' });
  t.after(() => android.disconnect());
  useChatStore.getState().setConversationId('local-new');
  useChatStore.getState().clearDraft();
  const waitForState = async (predicate: (state: ChatState) => boolean): Promise<ChatState> => {
    if (predicate(useChatStore.getState())) return useChatStore.getState();
    return new Promise<ChatState>((resolve) => {
      const unsubscribe = useChatStore.subscribe((state) => {
        if (predicate(state)) { unsubscribe(); resolve(state); }
      });
    });
  };
  await android.connect();
  assert.throws(() => android.sendMessage({ content: 'before auth' }), /not connected/);
  await waitForState((state) => state.connectionStatus === 'connected');
  useChatStore.getState().setDraftText('Android hello');
  useChatStore.getState().beginSend();
  android.sendMessage({ content: 'Android hello' });
  const androidComplete = await waitForState((state) => !state.isSending && state.messages.at(-1)?.content === 'Hello world');
  const androidId = androidComplete.currentConversationId;
  assert.ok(androidId && androidId !== 'local-new');
  assert.equal(androidComplete.messages[0]?.role, 'user');
  assert.equal(androidComplete.messages[0]?.content, 'Android hello');
  assert.equal(androidComplete.messages[1]?.role, 'assistant');
  assert.equal(androidComplete.draftText, '');
  assert.equal(androidComplete.pendingDraft, null);
  const firstAndroidHistory = await androidApi.listMessages(androidId);
  assert.deepEqual(firstAndroidHistory.messages.map((message) => message.id), androidComplete.messages.map((message) => message.id));
  useChatStore.getState().setDraftText('Android second');
  useChatStore.getState().beginSend();
  android.sendMessage({ content: 'Android second' });
  const secondAndroidComplete = await waitForState((state) => !state.isSending && state.messages.length === 4);
  assert.equal(secondAndroidComplete.currentConversationId, androidId);
  assert.equal((await androidApi.listMessages(androidId)).messages.length, 4);

  useChatStore.getState().setDraftText('cancel-throw');
  useChatStore.getState().beginSend();
  android.sendMessage({ content: 'cancel-throw' });
  const androidPartial = await waitForState((state) => state.streamingDelta === 'Saved partial');
  const androidPartialId = androidPartial.streamingMessageId;
  android.cancelActiveStream();
  const androidCancelled = await waitForState((state) => state.messages.at(-1)?.metadata?.['cancelled'] === true);
  assert.equal(androidCancelled.messages.at(-1)?.id, androidPartialId);
  assert.equal(androidCancelled.messages.at(-1)?.content, 'Saved partial');
  assert.equal(androidCancelled.isCancelling, false);
  assert.equal((await androidApi.listMessages(androidId)).messages.at(-1)?.id, androidPartialId);
  // An HTTP hydration started earlier must not overwrite newer live rows or another conversation.
  useChatStore.getState().hydrateMessages(androidId, firstAndroidHistory.messages);
  assert.equal(useChatStore.getState().messages.length, 6);
  assert.equal(useChatStore.getState().messages.at(-1)?.content, 'Saved partial');
  useChatStore.getState().hydrateMessages('stale-other-conversation', []);
  assert.equal(useChatStore.getState().messages.length, 6);

  let observedAcknowledgedDraft = false;
  const unsubscribe = useChatStore.subscribe((state) => {
    if (state.pendingDraft?.text === 'stream-error' && state.draftText === '') observedAcknowledgedDraft = true;
  });
  t.after(unsubscribe);
  useChatStore.getState().setDraftText('stream-error');
  useChatStore.getState().beginSend();
  android.sendMessage({ content: 'stream-error' });
  const androidFailed = await waitForState((state) => state.error === 'Controlled stream failure' && !state.isSending && !state.isStreaming);
  assert.equal(observedAcknowledgedDraft, true);
  assert.equal(androidFailed.draftText, 'stream-error');
  assert.equal(androidFailed.pendingDraft, null);
  assert.equal(androidFailed.messages.at(-1)?.content, 'Unfinished');
  const failedAndroidHistory = await androidApi.listMessages(androidId);
  assert.equal(failedAndroidHistory.messages.at(-1)?.id, androidFailed.messages.at(-1)?.id);
  assert.equal(failedAndroidHistory.messages.at(-1)?.metadata?.['failed'], true);
  unsubscribe();
  android.disconnect();
});
