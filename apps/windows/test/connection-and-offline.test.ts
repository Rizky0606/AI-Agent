import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { AgentConnection, type ConnectionStatus } from '../src/connection/agent-connection.ts';
import { DeviceIdentityManager } from '../src/connection/device-identity.ts';
import { CapabilityRegistry } from '../src/security/capability-registry.ts';
import { PathValidator } from '../src/security/path-validator.ts';
import { CommandExecutor } from '../src/security/command-executor.ts';
import { DeviceConnectionManager } from '../../api/src/services/device-connection-manager.ts';
import { TaskExecutor } from '../../agent-worker/src/task-executor.ts';
import type { TaskEventEnvelope, TaskModel, TaskRepository } from '@personal-ai-os/shared';

// Mock WebSocket implementation for unit test
class MockAgentWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockAgentWebSocket.CONNECTING;
  sentMessages: string[] = [];
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    setTimeout(() => {
      this.readyState = MockAgentWebSocket.OPEN;
      this.emit('open');
      if (typeof this.onopen === 'function') this.onopen();
    }, 10);
  }

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockAgentWebSocket.CLOSED;
    this.emit('close');
    if (typeof this.onclose === 'function') this.onclose();
  }

  simulateServerMessage(msg: Record<string, unknown>): void {
    const event = { data: JSON.stringify(msg) };
    this.emit('message', event);
    if (typeof this.onmessage === 'function') this.onmessage(event);
  }
}

test('AgentConnection: Outbound connection sends handshake and tracks heartbeat', async () => {
  const originalWs = globalThis.WebSocket;
  const createdSockets: MockAgentWebSocket[] = [];

  globalThis.WebSocket = class extends MockAgentWebSocket {
    constructor(url: string) {
      super(url);
      createdSockets.push(this);
    }
  } as unknown as typeof WebSocket;

  try {
    const identityMgr = new DeviceIdentityManager({
      id: 'win-test-01',
      name: 'Test Windows Machine',
    });
    const registry = new CapabilityRegistry();
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    const statuses: ConnectionStatus[] = [];
    const connection = new AgentConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'jwt-auth-token-123',
      identity: identityMgr.getIdentity(),
      executor,
      heartbeatIntervalMs: 100,
      onStatusChange: (st) => statuses.push(st),
    });

    await connection.connect();
    await new Promise((r) => setTimeout(r, 30));

    const mockWs = createdSockets[0];
    assert.ok(mockWs);
    assert.equal(connection.getStatus(), 'connected');

    // Verify handshake was sent
    assert.ok(mockWs.sentMessages.length > 0);
    const handshake = JSON.parse(mockWs.sentMessages[0]!);
    assert.equal(handshake.type, 'device.handshake');
    assert.equal(handshake.device.id, 'win-test-01');

    // Simulate ping from server -> client responds with pong
    mockWs.simulateServerMessage({ type: 'ping' });
    const lastSent = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]!);
    assert.equal(lastSent.type, 'pong');

    connection.disconnect();
    assert.equal(connection.getStatus(), 'disconnected');
  } finally {
    globalThis.WebSocket = originalWs;
  }
});

test('AgentConnection: Reconnects upon unexpected socket termination', async () => {
  const originalWs = globalThis.WebSocket;
  let socketCount = 0;

  globalThis.WebSocket = class extends MockAgentWebSocket {
    constructor(url: string) {
      super(url);
      socketCount++;
    }
  } as unknown as typeof WebSocket;

  try {
    const identityMgr = new DeviceIdentityManager({ id: 'win-test-02' });
    const registry = new CapabilityRegistry();
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    const connection = new AgentConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'jwt-auth-token-123',
      identity: identityMgr.getIdentity(),
      executor,
      maxReconnectAttempts: 3,
    });

    await connection.connect();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(socketCount, 1);

    // Simulate unexpected drop
    connection.simulateSocketDrop();

    // Reconnect status
    assert.equal(connection.getStatus(), 'reconnecting');

    connection.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
  }
});

test('Offline behavior: Task requiring Windows fails explicitly when agent is offline', async () => {
  const deviceManager = new DeviceConnectionManager();

  // No devices connected for user 'user-alice'
  assert.equal(deviceManager.hasOnlineDeviceForUser('user-alice', 'windows'), false);

  const events: TaskEventEnvelope[] = [];
  const fakeBroadcaster = {
    publish: (ev: TaskEventEnvelope) => events.push(ev),
  };

  let updatedTask: TaskModel | null = null;
  const mockTaskRepo: Partial<TaskRepository> = {
    getTask: async (): Promise<TaskModel | null> => ({
      id: 'task-win-offline-01',
      userId: 'user-alice',
      projectId: 'proj-01',
      status: 'queued',
      kind: 'windows_command',
      payload: { target: 'windows', command: 'dir' },
      priority: 0,
      attempt: 0,
      maxAttempts: 3,
      progress: 0,
      idempotencyKey: null,
      error: null,
      checkpoint: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    updateTaskStatus: async (_uId, _tId, nextStatus, updates): Promise<TaskModel> => {
      updatedTask = {
        id: 'task-win-offline-01',
        userId: 'user-alice',
        projectId: 'proj-01',
        status: nextStatus,
        kind: 'windows_command',
        payload: { target: 'windows' },
        priority: 0,
        attempt: 0,
        maxAttempts: 3,
        progress: 0,
        idempotencyKey: null,
        error: updates?.error ?? null,
        checkpoint: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return updatedTask;
    },
    createTaskEvent: async (_uId, _tId, eventType, payload) => ({
      id: 'evt-01',
      eventId: 'evt-01',
      taskId: 'task-win-offline-01',
      userId: 'user-alice',
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    }),
  };

  const executor = new TaskExecutor(mockTaskRepo as TaskRepository, fakeBroadcaster, {
    deviceManager,
  });

  await executor.execute({
    taskId: 'task-win-offline-01',
    userId: 'user-alice',
    projectId: 'proj-01',
    kind: 'windows_command',
    attempt: 0,
    maxAttempts: 3,
  });

  // Verify task was marked failed immediately with explicit offline reason
  assert.ok(updatedTask);
  assert.equal((updatedTask as TaskModel).status, 'failed');
  assert.ok((updatedTask as TaskModel).error?.includes('Windows Agent sedang offline'));

  // Verify task.failed event was broadcasted
  const failEvent = events.find((e) => e.eventType === 'task.failed');
  assert.ok(failEvent);
  assert.equal(failEvent.payload.offlineReason, 'device_unreachable');
  assert.equal(failEvent.payload.platform, 'windows');
});
