import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DeviceConnectionManager } from '../src/services/device-connection-manager.ts';
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
