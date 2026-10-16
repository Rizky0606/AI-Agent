/** Browser-side half of the server's Authorization Code + PKCE flow (RFC 7636). */

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** S256 code challenge: base64url(SHA-256(verifier)). */
export const codeChallengeFor = async (codeVerifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64Url(new Uint8Array(digest));
};

export const randomBase64Url = (byteLength: number): string =>
  base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));

/**
 * `{redirect_uri}` stays a literal placeholder on purpose: the Rust command knows the loopback
 * port only after it binds one, and substitutes the value there.
 */
export const buildGoogleStartUrl = (
  serverUrl: string,
  codeChallenge: string,
  state: string,
): string =>
  `${serverUrl.replace(/\/+$/, '')}/v1/auth/google/start?redirect_uri={redirect_uri}&code_challenge=${codeChallenge}&state=${state}`;

export const parseCallbackQuery = (rawQuery: string): { code: string; state: string } => {
  const params = new URLSearchParams(rawQuery);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) throw new Error('Callback Google tidak berisi code/state.');
  return { code, state };
};
