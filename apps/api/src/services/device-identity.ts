import { createHash, createPublicKey, verify } from 'node:crypto';

/**
 * A device is its key pair. The agent keeps a P-256 private key that never leaves the machine and
 * proves possession at the handshake by signing a nonce the server just issued, so a device id can
 * no longer be claimed by whoever knows the string. The canonical form below is the RFC 7638
 * thumbprint input, which makes the stored key comparable byte for byte.
 */
export interface DevicePublicKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

/**
 * Accepts only a public P-256 key. A JWK carrying `d` is a private key and is refused outright, so
 * a client can never hand the server secret material to store.
 */
export const parseDevicePublicKey = (value: unknown): DevicePublicKey | null => {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate['d'] !== undefined) return null;
  const kty = candidate['kty'];
  const crv = candidate['crv'];
  const x = candidate['x'];
  const y = candidate['y'];
  if (kty !== 'EC' || crv !== 'P-256') return null;
  if (typeof x !== 'string' || typeof y !== 'string' || x.length === 0 || y.length === 0) {
    return null;
  }
  return { kty: 'EC', crv: 'P-256', x, y };
};

/** RFC 7638 canonical JSON: lexicographic member order, no whitespace, public members only. */
export const canonicalDevicePublicKey = (key: DevicePublicKey): string =>
  JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });

export const deviceKeyThumbprint = (key: DevicePublicKey): string =>
  createHash('sha256').update(canonicalDevicePublicKey(key)).digest('base64url');

/**
 * Verifies the handshake signature. WebCrypto signs ECDSA as raw `r || s`, which Node only reads
 * back with `dsaEncoding: 'ieee-p1363'`; without it every honest signature would look invalid.
 */
export const verifyDeviceSignature = (input: {
  publicKey: DevicePublicKey;
  nonce: string;
  signature: string;
}): boolean => {
  const signature = Buffer.from(input.signature, 'base64');
  if (signature.length === 0) return false;
  try {
    const key = createPublicKey({
      key: { kty: input.publicKey.kty, crv: input.publicKey.crv, x: input.publicKey.x, y: input.publicKey.y },
      format: 'jwk',
    });
    return verify(
      'sha256',
      Buffer.from(input.nonce, 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    return false;
  }
};
