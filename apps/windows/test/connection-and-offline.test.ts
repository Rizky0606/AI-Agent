import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { AgentConnection, type ConnectionStatus } from '../src/connection/agent-connection.ts';
import { DeviceIdentityManager } from '../src/connection/device-identity.ts';
import { CapabilityRegistry } from '../src/security/capability-registry.ts';
import { PathValidator } from '../src/security/path-validator.ts';
import { CommandExecutor } from '../src/security/command-executor.ts';
import type { DeviceCommandResult } from '../../api/src/services/device-connection-manager.ts';
import {
  parseDevicePublicKey,
  verifyDeviceSignature,
} from '../../api/src/services/device-identity.ts';
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
    // Opened on a microtask so `await connection.connect()` always observes the open handler.
    queueMicrotask(() => {
      this.readyState = MockAgentWebSocket.OPEN;
      this.emit('open');
      if (typeof this.onopen === 'function') this.onopen();
    });
  }

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  private readonly sendWaiters: Array<{
    matches: (frame: Record<string, unknown>) => boolean;
    resolve: (frame: Record<string, unknown>) => void;
  }> = [];

  /** Resolves with the next frame matching `matches`, so tests wait on real sends, not on timers. */
  waitForSend(matches: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    this.sendWaiters.push({ matches, resolve });
    return promise;
  }

  send(data: string): void {
    this.sentMessages.push(data);
    const frame = JSON.parse(data) as Record<string, unknown>;
    const index = this.sendWaiters.findIndex((waiter) => waiter.matches(frame));
    if (index === -1) return;
    const [waiter] = this.sendWaiters.splice(index, 1);
    waiter?.resolve(frame);
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

test('AgentConnection: signs the server challenge before it counts as a device', async () => {
  const originalWs = globalThis.WebSocket;
  const createdSockets: MockAgentWebSocket[] = [];

  globalThis.WebSocket = class extends MockAgentWebSocket {
    constructor(url: string) {
      super(url);
      createdSockets.push(this);
    }
  } as unknown as typeof WebSocket;

  try {
    const identityMgr = new DeviceIdentityManager({ name: 'Test Windows Machine' });
    const registry = new CapabilityRegistry();
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    const statuses: ConnectionStatus[] = [];
    const serverIds: string[] = [];
    const connection = new AgentConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'jwt-auth-token-123',
      identity: identityMgr.getIdentity(),
      keyStore: identityMgr.keys,
      executor,
      heartbeatIntervalMs: 100,
      onStatusChange: (st) => statuses.push(st),
      onDeviceId: (id) => serverIds.push(id),
    });

    await connection.connect();
    const mockWs = createdSockets[0];
    assert.ok(mockWs);

    // The agent never claims an id of its own: the server refuses a claimed one.
    assert.ok(!mockWs.url.includes('deviceId'), 'the connect URL must not carry a deviceId');
    assert.equal(connection.getStatus(), 'connecting');
    assert.equal(mockWs.sentMessages.length, 0, 'nothing is sent before the server challenge');

    const challenge = 'device-handshake:test-nonce-01';
    const handshakeSent = mockWs.waitForSend((frame) => frame['type'] === 'device.handshake');
    mockWs.simulateServerMessage({ type: 'device.challenge', challenge });
    const handshake = await handshakeSent;

    assert.equal(handshake['name'], 'Test Windows Machine');
    assert.equal(handshake['platform'], 'windows');
    const publicKey = parseDevicePublicKey(handshake['publicKey']);
    assert.ok(publicKey, 'the handshake must carry a P-256 public key');
    assert.equal(publicKey.kty, 'EC');
    assert.equal(publicKey.crv, 'P-256');
    assert.equal(handshake['privateKey'], undefined, 'private key material must never leave the agent');

    const signature = String(handshake['signature']);
    assert.equal(
      verifyDeviceSignature({ publicKey, nonce: challenge, signature }),
      true,
      'the server must verify the agent signature with the agent public key',
    );
    assert.equal(
      verifyDeviceSignature({ publicKey, nonce: 'device-handshake:other-nonce', signature }),
      false,
      'a signature must not verify against a different challenge',
    );

    // The socket is not a device until the server acknowledges the key.
    assert.equal(connection.getStatus(), 'connecting');

    const serverDeviceId = '7d9c0f3a-2b1e-4a5c-9f60-1c2d3e4f5a6b';
    mockWs.simulateServerMessage({
      type: 'device.handshake_ack',
      deviceId: serverDeviceId,
      status: 'online',
    });
    assert.equal(connection.getStatus(), 'connected');
    assert.deepEqual(serverIds, [serverDeviceId]);

    const pongSent = mockWs.waitForSend((frame) => frame['type'] === 'pong');
    mockWs.simulateServerMessage({ type: 'ping' });
    await pongSent;

    // A refused handshake stops the agent instead of retrying a rejected credential forever.
    mockWs.simulateServerMessage({
      type: 'device.error',
      code: 'DEVICE_SIGNATURE_INVALID',
      message: 'signature mismatch',
    });
    assert.equal(connection.getStatus(), 'disconnected');
    assert.ok(statuses.includes('connected'));

    connection.disconnect();
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
    const identityMgr = new DeviceIdentityManager();
    const registry = new CapabilityRegistry();
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    const connection = new AgentConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'jwt-auth-token-123',
      identity: identityMgr.getIdentity(),
      keyStore: identityMgr.keys,
      executor,
      maxReconnectAttempts: 3,
    });

    await connection.connect();
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
  // Presence is answered by the API, which owns the agent sockets. Nothing is connected here, so
  // the executor must refuse to dispatch at all.
  const dispatcher = {
    listOnlineDevices: async (): Promise<string[]> => [],
    dispatchCommand: async (): Promise<DeviceCommandResult> => {
      throw new Error('dispatch must not be attempted while the device is offline');
    },
  };

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
    deviceDispatcher: dispatcher,
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
