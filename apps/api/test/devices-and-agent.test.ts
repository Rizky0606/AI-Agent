import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DeviceConnectionManager } from '../src/services/device-connection-manager.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Devices & Agent WSS: registration, online status, heartbeat, and offline transition', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const deviceManager = new DeviceConnectionManager();

  const user = await auth.register('windows-user@example.com', 'ValidPassword123!');
  const token = user.accessToken;

  let lastSeenUpdated = false;

  const app = await buildApp({
    auth,
    deviceManager,
    updateDeviceLastSeen: async () => {
      lastSeenUpdated = true;
    },
    listDevices: async () => [
      { id: 'win-dev-99', name: 'Workstation 99', platform: 'windows', lastSeenAt: new Date() },
    ],
    registerDevice: async (_userId, input) => ({
      id: 'win-dev-99',
      name: input.name,
      platform: input.platform,
    }),
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addressInfo = app.server.address() as { port: number };
  const port = addressInfo.port;

  try {
    // 1. Initial check - device is registered in DB but currently offline
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listRes.statusCode, 200);
    const body1 = listRes.json();
    assert.equal(body1.devices.length, 1);
    assert.equal(body1.devices[0].id, 'win-dev-99');
    assert.equal(body1.devices[0].isOnline, false);
    assert.equal(deviceManager.isDeviceOnline('win-dev-99'), false);

    // 2. Connect outbound WSS from Windows Agent
    const wsUrl = `ws://127.0.0.1:${port}/v1/agent/ws?token=${encodeURIComponent(token)}&deviceId=win-dev-99&platform=windows`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Wait for server to process websocket connection handler
    await new Promise((r) => setTimeout(r, 50));

    // Device should now be marked online
    assert.equal(deviceManager.isDeviceOnline('win-dev-99'), true);
    assert.equal(deviceManager.hasOnlineDeviceForUser(user.user.id, 'windows'), true);

    // Check GET /v1/devices reflects online status
    const listRes2 = await app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${token}` },
    });
    const body2 = listRes2.json();
    assert.equal(body2.devices[0].isOnline, true);

    // 3. Handshake & Heartbeat
    ws.send(JSON.stringify({ type: 'device.handshake', deviceId: 'win-dev-99' }));
    ws.send(JSON.stringify({ type: 'pong' }));

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(lastSeenUpdated, true);

    // 4. Disconnect WSS -> device transitions to offline
    ws.close();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(deviceManager.isDeviceOnline('win-dev-99'), false);
    assert.equal(deviceManager.hasOnlineDeviceForUser(user.user.id, 'windows'), false);

    const listRes3 = await app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listRes3.json().devices[0].isOnline, false);
  } finally {
    await app.close();
  }
});
