import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentStore, isTokenExpired } from '../src/state/agent-store.ts';
import { CapabilityRegistry } from '../src/security/capability-registry.ts';
import { PathValidator } from '../src/security/path-validator.ts';
import { DeviceIdentityManager } from '../src/connection/device-identity.ts';
import type { ICommandExecutor, CommandExecutionResult } from '../src/security/types.ts';

// Mock localStorage for node environment
const storageMap = new Map<string, string>();
if (!globalThis.localStorage) {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  };
}

class MockCommandExecutor implements ICommandExecutor {
  executedCommands: string[] = [];
  getCapabilityRegistry(): CapabilityRegistry {
    return new CapabilityRegistry();
  }
  getPathValidator(): PathValidator {
    return new PathValidator();
  }
  async executePowershell(command: string): Promise<CommandExecutionResult> {
    this.executedCommands.push(command);
    return {
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 10,
      truncated: false,
      killedByTimeout: false,
      killedByAbort: false,
    };
  }
  cancelExecution(): void {}
  cancelAll(): void {}
}

const makeJwt = (expSecondsFromNow: number): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'usr-123',
      email: 'tester@example.com',
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
    }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
};

test('isTokenExpired correctly detects expired and valid JWTs', () => {
  assert.equal(isTokenExpired(''), true);
  // Non-JWT strings without dot return false (developer opaque token)
  assert.equal(isTokenExpired('manual-dev-token'), false);
  // JWT expired 1 hour ago
  const expiredJwt = makeJwt(-3600);
  assert.equal(isTokenExpired(expiredJwt), true);
  // JWT expiring 10 seconds from now (within 30s buffer)
  const expiringSoonJwt = makeJwt(10);
  assert.equal(isTokenExpired(expiringSoonJwt), true);
  // JWT valid for 2 hours
  const validJwt = makeJwt(7200);
  assert.equal(isTokenExpired(validJwt), false);
});

test('Fresh install: store starts in unauthenticated state with idle login step', async () => {
  storageMap.clear();
  const store = createAgentStore(
    new CapabilityRegistry(),
    new PathValidator(),
    new DeviceIdentityManager(),
    new MockCommandExecutor(),
  );

  const initial = store.getState();
  assert.equal(initial.authState, 'unauthenticated');
  assert.equal(initial.loginStep, 'idle');
  assert.equal(initial.loginError, null);
  assert.equal(initial.authToken, '');
  assert.equal(initial.refreshToken, '');

  // Running bootstrapAuth with no stored tokens stays unauthenticated
  await store.getState().bootstrapAuth();
  assert.equal(store.getState().authState, 'unauthenticated');
  assert.equal(store.getState().loginStep, 'idle');
});

test('Subsequent launch (0-click): valid token automatically connects', async () => {
  storageMap.clear();
  const validToken = makeJwt(3600);
  storageMap.set(
    'personal-ai-os.windows.session',
    JSON.stringify({
      accessToken: validToken,
      refreshToken: 'refresh-valid-token',
      email: 'tester@example.com',
    }),
  );

  const store = createAgentStore(
    new CapabilityRegistry(),
    new PathValidator(),
    new DeviceIdentityManager(),
    new MockCommandExecutor(),
  );

  // Initial state detects stored tokens and sets bootstrapping
  assert.equal(store.getState().authState, 'bootstrapping');
  assert.equal(store.getState().userEmail, 'tester@example.com');

  let connectCalled = false;
  store.setState({
    syncDeviceIdentity: async () => {},
    connectToServer: async () => {
      connectCalled = true;
    },
    refreshChat: async () => {},
  });

  await store.getState().bootstrapAuth();

  assert.equal(connectCalled, true);
  assert.equal(store.getState().authState, 'authenticated');
  assert.equal(store.getState().loginStep, 'connected');
  assert.equal(store.getState().loginError, null);
});

test('Subsequent launch: expired token with valid refresh token refreshes and connects (0-click)', async () => {
  storageMap.clear();
  const expiredToken = makeJwt(-600);
  storageMap.set(
    'personal-ai-os.windows.session',
    JSON.stringify({
      accessToken: expiredToken,
      refreshToken: 'refresh-valid-123',
      email: 'tester@example.com',
    }),
  );

  const originalFetch = globalThis.fetch;
  const newAccessToken = makeJwt(3600);
  const newRefreshToken = 'refresh-valid-456';

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/v1/auth/refresh')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.refreshToken, 'refresh-valid-123');
      return new Response(
        JSON.stringify({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          user: { id: 'usr-1', email: 'tester@example.com' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    const store = createAgentStore(
      new CapabilityRegistry(),
      new PathValidator(),
      new DeviceIdentityManager(),
      new MockCommandExecutor(),
    );

    let connectCalled = false;
    store.setState({
      syncDeviceIdentity: async () => {},
      connectToServer: async () => {
        connectCalled = true;
      },
      refreshChat: async () => {},
    });

    await store.getState().bootstrapAuth();

    assert.equal(connectCalled, true);
    assert.equal(store.getState().authState, 'authenticated');
    assert.equal(store.getState().authToken, newAccessToken);
    assert.equal(store.getState().refreshToken, newRefreshToken);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Subsequent launch: refresh token revoked (401) wipes session and prompts for re-login', async () => {
  storageMap.clear();
  const expiredToken = makeJwt(-600);
  storageMap.set(
    'personal-ai-os.windows.session',
    JSON.stringify({
      accessToken: expiredToken,
      refreshToken: 'refresh-revoked-token',
      email: 'tester@example.com',
    }),
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/v1/auth/refresh')) {
      return new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Refresh token revoked' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    const store = createAgentStore(
      new CapabilityRegistry(),
      new PathValidator(),
      new DeviceIdentityManager(),
      new MockCommandExecutor(),
    );

    await store.getState().bootstrapAuth();

    assert.equal(store.getState().authState, 'unauthenticated');
    assert.equal(store.getState().loginStep, 'error');
    assert.ok(store.getState().loginError?.includes('kedaluwarsa'));
    assert.equal(store.getState().authToken, '');
    assert.equal(store.getState().refreshToken, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Subsequent launch: server unreachable retains tokens and displays offline error', async () => {
  storageMap.clear();
  const expiredToken = makeJwt(-600);
  storageMap.set(
    'personal-ai-os.windows.session',
    JSON.stringify({
      accessToken: expiredToken,
      refreshToken: 'refresh-keep-me',
      email: 'tester@example.com',
    }),
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    const store = createAgentStore(
      new CapabilityRegistry(),
      new PathValidator(),
      new DeviceIdentityManager(),
      new MockCommandExecutor(),
    );

    await store.getState().bootstrapAuth();

    assert.equal(store.getState().authState, 'unauthenticated');
    assert.equal(store.getState().loginStep, 'error');
    assert.ok(store.getState().loginError?.includes('Server tidak terjangkau'));
    // Tokens are NOT wiped because it was a network failure
    assert.equal(store.getState().authToken, expiredToken);
    assert.equal(store.getState().refreshToken, 'refresh-keep-me');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Single connection guarantee: connectToServer returns early when already connected or connecting', async () => {
  storageMap.clear();
  const validToken = makeJwt(3600);

  const store = createAgentStore(
    new CapabilityRegistry(),
    new PathValidator(),
    new DeviceIdentityManager(),
    new MockCommandExecutor(),
  );

  store.setState({ authToken: validToken });

  // Call connectToServer multiple times simultaneously
  const connect1 = store.getState().connectToServer();
  const connect2 = store.getState().connectToServer();
  const connect3 = store.getState().connectToServer();

  await Promise.all([connect1, connect2, connect3]);

  // Once connected, calling connectToServer again is a no-op
  store.setState({ connectionStatus: 'connected' });
  await store.getState().connectToServer();
});

test('Logout: disconnects WSS, clears local session, revokes refresh token on server', async () => {
  storageMap.clear();
  const validToken = makeJwt(3600);
  storageMap.set(
    'personal-ai-os.windows.session',
    JSON.stringify({
      accessToken: validToken,
      refreshToken: 'refresh-to-revoke',
      email: 'tester@example.com',
    }),
  );

  let logoutRevokedToken = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/v1/auth/logout')) {
      const body = JSON.parse(String(init?.body));
      logoutRevokedToken = body.refreshToken;
      return new Response(undefined, { status: 204 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    const store = createAgentStore(
      new CapabilityRegistry(),
      new PathValidator(),
      new DeviceIdentityManager(),
      new MockCommandExecutor(),
    );

    let disconnectCalled = false;
    store.setState({
      disconnectFromServer: () => {
        disconnectCalled = true;
      },
    });

    await store.getState().logout();

    assert.equal(disconnectCalled, true);
    assert.equal(logoutRevokedToken, 'refresh-to-revoke');
    assert.equal(store.getState().authState, 'unauthenticated');
    assert.equal(store.getState().authToken, '');
    assert.equal(store.getState().refreshToken, '');
    assert.equal(store.getState().userEmail, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
