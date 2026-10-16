import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import {
  DeviceConnectionManager,
  type DevicePresenceRecord,
} from '../src/services/device-connection-manager.ts';
import {
  connectDeviceAgent,
  storedPublicKey,
  waitForDeviceOffline,
} from './support/device-agent.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Devices & Agent WSS: the server names the device, tracks presence, and drops it on disconnect', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const deviceManager = new DeviceConnectionManager();
  /** Stands in for the `devices` table: registration writes it, `GET /v1/devices` reads it. */
  const rows: Array<{ id: string; name: string; platform: string; publicKey: string }> = [
    { id: 'win-dev-99', name: 'Workstation 99', platform: 'windows', publicKey: 'stored-key' },
  ];
  let nextId = 1;

  const user = await auth.register('windows-user@example.com', 'ValidPassword123!');

  const app = await buildApp({
    auth,
    deviceManager,
    listDevices: async () =>
      rows.map((row) => ({ ...row, lastSeenAt: new Date('2026-01-01T00:00:00.000Z') })),
    registerDevice: async (_userId, input) => ({ id: 'win-dev-99', ...input }),
    registerAgent: async (_userId, input) => {
      const id = `00000000-0000-4000-8000-00000000000${nextId++}`;
      rows.push({ id, ...input });
      return { id, name: input.name, platform: input.platform };
    },
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;

  try {
    // 1. A registered device that has never connected is reported offline.
    const before = await app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    assert.equal(before.statusCode, 200);
    const beforeDevices = before.json().devices as Array<{ id: string; isOnline: boolean }>;
    assert.deepEqual(
      beforeDevices.map((device) => [device.id, device.isOnline]),
      [['win-dev-99', false]],
    );

    // 2. The agent connects, proves its key, and learns the id the server assigned.
    const session = await connectDeviceAgent({
      port,
      token: user.accessToken,
      name: 'Workstation 99',
    });

    assert.equal(rows.length, 2, 'the agent key must add exactly one device row');
    assert.deepEqual(rows[1], {
      id: session.deviceId,
      name: 'Workstation 99',
      platform: 'windows',
      publicKey: storedPublicKey(session),
    });
    assert.match(session.deviceId, /^[0-9a-f-]{36}$/, 'the id must be a server-issued uuid');

    assert.equal(deviceManager.isDeviceOnline(session.deviceId), true);
    assert.deepEqual(deviceManager.listOnlineDeviceIds(user.user.id, 'windows'), [session.deviceId]);

    // 3. The live session shows up next to the registered row.
    const during = await app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    const duringDevices = during.json().devices as Array<{ id: string; isOnline: boolean }>;
    assert.deepEqual(
      duringDevices.map((device) => [device.id, device.isOnline]),
      [
        ['win-dev-99', false],
        [session.deviceId, true],
      ],
    );

    // 4. Heartbeat: the agent pings, the server answers, and the session survives.
    const pong = session.waitForFrame((frame) => frame['type'] === 'pong');
    session.send({ type: 'ping' });
    await pong;
    assert.equal(deviceManager.isDeviceOnline(session.deviceId), true);

    // 5. Disconnect -> offline, while the registered row stays.
    const wentOffline = waitForDeviceOffline(deviceManager, session.deviceId);
    session.close();
    await wentOffline;

    assert.equal(deviceManager.isDeviceOnline(session.deviceId), false);
    assert.deepEqual(deviceManager.listOnlineDeviceIds(user.user.id, 'windows'), []);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    assert.deepEqual(
      (after.json().devices as Array<{ id: string; isOnline: boolean }>).map((device) => [
        device.id,
        device.isOnline,
      ]),
      [
        ['win-dev-99', false],
        [session.deviceId, false],
      ],
    );
  } finally {
    await app.close();
  }
});

test('Push token registration is scoped to the caller own device rows', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const owner = await auth.register('push-owner@example.com', 'ValidPassword123!');
  const stranger = await auth.register('push-stranger@example.com', 'ValidPassword123!');
  const stored: Array<{ userId: string; deviceId: string; pushToken: string }> = [];

  const app = await buildApp({
    auth,
    listDevices: async () => [],
    setDevicePushToken: async (userId, deviceId, pushToken) => {
      if (deviceId !== 'device-owned-by-owner' || userId !== owner.user.id) return false;
      stored.push({ userId, deviceId, pushToken });
      return true;
    },
  });

  const accepted = await app.inject({
    method: 'POST',
    url: '/v1/devices/device-owned-by-owner/push-token',
    headers: { authorization: `Bearer ${owner.accessToken}` },
    payload: { pushToken: 'fcm-token-abc' },
  });
  assert.equal(accepted.statusCode, 204);
  assert.deepEqual(stored, [
    { userId: owner.user.id, deviceId: 'device-owned-by-owner', pushToken: 'fcm-token-abc' },
  ]);

  const foreign = await app.inject({
    method: 'POST',
    url: '/v1/devices/device-owned-by-owner/push-token',
    headers: { authorization: `Bearer ${stranger.accessToken}` },
    payload: { pushToken: 'fcm-token-abc' },
  });
  assert.equal(foreign.statusCode, 404);

  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/devices/device-owned-by-owner/push-token',
    headers: { authorization: `Bearer ${owner.accessToken}` },
    payload: { pushToken: '' },
  });
  assert.equal(invalid.statusCode, 400);

  await app.close();
});

test('DeviceConnectionManager: persists presence across restart within bounded grace window and emits audit events', async () => {
  const auditLogs: Array<{ action: string; deviceId: string; userId: string }> = [];
  const presenceStore = new Map<string, DevicePresenceRecord>();

  const customPresenceStore = {
    savePresence: (record: DevicePresenceRecord) => {
      presenceStore.set(record.deviceId, record);
    },
    getPresence: (deviceId: string) => presenceStore.get(deviceId) ?? null,
    listRecentPresences: (userId: string, platform?: string) => {
      const list: DevicePresenceRecord[] = [];
      for (const rec of presenceStore.values()) {
        if (rec.userId === userId && (!platform || rec.platform === platform)) {
          list.push(rec);
        }
      }
      return list;
    },
    updateLastSeen: (deviceId: string, lastSeenAt: string) => {
      const rec = presenceStore.get(deviceId);
      if (rec) rec.lastSeenAt = lastSeenAt;
    },
  };

  const auditSink = {
    logDeviceEvent: (event: { action: string; deviceId: string; userId: string }) => {
      auditLogs.push(event);
    },
  };

  // 1. First server instance: device registers connection
  const manager1 = new DeviceConnectionManager({
    presenceStore: customPresenceStore,
    auditSink,
    presenceGraceMs: 5_000,
  });

  const mockSocket = { send: () => {}, close: () => {} };
  manager1.registerConnection('dev-persistent-1', 'user-1', 'windows', mockSocket, { name: 'DevPC' });

  assert.equal(manager1.isDeviceOnline('dev-persistent-1'), true);
  assert.deepEqual(manager1.listOnlineDeviceIds('user-1', 'windows'), ['dev-persistent-1']);
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0]!.action, 'device.connected');

  // 2. Simulate server restart: new manager instance starts with the same persistent presence store
  const manager2 = new DeviceConnectionManager({
    presenceStore: customPresenceStore,
    auditSink,
    presenceGraceMs: 5_000,
  });

  // Despite no active socket in memory on manager2 yet, presence is boundedly retained across restart!
  assert.equal(manager2.isDeviceOnline('dev-persistent-1'), true);
  assert.deepEqual(manager2.listOnlineDeviceIds('user-1', 'windows'), ['dev-persistent-1']);

  // 3. Unregister / disconnect emits audit log and updates store
  manager1.unregisterConnection('dev-persistent-1', mockSocket);
  assert.equal(auditLogs.length, 2);
  assert.equal(auditLogs[1]!.action, 'device.disconnected');
});
