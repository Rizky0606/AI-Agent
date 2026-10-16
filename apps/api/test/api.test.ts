import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';

const setup = (options?: { dbHealthy?: boolean; redisHealthy?: boolean }) => {
  const devices = new Map<string, { id: string; name: string; platform: string }>();
  return buildApp({
    auth: createAuthService(new InMemoryAuthRepository(), 'test-secret-test-secret-test-secret-32'),
    health: {
      database: async () => options?.dbHealthy ?? true,
      redis: async () => options?.redisHealthy ?? true,
    },
    registerDevice: async (_userId, input) => {
      const device = { id: 'device-123', name: input.name, platform: input.platform };
      devices.set(device.id, device);
      return device;
    },
  });
};

test('health is public and readiness reflects dependencies', async () => {
  const app = await setup();
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');
  assert.ok(health.headers['x-request-id']);
  assert.ok(health.headers['x-trace-id']);

  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, 'ready');
  assert.equal(ready.json().checks.database, true);
  assert.equal(ready.json().checks.redis, true);
  await app.close();

  const brokenApp = await setup({ redisHealthy: false });
  const notReady = await brokenApp.inject({ method: 'GET', url: '/ready' });
  assert.equal(notReady.statusCode, 503);
  assert.equal(notReady.json().status, 'not_ready');
  assert.equal(notReady.json().checks.redis, false);
  await brokenApp.close();
});

test('registration validation and cross-user access denial are enforced', async () => {
  const app = await setup();
  const customTraceId = 'client-trace-123';
  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers: { 'x-trace-id': customTraceId },
    payload: { email: 'bad', password: 'short' },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers['x-trace-id'], customTraceId);
  assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');

  const alice = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email: 'a@example.com', password: 'alice-password-123' },
  });
  const bob = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email: 'b@example.com', password: 'bob-password-123' },
  });
  assert.equal(alice.statusCode, 201);
  const token = alice.json().accessToken as string;
  const bobId = bob.json().user.id as string;
  const denied = await app.inject({
    method: 'GET',
    url: `/v1/users/${bobId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(denied.statusCode, 404);
  await app.close();
});

test('login, refresh rotation, and reuse rejection via API', async () => {
  const app = await setup();
  await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email: 'carol@example.com', password: 'carol-password-123' },
  });

  const loginRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: 'carol@example.com', password: 'carol-password-123' },
  });
  assert.equal(loginRes.statusCode, 200);
  const { accessToken, refreshToken: token1 } = loginRes.json();
  assert.ok(accessToken);
  assert.ok(token1);

  const refreshRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: token1 },
  });
  assert.equal(refreshRes.statusCode, 200);
  const { refreshToken: token2 } = refreshRes.json();
  assert.notEqual(token1, token2);

  // Reusing token1 must be rejected
  const reuseRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: token1 },
  });
  assert.equal(reuseRes.statusCode, 401);
  assert.equal(reuseRes.json().error.code, 'REFRESH_REUSE');

  // Token2 should also be invalidated because reuse revokes all user sessions
  const invalidatedRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken: token2 },
  });
  assert.equal(invalidatedRes.statusCode, 401);

  await app.close();
});

test('device registration requires auth and creates device record', async () => {
  const app = await setup();

  // Unauthenticated request is rejected
  const unauthRes = await app.inject({
    method: 'POST',
    url: '/v1/devices',
    payload: { name: 'My Android Phone', platform: 'android' },
  });
  assert.equal(unauthRes.statusCode, 401);

  // Authenticated request succeeds
  const regRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email: 'dave@example.com', password: 'dave-password-123' },
  });
  const token = regRes.json().accessToken as string;

  const deviceRes = await app.inject({
    method: 'POST',
    url: '/v1/devices',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'My Android Phone', platform: 'android' },
  });
  assert.equal(deviceRes.statusCode, 201);
  assert.equal(deviceRes.json().device.name, 'My Android Phone');
  assert.equal(deviceRes.json().device.platform, 'android');

  // Logout invalidates session
  const logoutRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/logout',
    headers: { authorization: `Bearer ${token}` },
    payload: { refreshToken: regRes.json().refreshToken },
  });
  assert.equal(logoutRes.statusCode, 204);

  await app.close();
});

test('CORS preflight answers allowlisted browser origins only', async () => {
  const app = await setup();

  const allowed = await app.inject({
    method: 'OPTIONS',
    url: '/v1/tasks',
    headers: {
      origin: 'http://localhost:1420',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:1420');
  assert.equal(allowed.headers['access-control-allow-headers'], 'authorization,content-type');
  assert.equal(allowed.headers.vary, 'Origin');

  const tauri = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'tauri://localhost' },
  });
  assert.equal(tauri.headers['access-control-allow-origin'], 'tauri://localhost');

  const denied = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);

  const native = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(native.headers['access-control-allow-origin'], undefined);

  await app.close();
});
