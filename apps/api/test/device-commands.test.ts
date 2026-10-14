import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DeviceConnectionManager } from '../src/services/device-connection-manager.ts';
import { connectDeviceAgent, type DeviceAgentSession } from './support/device-agent.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';
const bridgeToken = 'internal-bridge-token-for-device-command-tests';

/** Answers only the first dispatched command; later ones stay silent to exercise the timeout. */
const answerFirstCommand = (stdout: string) => {
  let answered = false;
  return (frame: Record<string, unknown>, send: (f: Record<string, unknown>) => void): void => {
    if (answered) return;
    answered = true;
    send({
      type: 'command.result',
      commandId: frame['commandId'],
      success: true,
      result: { exitCode: 0, stdout, stderr: '', truncated: false, durationMs: 12 },
    });
  };
};

test('Internal device routes: token-guarded presence and command dispatch over the agent session', async () => {
  const auth = createAuthService(new InMemoryAuthRepository(), secret);
  const deviceManager = new DeviceConnectionManager();
  const owner = await auth.register('device-owner@example.com', 'ValidPassword123!');
  const stranger = await auth.register('device-stranger@example.com', 'ValidPassword123!');

  const app = await buildApp({
    auth,
    deviceManager,
    internalBridgeToken: bridgeToken,
    registerAgent: async (_userId, input) => ({ id: crypto.randomUUID(), ...input }),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };

  let session: DeviceAgentSession | null = null;

  try {
    session = await connectDeviceAgent({
      port,
      token: owner.accessToken,
      name: 'Command Target',
      onCommandExecute: answerFirstCommand('workstation-42\r\n'),
    });
    const deviceId = session.deviceId;

    // 1. Every internal route rejects a missing or wrong service token.
    const anonymous = await app.inject({ method: 'GET', url: '/v1/internal/devices?userId=x' });
    assert.equal(anonymous.statusCode, 401);
    const wrongToken = await app.inject({
      method: 'POST',
      url: '/v1/internal/device-commands',
      headers: { 'x-internal-token': 'not-the-token' },
      payload: { userId: owner.user.id, deviceId, command: 'hostname' },
    });
    assert.equal(wrongToken.statusCode, 401);

    // 2. Presence reflects the live session, keyed by the id the server issued.
    const presence = await app.inject({
      method: 'GET',
      url: `/v1/internal/devices?userId=${owner.user.id}&platform=windows`,
      headers: { 'x-internal-token': bridgeToken },
    });
    assert.equal(presence.statusCode, 200);
    assert.deepEqual(presence.json().devices, [deviceId]);

    // 3. Dispatch reaches the socket and returns what the device reported.
    const dispatched = await app.inject({
      method: 'POST',
      url: '/v1/internal/device-commands',
      headers: { 'x-internal-token': bridgeToken },
      payload: { userId: owner.user.id, deviceId, command: 'hostname', timeoutMs: 5_000 },
    });
    assert.equal(dispatched.statusCode, 200);
    const result = dispatched.json().result;
    assert.equal(result.success, true);
    assert.equal(result.result.stdout, 'workstation-42\r\n');

    const executed = session.frames.find((frame) => frame['type'] === 'command.execute');
    assert.equal(executed?.['command'], 'hostname');
    assert.equal(executed?.['commandId'], result.commandId);

    // 4. A device that is not connected is reported as offline, never as an empty success.
    const offline = await app.inject({
      method: 'POST',
      url: '/v1/internal/device-commands',
      headers: { 'x-internal-token': bridgeToken },
      payload: { userId: owner.user.id, deviceId: 'win-dev-absent', command: 'hostname' },
    });
    assert.equal(offline.statusCode, 404);
    assert.equal(offline.json().error.code, 'DEVICE_OFFLINE');

    // 5. Another user's device is indistinguishable from an offline one.
    const foreign = await app.inject({
      method: 'POST',
      url: '/v1/internal/device-commands',
      headers: { 'x-internal-token': bridgeToken },
      payload: { userId: stranger.user.id, deviceId, command: 'hostname' },
    });
    assert.equal(foreign.statusCode, 404);
    assert.equal(foreign.json().error.code, 'DEVICE_OFFLINE');

    // 6. A device that never answers fails the dispatch instead of hanging forever.
    const silent = await app.inject({
      method: 'POST',
      url: '/v1/internal/device-commands',
      headers: { 'x-internal-token': bridgeToken },
      payload: { userId: owner.user.id, deviceId, command: 'hostname', timeoutMs: 1_000 },
    });
    assert.equal(silent.statusCode, 504);
    assert.equal(silent.json().error.code, 'DEVICE_DISPATCH_FAILED');
  } finally {
    session?.close();
    await app.close();
  }
});

test('Internal device routes are not mounted without a service token', async () => {
  const auth = createAuthService(new InMemoryAuthRepository(), secret);
  const app = await buildApp({ auth, deviceManager: new DeviceConnectionManager() });

  try {
    const response = await app.inject({ method: 'GET', url: '/v1/internal/devices?userId=any' });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
