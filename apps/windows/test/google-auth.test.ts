import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGoogleStartUrl,
  codeChallengeFor,
  parseCallbackQuery,
  randomBase64Url,
} from '../src/auth/google.ts';

// RFC 7636 appendix B vector.
test('codeChallengeFor matches the RFC 7636 S256 vector', async () => {
  assert.equal(
    await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('buildGoogleStartUrl keeps the {redirect_uri} placeholder for Rust to fill in', () => {
  const url = buildGoogleStartUrl('https://api.example.com/', 'chal', 'st');
  assert.equal(
    url,
    'https://api.example.com/v1/auth/google/start?redirect_uri={redirect_uri}&code_challenge=chal&state=st',
  );
  assert.ok(url.includes('{redirect_uri}'));
});

test('parseCallbackQuery reads code and state and rejects a query without them', () => {
  assert.deepEqual(parseCallbackQuery('code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  assert.throws(() => parseCallbackQuery('state=xyz'));
  assert.throws(() => parseCallbackQuery(''));
});

test('randomBase64Url is url-safe, unpadded, and fresh per call', () => {
  const value = randomBase64Url(32);
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(value, randomBase64Url(32));
});
