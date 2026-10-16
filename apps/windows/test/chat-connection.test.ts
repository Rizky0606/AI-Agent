import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ChatConnection, type ChatFrame, type ConnectionStatus } from '../src/connection/agent-connection.ts';

class MockChatWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockChatWebSocket.CONNECTING;
  sentMessages: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    this.readyState = MockChatWebSocket.OPEN;
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockChatWebSocket.CLOSED;
    this.onclose?.();
  }

  deliver(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Drops the socket the way a network failure does: no explicit close by the client. */
  drop(): void {
    this.readyState = MockChatWebSocket.CLOSED;
    this.onclose?.();
  }
}

const installMockWebSocket = () => {
  const original = globalThis.WebSocket;
  const sockets: MockChatWebSocket[] = [];
  globalThis.WebSocket = class extends MockChatWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  } as unknown as typeof WebSocket;
  return { sockets, restore: () => { globalThis.WebSocket = original; } };
};

test('ChatConnection: reports status, gates on auth, and reconnects after a drop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, restore } = installMockWebSocket();
  t.after(restore);

  const statuses: ConnectionStatus[] = [];
  const frames: ChatFrame[] = [];
  const connection = new ChatConnection({
    serverUrl: 'http://127.0.0.1:3000/',
    token: 'account-jwt',
    maxReconnectAttempts: 3,
    onStatusChange: (status) => statuses.push(status),
    onFrame: (frame) => frames.push(frame),
  });
  t.after(() => connection.disconnect());

  connection.connect();
  assert.equal(statuses.at(-1), 'connecting');
  const socket = sockets[0];
  assert.ok(socket);
  assert.equal(socket.url, 'ws://127.0.0.1:3000/v1/chat/ws?token=account-jwt');
  assert.deepEqual(socket.sentMessages, [], 'nothing is sent before the server authenticates the socket');

  // A queued message must wait for auth.ok, then arrive once.
  connection.sendChatMessage({ type: 'chat.send', content: 'hello' });
  assert.deepEqual(socket.sentMessages, []);
  socket.deliver({ type: 'auth.ok', userId: 'user-1' });
  assert.equal(statuses.at(-1), 'connected');
  assert.deepEqual(socket.sentMessages.map((raw) => JSON.parse(raw)), [{ type: 'chat.send', content: 'hello' }]);

  socket.deliver({ type: 'conversation.created', conversationId: 'conv-1' });
  socket.deliver({ type: 'message.created', conversationId: 'conv-1', message: { id: 'msg-1', role: 'assistant', content: '' } });
  assert.equal(frames.at(-1)?.type, 'message.created');

  // A dropped socket is announced and retried with backoff.
  socket.drop();
  assert.equal(statuses.at(-1), 'reconnecting');
  assert.ok(frames.some((frame) => frame.code === 'CHAT_CLOSED'));

  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2, 'a dropped socket must be reconnected');
  const reconnect = sockets[1];
  assert.ok(reconnect);
  reconnect.deliver({ type: 'auth.ok', userId: 'user-1' });
  assert.equal(statuses.at(-1), 'connected');
});

test('ChatConnection: gives up after the retry budget and says so', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, restore } = installMockWebSocket();
  t.after(restore);

  const statuses: ConnectionStatus[] = [];
  const frames: ChatFrame[] = [];
  const connection = new ChatConnection({
    serverUrl: 'http://127.0.0.1:3000',
    token: 'account-jwt',
    maxReconnectAttempts: 0,
    onStatusChange: (status) => statuses.push(status),
    onFrame: (frame) => frames.push(frame),
  });
  t.after(() => connection.disconnect());

  connection.connect();
  sockets[0]?.drop();

  assert.equal(statuses.at(-1), 'disconnected');
  assert.ok(frames.some((frame) => frame.code === 'CHAT_RECONNECT_EXHAUSTED'));
  assert.equal(sockets.length, 1, 'no reconnect is attempted past the budget');
});
