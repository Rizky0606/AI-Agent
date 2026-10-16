/**
 * PKCE (RFC 7636) helpers and deep-link parsing for the Google sign-in flow.
 */

export const GOOGLE_REDIRECT_URI = 'personal-ai://auth';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface PkceParams {
  verifier: string;
  challenge: string;
  state: string;
}

/** Unpadded base64url of raw bytes (RFC 7636 alphabet, no `=` padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const chunk = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64URL_ALPHABET[(chunk >> 18) & 63]!;
    out += BASE64URL_ALPHABET[(chunk >> 12) & 63]!;
    if (remaining > 1) out += BASE64URL_ALPHABET[(chunk >> 6) & 63]!;
    if (remaining > 2) out += BASE64URL_ALPHABET[chunk & 63]!;
  }
  return out;
}

/** Standard base64 (as returned by expo-crypto) -> unpadded base64url. */
export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Dynamic import: expo-crypto is a native module absent from the Node test runtime.
async function loadCrypto() {
  try {
    const mod = await import('expo-crypto');
    if (typeof mod.getRandomBytesAsync === 'function') return mod;
  } catch {
    // not in Expo runtime
  }
  throw new Error('Secure crypto unavailable (expo-crypto missing)');
}

/** Fresh verifier (32 random bytes -> 43 base64url chars), its S256 challenge, and a random state. */
export async function createPkceParams(): Promise<PkceParams> {
  const crypto = await loadCrypto();
  const verifier = base64UrlEncode(await crypto.getRandomBytesAsync(32));
  const digest = await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: crypto.CryptoEncoding.BASE64,
  });
  return {
    verifier,
    challenge: toBase64Url(digest),
    state: base64UrlEncode(await crypto.getRandomBytesAsync(16)),
  };
}

/**
 * Reads the login code out of the `personal-ai://auth` redirect.
 * Returns null for unrelated deep links; throws on a missing code or state mismatch.
 */
export function parseAuthRedirect(url: string, expectedState: string): { code: string } | null {
  const rest = url.startsWith(GOOGLE_REDIRECT_URI) ? url.slice(GOOGLE_REDIRECT_URI.length) : '';
  if (rest[0] !== '?' && rest[0] !== '#') return null;

  const params = new URLSearchParams(rest.slice(1));
  const code = params.get('code');
  if (!code) throw new Error('Google sign-in did not return a login code');
  if (params.get('state') !== expectedState) throw new Error('Google sign-in state mismatch');
  return { code };
}
