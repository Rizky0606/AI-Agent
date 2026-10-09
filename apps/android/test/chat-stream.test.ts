import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ApiClient } from '../src/api/client.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';
import { ChatWebSocketClient } from '../src/services/chat-websocket.ts';
import { TaskEventsWebSocketClient } from '../src/services/task-events-websocket.ts';
import { useChatStore } from '../src/state/chat-store.ts';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';

// Mock WebSocket class for Node environment testing
class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = 0; // CONNECTING
  sentPayloads: string[] = [];

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);

    // Auto open in microtask
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.emit('open');
      if (this.onopen) this.onopen();
    });
  }

  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: (event: unknown) => void;
  onclose?: () => void;

  send(data: string): void {
    this.sentPayloads.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.emit('close');
    if (this.onclose) this.onclose();
  }

  // Helper for test to simulate server push
  simulateServerMessage(msg: Record<string, unknown>): void {
    const raw = JSON.stringify(msg);
    this.emit('message', { data: raw });
    if (this.onmessage) this.onmessage({ data: raw });
  }
}

test('Chat streaming via WebSocket accumulates deltas into chatStore', async () => {
  const originalWs = globalThis.WebSocket;
  MockWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('valid-chat-token');
  const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });

  try {
    const wsClient = new ChatWebSocketClient({
      client,
      conversationId: 'conv-123',
    });

    await wsClient.connect();

    // Wait for connection to open
    await new Promise((r) => setTimeout(r, 10));
    const mockWs = MockWebSocket.instances[0];
    assert.ok(mockWs);
    assert.match(mockWs.url, /token=valid-chat-token/);
    assert.match(mockWs.url, /conversationId=conv-123/);

    // 1. Send chat message
    wsClient.sendMessage({ content: 'Buat rencana sprint' });
    assert.equal(mockWs.sentPayloads.length, 1);
    const sent = JSON.parse(mockWs.sentPayloads[0] ?? '{}');
    assert.equal(sent.type, 'chat.send');
    assert.equal(sent.content, 'Buat rencana sprint');

    // 2. Server emits message.created
    mockWs.simulateServerMessage({
      type: 'message.created',
      message: {
        id: 'msg-stream-1',
        conversationId: 'conv-123',
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      },
    });

    const storeState1 = useChatStore.getState();
    assert.equal(storeState1.isStreaming, true);
    assert.equal(storeState1.streamingMessageId, 'msg-stream-1');

    // 3. Server emits streaming deltas
    mockWs.simulateServerMessage({ type: 'message.delta', delta: 'Tentu, ' });
    mockWs.simulateServerMessage({ type: 'message.delta', delta: 'ini rencana ' });
    mockWs.simulateServerMessage({ type: 'message.delta', delta: 'sprint Anda.' });

    const storeState2 = useChatStore.getState();
    assert.equal(storeState2.streamingDelta, 'Tentu, ini rencana sprint Anda.');

    // 4. Server emits message.completed
    mockWs.simulateServerMessage({
      type: 'message.completed',
      message: {
        id: 'msg-stream-1',
        conversationId: 'conv-123',
        role: 'assistant',
        content: 'Tentu, ini rencana sprint Anda.',
        createdAt: new Date().toISOString(),
      },
      modelUsed: 'claude-3-5-sonnet',
    });

    const storeState3 = useChatStore.getState();
    assert.equal(storeState3.isStreaming, false);
    assert.equal(storeState3.streamingDelta, '');
    const finalMsg = storeState3.messages.find((m) => m.id === 'msg-stream-1');
    assert.ok(finalMsg);
    assert.equal(finalMsg.content, 'Tentu, ini rencana sprint Anda.');

    wsClient.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
  }
});

test('Chat streaming cancellation stops active stream', async () => {
  const originalWs = globalThis.WebSocket;
  MockWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('valid-chat-token');
  const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });

  try {
    const wsClient = new ChatWebSocketClient({
      client,
      conversationId: 'conv-cancel-test',
    });

    await wsClient.connect();
    await new Promise((r) => setTimeout(r, 10));
    const mockWs = MockWebSocket.instances[0];
    assert.ok(mockWs);

    // Start streaming message
    mockWs.simulateServerMessage({
      type: 'message.created',
      message: {
        id: 'msg-cancel-1',
        conversationId: 'conv-cancel-test',
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      },
    });
    mockWs.simulateServerMessage({ type: 'message.delta', delta: 'Bagian awal...' });

    assert.equal(useChatStore.getState().isStreaming, true);

    // User triggers cancellation
    wsClient.cancelActiveStream();

    const lastSent = JSON.parse(mockWs.sentPayloads[mockWs.sentPayloads.length - 1] ?? '{}');
    assert.equal(lastSent.type, 'chat.cancel');
    assert.equal(useChatStore.getState().isStreaming, false);

    wsClient.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
  }
});

test('Task events WebSocket client tracks last_event_id for reconnect replay', async () => {
  const originalWs = globalThis.WebSocket;
  MockWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('task-event-token');
  const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });

  const receivedEvents: TaskEventEnvelope[] = [];

  try {
    const wsClient = new TaskEventsWebSocketClient({
      client,
      taskId: 'task-replay-99',
      onEvent: (evt) => {
        receivedEvents.push(evt);
      },
    });

    await wsClient.connect();
    await new Promise((r) => setTimeout(r, 10));
    const mockWs1 = MockWebSocket.instances[0];
    assert.ok(mockWs1);
    assert.match(mockWs1.url, /taskId=task-replay-99/);

    // Simulate event arrives with ID evt-100
    mockWs1.simulateServerMessage({
      id: 'evt-100',
      taskId: 'task-replay-99',
      userId: 'user-1',
      eventType: 'task.progress',
      payload: { progress: 50 },
      createdAt: new Date().toISOString(),
    });

    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0]?.id, 'evt-100');

    // Simulate connection drop and reconnect
    mockWs1.close();
    await new Promise((r) => setTimeout(r, 1500)); // wait for reconnect

    const mockWs2 = MockWebSocket.instances[1];
    assert.ok(mockWs2);
    // Verify last_event_id is passed so backend can replay missed events
    assert.match(mockWs2.url, /last_event_id=evt-100/);

    wsClient.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
  }
});
