import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ApiClient, ApiError, deriveWsUrl } from '../src/api/client.ts';
import { TaskEventsStream } from '../src/connection/events-stream.ts';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';

class MockWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.OPEN;
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(): void {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emitFrame(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const envelope = (overrides: Partial<TaskEventEnvelope>): TaskEventEnvelope => ({
  id: 'evt-1',
  taskId: 'task-1',
  userId: 'user-1',
  eventType: 'task.progress',
  payload: { progress: 50 },
  createdAt: '2026-10-13T00:00:00.000Z',
  ...overrides,
});

const installMockSockets = (): { sockets: MockWebSocket[]; restore: () => void } => {
  const original = globalThis.WebSocket;
  const sockets: MockWebSocket[] = [];
  globalThis.WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  } as unknown as typeof WebSocket;
  return { sockets, restore: () => void (globalThis.WebSocket = original) };
};

test('ApiClient: sends bearer token, unwraps error envelopes, and maps 204 to undefined', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const responses: Response[] = [
    new Response(JSON.stringify({ tasks: [{ id: 'task-1' }] }), { status: 200 }),
    new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Task not found' } }), {
      status: 404,
    }),
    new Response(null, { status: 204 }),
  ];

  const client = new ApiClient({
    baseUrl: () => 'http://127.0.0.1:8080/',
    token: () => 'jwt-abc',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift()!;
    },
  });

  assert.equal(deriveWsUrl(client.baseUrl), 'ws://127.0.0.1:8080');

  const listed = await client.listTasks({ status: 'running' });
  assert.equal(listed.tasks[0]!.id, 'task-1');
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8080/v1/tasks?status=running');
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)['Authorization'],
    'Bearer jwt-abc',
  );

  await assert.rejects(
    () => client.getTask('missing'),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'NOT_FOUND' && error.status === 404,
  );

  const cancelled = await client.cancelTask('task-1');
  assert.equal(cancelled, undefined);
  assert.equal(calls[2]!.url, 'http://127.0.0.1:8080/v1/tasks/task-1/cancel');
  assert.equal(calls[2]!.init.method, 'POST');
});

test('ApiClient: approval decisions target approve/deny endpoints and previews truncate', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new ApiClient({
    baseUrl: () => 'http://127.0.0.1:8080',
    token: () => 'jwt-abc',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/download')) return new Response('abcdefghij');
      return new Response(JSON.stringify({ approval: { id: 'ap-1', status: 'approved' } }), {
        status: 200,
      });
    },
  });

  const decided = await client.decideApproval('ap-1', 'approve', 'looks safe');
  assert.equal(decided.approval.status, 'approved');
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8080/v1/approvals/ap-1/approve');
  assert.equal(calls[0]!.init.body, JSON.stringify({ reason: 'looks safe' }));

  await client.decideApproval('ap-1', 'deny');
  assert.equal(calls[1]!.url, 'http://127.0.0.1:8080/v1/approvals/ap-1/deny');

  const preview = await client.previewArtifact('art-1', 4);
  assert.equal(preview.content, 'abcd');
  assert.equal(preview.truncated, true);
  assert.equal(calls[2]!.url, 'http://127.0.0.1:8080/v1/artifacts/art-1/download');
});

test('TaskEventsStream: subscribes with task scope, tracks lastEventId, and replays after reconnect', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, restore } = installMockSockets();

  try {
    const received: TaskEventEnvelope[] = [];
    const statuses: string[] = [];
    const stream = new TaskEventsStream({
      serverUrl: () => 'https://ai.example.test',
      token: () => 'jwt-abc',
      taskId: () => 'task-1',
      onEvent: (event) => received.push(event),
      onStatusChange: (status) => statuses.push(status),
    });

    stream.connect();
    assert.match(sockets[0]!.url, /^wss:\/\/ai\.example\.test\/v1\/events\/ws\?/);
    assert.match(sockets[0]!.url, /taskId=task-1/);
    assert.match(sockets[0]!.url, /token=jwt-abc/);
    assert.equal(statuses.at(-1), 'connected');

    sockets[0]!.emitFrame(envelope({ id: 'evt-1' }));
    sockets[0]!.emitFrame(envelope({ id: 'evt-2', eventType: 'task.completed', payload: {} }));
    assert.deepEqual(
      received.map((event) => event.eventType),
      ['task.progress', 'task.completed'],
    );

    sockets[0]!.close();
    assert.equal(statuses.at(-1), 'reconnecting');
    t.mock.timers.tick(1000);
    assert.equal(sockets.length, 2);
    assert.match(sockets[1]!.url, /last_event_id=evt-2/);

    stream.disconnect();
    assert.equal(statuses.at(-1), 'disconnected');
  } finally {
    restore();
  }
});

test('TaskEventsStream: stays disconnected when the task scope or token is missing', () => {
  const received: TaskEventEnvelope[] = [];
  const statuses: string[] = [];
  const stream = new TaskEventsStream({
    serverUrl: () => 'https://ai.example.test',
    token: () => '',
    taskId: () => null,
    onEvent: (event) => received.push(event),
    onStatusChange: (status) => statuses.push(status),
  });

  stream.connect();
  assert.deepEqual(statuses, ['disconnected']);
  assert.deepEqual(received, []);
});
