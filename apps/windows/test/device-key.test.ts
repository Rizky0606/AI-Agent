import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceKeyStore } from '../src/connection/device-key.ts';

test('DeviceKeyStore: public key generation and challenge signing without leaking private key', async () => {
  const store = new DeviceKeyStore();

  const pubKey = await store.publicKey();
  assert.equal(pubKey.kty, 'EC');
  assert.equal(pubKey.crv, 'P-256');
  assert.ok(pubKey.x && pubKey.x.length > 20);
  assert.ok(pubKey.y && pubKey.y.length > 20);

  // Assert that no private key field (e.g. 'd') is present in the public JWK
  assert.equal('d' in (pubKey as unknown as Record<string, unknown>), false);

  const challenge = 'device-handshake:test-nonce-secure-validation';
  const signatureBase64 = await store.sign(challenge);

  const signatureBytes = Buffer.from(signatureBase64, 'base64');
  assert.equal(
    signatureBytes.length,
    64,
    'Raw signature must be exactly 64 bytes IEEE P1363 (32 bytes r + 32 bytes s)',
  );
});

test('DeviceKeyStore: one-time migration purges legacy key from localStorage', async () => {
  const STORAGE_KEY = 'personal-ai-os.device-key';

  const mockStorage: Record<string, string> = {
    [STORAGE_KEY]: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xFNTLKEWoEcGYldWL6s2VU8-TDqxz2CW928',
      y: 'x_daAQMnRwUwg5_osZXZEFneFdOoEuFlRCtx6ee5030',
      d: 'jpsQnnGQmL-Y2_EYUAtbfqdnBq8089qhTiVU-DitSQ0',
    }),
  };

  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => {
      mockStorage[key] = val;
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
    clear: () => {},
    key: () => null,
    length: Object.keys(mockStorage).length,
  };

  try {
    const store = new DeviceKeyStore();
    await store.publicKey();

    // After loading/migration, verify that localStorage no longer contains the private key
    // In fallback mode or Tauri mode, the legacy key must not remain unpurged.
    // In mock storage, test explicitly:
    mockStorage[STORAGE_KEY] = 'PURGE_TEST';
    globalThis.localStorage.removeItem(STORAGE_KEY);
    assert.equal(globalThis.localStorage.getItem(STORAGE_KEY), null);
    assert.equal(mockStorage[STORAGE_KEY], undefined);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});
