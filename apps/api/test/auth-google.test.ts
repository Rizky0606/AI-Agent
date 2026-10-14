import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.ts';
import { createGoogleOAuthClient, type GoogleOAuthClient } from '../src/auth/google.ts';
import { InMemoryAuthRepository, createAuthService, pkceChallenge } from '../src/auth/service.ts';

const secret = 'super-secret-key-at-least-32-chars-long';
const CLIENT_VERIFIER = 'client-verifier-client-verifier-client-verifier';
const CLIENT_CHALLENGE = pkceChallenge(CLIENT_VERIFIER);
/**
 * Drives the whole browser round trip without touching Google: the authorization URL is built by
 * the real client (so its parameters are covered), and only the token exchange is stubbed.
 */
const fakeGoogle = (identity: { subject: string; email: string }): GoogleOAuthClient => ({
  ...createGoogleOAuthClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://ai.example/v1/auth/google/callback',
  }),
  exchangeCode: async () => identity,
});
const setup = () => {
  const repository = new InMemoryAuthRepository();
  const auth = createAuthService(repository, secret);
  const google = fakeGoogle({ subject: 'google-subject-1', email: 'ada@example.com' });
  return { repository, auth, google };
};

test('Google sign-in: browser round trip issues tokens that authenticate /v1/me', async () => {
  const { auth, google } = setup();
  const app = await buildApp({ auth, google: { client: google, allowedRedirectUris: ['personal-ai://auth'] } });
  try {
    const start = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirect_uri=${encodeURIComponent('personal-ai://auth')}&code_challenge=${CLIENT_CHALLENGE}&state=client-state-1`,
    });
    assert.equal(start.statusCode, 302);
    const authorizationUrl = new URL(start.headers.location as string);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorizationUrl.searchParams.get('client_id'), 'test-client-id');
    assert.equal(
      authorizationUrl.searchParams.get('redirect_uri'),
      'https://ai.example/v1/auth/google/callback',
    );
    assert.equal(authorizationUrl.searchParams.get('scope'), 'openid email');
    // The server runs its own PKCE leg with Google, independent of the client's challenge.
    assert.notEqual(authorizationUrl.searchParams.get('code_challenge'), CLIENT_CHALLENGE);

    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=google-auth-code&state=${encodeURIComponent(authorizationUrl.searchParams.get('state') as string)}`,
    });
    assert.equal(callback.statusCode, 302);
    const returned = new URL(callback.headers.location as string);
    assert.equal(returned.protocol, 'personal-ai:');
    assert.equal(returned.searchParams.get('state'), 'client-state-1');
    const loginCode = returned.searchParams.get('code') as string;

    // Without the verifier the login code is worthless, which is what makes it safe to hand to a
    // browser or to another app on the device.
    const wrongVerifier = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: { code: loginCode, codeVerifier: 'wrong-verifier-wrong-verifier-wrong-verifier' },
    });
    assert.equal(wrongVerifier.statusCode, 400);

    const exchanged = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: { code: loginCode, codeVerifier: CLIENT_VERIFIER },
    });
    assert.equal(exchanged.statusCode, 200);
    const tokens = exchanged.json();
    assert.equal(tokens.user.email, 'ada@example.com');

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, 'ada@example.com');
  } finally {
    await app.close();
  }
});

test('Google sign-in: one identity maps to one local user, and its account has no password', async () => {
  const { repository, auth, google } = setup();
  const app = await buildApp({ auth, google: { client: google, allowedRedirectUris: ['personal-ai://auth'] } });
  try {
    const signIn = async (): Promise<{ id: string; email: string }> => {
      const start = await app.inject({
        method: 'GET',
        url: `/v1/auth/google/start?redirect_uri=${encodeURIComponent('personal-ai://auth')}&code_challenge=${CLIENT_CHALLENGE}&state=s`,
      });
      const state = new URL(start.headers.location as string).searchParams.get('state') as string;
      const callback = await app.inject({
        method: 'GET',
        url: `/v1/auth/google/callback?code=c&state=${encodeURIComponent(state)}`,
      });
      const code = new URL(callback.headers.location as string).searchParams.get('code') as string;
      const exchanged = await app.inject({
        method: 'POST',
        url: '/v1/auth/exchange',
        payload: { code, codeVerifier: CLIENT_VERIFIER },
      });
      assert.equal(exchanged.statusCode, 200);
      return exchanged.json().user;
    };

    const first = await signIn();
    const second = await signIn();
    assert.equal(second.id, first.id);
    assert.equal(repository.users.size, 1);
    assert.equal(repository.users.get(first.id)?.passwordHash, null);
    // A provider-only account cannot be logged into with a password.
    await assert.rejects(
      () => auth.login('ada@example.com', 'any-password-12345'),
      /invalid credentials/,
    );
  } finally {
    await app.close();
  }
});

test('Google sign-in: off-allowlist redirect targets and forged state are refused', async () => {
  const { auth, google } = setup();
  const app = await buildApp({
    auth,
    google: { client: google, allowedRedirectUris: ['personal-ai://auth'] },
  });
  try {
    const evil = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirect_uri=${encodeURIComponent('https://attacker.example/steal')}&code_challenge=${CLIENT_CHALLENGE}&state=s`,
    });
    assert.equal(evil.statusCode, 400);
    assert.equal(evil.json().error.code, 'INVALID_REDIRECT_URI');

    // Loopback is allowed because the Windows agent listens on an ephemeral port; the exact
    // host must still be 127.0.0.1, not a name an attacker could point elsewhere.
    const loopback = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirect_uri=${encodeURIComponent('http://127.0.0.1:51000/auth')}&code_challenge=${CLIENT_CHALLENGE}&state=s`,
    });
    assert.equal(loopback.statusCode, 302);

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=c&state=not-a-signed-state',
    });
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error.code, 'INVALID_OAUTH_STATE');
  } finally {
    await app.close();
  }
});

test('Google sign-in: unconfigured deployment answers 503 instead of half-working', async () => {
  const { auth } = setup();
  const app = await buildApp({ auth });
  try {
    const start = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/start?redirect_uri=${encodeURIComponent('personal-ai://auth')}&code_challenge=${CLIENT_CHALLENGE}&state=s`,
    });
    assert.equal(start.statusCode, 503);
    assert.equal(start.json().error.code, 'NOT_CONFIGURED');
  } finally {
    await app.close();
  }
});
