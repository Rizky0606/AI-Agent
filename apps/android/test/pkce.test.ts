import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ApiClient } from '../src/api/client.ts';
import {
  base64UrlEncode,
  createPkceParams,
  parseAuthRedirect,
  toBase64Url,
} from '../src/api/pkce.ts';

test('PKCE base64url encoding matches Node base64url for all byte lengths', () => {
  for (let length = 0; length <= 40; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length * 11) % 256);
    assert.equal(base64UrlEncode(bytes), Buffer.from(bytes).toString('base64url'));
  }
});

test('PKCE S256 challenge encoding matches RFC 7636 appendix B', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const base64Digest = createHash('sha256').update(verifier).digest('base64');

  assert.equal(verifier.length, 43);
  assert.equal(toBase64Url(base64Digest), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('PKCE params are unavailable without the native crypto module (Node test runtime)', async () => {
  await assert.rejects(createPkceParams(), /expo-crypto missing/);
});

test('Deep link parser extracts the login code and rejects state mismatch', () => {
  assert.deepEqual(
    parseAuthRedirect('personal-ai://auth?code=lc-123&state=st-abc', 'st-abc'),
    { code: 'lc-123' },
  );

  assert.throws(
    () => parseAuthRedirect('personal-ai://auth?code=lc-123&state=st-other', 'st-abc'),
    /state mismatch/,
  );
  assert.throws(() => parseAuthRedirect('personal-ai://auth?state=st-abc', 'st-abc'), /login code/);

  // unrelated deep links must not resolve the pending login
  assert.equal(parseAuthRedirect('personal-ai://chat/conv-1', 'st-abc'), null);
  assert.equal(parseAuthRedirect('https://personal-ai.app/tasks/t-1', 'st-abc'), null);
});

test('Google start URL carries redirect_uri, code_challenge and state', () => {
  const client = new ApiClient({ baseUrl: 'http://10.0.2.2:3000/' });
  assert.equal(
    client.googleStartUrl('K5rMKWHl4X5yDgHzdH0gpc_lptvmnb2gpIuh3lNGZ0E', 'st-abc+/='),
    'http://10.0.2.2:3000/v1/auth/google/start' +
      '?redirect_uri=personal-ai%3A%2F%2Fauth' +
      '&code_challenge=K5rMKWHl4X5yDgHzdH0gpc_lptvmnb2gpIuh3lNGZ0E' +
      '&state=st-abc%2B%2F%3D',
  );
});
