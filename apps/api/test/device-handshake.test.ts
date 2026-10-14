import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DeviceConnectionManager } from '../src/services/device-connection-manager.ts';
import {
  connectDeviceAgent,
  DeviceHandshakeRefused,
  storedPublicKey,
} from './support/device-agent.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

const setup = async (options: { withRegistry?: boolean } = {}) => {
  const auth = createAuthService(new InMemoryAuthRepository(), secret);
  const deviceManager = new DeviceConnectionManager();
  const user = await auth.register('handshake@example.com', 'ValidPassword123!');
  const rows: Array<{ id: string; userId: string; name: string; publicKey: string }> = [];
  let nextId = 1;

  const app = await buildApp({
    auth,
    deviceManager,
    ...(options.withRegistry === false
      ? {}
      : {
          registerAgent: async (userId: string, input: { name: string; platform: string; publicKey: string }) => {
            // Same key -> same device, exactly as the repository does.
            const existing = rows.find((row) => row.publicKey === input.publicKey);
            if (existing) return { id: existing.id, name: existing.name, platform: input.platform };
            const row = {
              id: `00000000-0000-4000-8000-00000000000${nextId++}`,
              userId,
              name: input.name,
              publicKey: input.publicKey,
            };
            rows.push(row);
            return { id: row.id, name: row.name, platform: input.platform };
          },
        }),
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  return { app, deviceManager, user, rows, port };
};

test('Device handshake: a claimed deviceId is refused instead of trusted', async () => {
  const { app, deviceManager, user, port } = await setup();

  try {
    const refused = await connectDeviceAgent({
      port,
      token: user.accessToken,
      name: 'Impostor',
      claimedDeviceId: 'win-dev-claimed',
    }).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(refused instanceof DeviceHandshakeRefused);
    assert.equal(refused.code, 'DEVICE_IDENTITY_REQUIRED');
    assert.deepEqual(deviceManager.listOnlineDeviceIds(user.user.id), []);
  } finally {
    await app.close();
  }
});

test('Device handshake: a signature that does not match the key is refused', async () => {
  const { app, deviceManager, user, port } = await setup();

  try {
    const refused = await connectDeviceAgent({
      port,
      token: user.accessToken,
      name: 'Tampered',
      tamperSignature: true,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(refused instanceof DeviceHandshakeRefused);
    assert.equal(refused.code, 'DEVICE_SIGNATURE_INVALID');
    assert.deepEqual(deviceManager.listOnlineDeviceIds(user.user.id), []);
  } finally {
    await app.close();
  }
});

test('Device handshake: the same key keeps one device row, a new key gets its own', async () => {
  const { app, deviceManager, user, rows, port } = await setup();

  try {
    const first = await connectDeviceAgent({ port, token: user.accessToken, name: 'Host A' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.publicKey, storedPublicKey(first));
    first.close();

    // Reconnecting with the same key is the same device, not a new one.
    const reconnected = await connectDeviceAgent({
      port,
      token: user.accessToken,
      name: 'Host A',
      keyPair: first.keyPair,
    });
    assert.equal(reconnected.deviceId, first.deviceId);
    assert.equal(rows.length, 1);
    reconnected.close();

    // A second machine may share the name; identity is the key, so it gets its own row.
    const second = await connectDeviceAgent({ port, token: user.accessToken, name: 'Host A' });
    assert.notEqual(second.deviceId, first.deviceId);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      deviceManager.listOnlineDeviceIds(user.user.id, 'windows'),
      [second.deviceId],
    );
    second.close();
  } finally {
    await app.close();
  }
});

test('Device handshake: without a device registry no session is established', async () => {
  const { app, deviceManager, user, port } = await setup({ withRegistry: false });

  try {
    const refused = await connectDeviceAgent({ port, token: user.accessToken, name: 'Host B' }).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(refused instanceof DeviceHandshakeRefused);
    assert.equal(refused.code, 'DEVICE_REGISTRY_UNAVAILABLE');
    assert.deepEqual(deviceManager.listOnlineDeviceIds(user.user.id), []);
  } finally {
    await app.close();
  }
});

test('Device handshake: a private key offered as the public key is refused', async () => {
  const { app, deviceManager, user, port } = await setup();

  try {
    const session = await connectDeviceAgent({ port, token: user.accessToken, name: 'Host C' });
    session.close();

    const rejected = await new Promise<string>((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/v1/agent/ws?token=${encodeURIComponent(user.accessToken)}`,
      );
      ws.onmessage = (event: MessageEvent) => {
        const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (frame['type'] === 'device.challenge') {
          void crypto.subtle
            .exportKey('jwk', session.keyPair.privateKey)
            .then((jwk) =>
              ws.send(
                JSON.stringify({
                  type: 'device.handshake',
                  publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
                  signature: 'AAAA',
                  name: 'Leaky',
                  platform: 'windows',
                }),
              ),
            );
          return;
        }
        if (frame['type'] === 'device.error') resolve(String(frame['code']));
      };
    });

    assert.equal(rejected, 'DEVICE_KEY_INVALID');
    assert.deepEqual(deviceManager.listOnlineDeviceIds(user.user.id), []);
  } finally {
    await app.close();
  }
});
