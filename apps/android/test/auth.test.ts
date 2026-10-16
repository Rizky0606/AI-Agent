import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';
import { createAuthStore } from '../src/state/auth-store.ts';

test('Auth flow: login saves tokens to secure storage and registers device', async () => {
  const storage = new InMemoryTokenStorage();
  let deviceRegistered = false;

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input.toString();

    if (url.endsWith('/v1/auth/login')) {
      return new Response(
        JSON.stringify({
          user: { id: 'usr-1', email: 'alice@android.test' },
          accessToken: 'acc-token-123',
          refreshToken: 'ref-token-456',
          expiresIn: 900,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.endsWith('/v1/devices')) {
      deviceRegistered = true;
      return new Response(
        JSON.stringify({
          device: { id: 'dev-android-01', name: 'Personal Android Client', platform: 'android' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  };

  try {
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });
    const authStore = createAuthStore(client);

    await authStore.getState().login('alice@android.test', 'password123');

    const state = authStore.getState();
    assert.equal(state.isAuthenticated, true);
    assert.equal(state.user?.email, 'alice@android.test');
    assert.equal(await storage.getAccessToken(), 'acc-token-123');
    assert.equal(await storage.getRefreshToken(), 'ref-token-456');
    assert.equal(await storage.getDeviceId(), 'dev-android-01');
    assert.equal(deviceRegistered, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Automatic token refresh: retries request upon 401 when refresh token is valid', async () => {
  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('expired-access-token');
  await storage.setRefreshToken('valid-refresh-token');

  let refreshCalled = false;
  let retrySucceeded = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input.toString();
    const authHeader = (init?.headers as Record<string, string> | undefined)?.['Authorization'];

    if (url.endsWith('/v1/auth/refresh')) {
      refreshCalled = true;
      return new Response(
        JSON.stringify({
          accessToken: 'new-fresh-access-token',
          expiresIn: 900,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.endsWith('/v1/projects')) {
      if (authHeader === 'Bearer expired-access-token') {
        return new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Token expired' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (authHeader === 'Bearer new-fresh-access-token') {
        retrySucceeded = true;
        return new Response(
          JSON.stringify({ projects: [{ id: 'proj-1', name: 'Work Project' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  };

  try {
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });
    const projects = await client.listProjects();

    assert.equal(refreshCalled, true);
    assert.equal(retrySucceeded, true);
    assert.equal(projects.projects.length, 1);
    assert.equal(projects.projects[0]?.name, 'Work Project');
    assert.equal(await storage.getAccessToken(), 'new-fresh-access-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Logout clears tokens from secure storage and resets auth state', async () => {
  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('active-token');
  await storage.setRefreshToken('active-refresh');

  let logoutApiCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (input.toString().endsWith('/v1/auth/logout')) {
      logoutApiCalled = true;
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 200 });
  };

  try {
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });
    const authStore = createAuthStore(client);

    await authStore.getState().logout();

    assert.equal(logoutApiCalled, true);
    assert.equal(await storage.getAccessToken(), null);
    assert.equal(await storage.getRefreshToken(), null);
    assert.equal(authStore.getState().isAuthenticated, false);
    assert.equal(authStore.getState().user, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google exchange: login code + verifier are posted and both tokens persisted', async () => {
  const storage = new InMemoryTokenStorage();
  let exchangeBody: string | undefined;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input.toString();

    if (url.endsWith('/v1/auth/exchange')) {
      exchangeBody = init?.body as string;
      return new Response(
        JSON.stringify({
          user: { id: 'usr-google-1', email: 'alice@gmail.test' },
          accessToken: 'g-access',
          refreshToken: 'g-refresh',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  };

  try {
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });
    const res = await client.exchangeLoginCode('login-code-1', 'verifier-1');

    assert.deepEqual(JSON.parse(exchangeBody ?? '{}'), {
      code: 'login-code-1',
      codeVerifier: 'verifier-1',
    });
    assert.equal(res.user.email, 'alice@gmail.test');
    assert.equal(await storage.getAccessToken(), 'g-access');
    assert.equal(await storage.getRefreshToken(), 'g-refresh');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google sign-in failure surfaces in the auth store error field', async () => {
  const authStore = createAuthStore(new ApiClient({ storage: new InMemoryTokenStorage() }));

  await assert.rejects(authStore.getState().loginWithGoogle());

  const state = authStore.getState();
  assert.equal(state.isLoading, false);
  assert.equal(state.isAuthenticated, false);
  assert.match(state.error ?? '', /crypto/i);
});
