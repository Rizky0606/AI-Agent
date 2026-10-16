import { createRemoteJWKSet, jwtVerify } from 'jose';

import { AuthError } from './service.ts';

/**
 * Google's OpenID Connect endpoints. Pinned constants rather than configuration: pointing these
 * at anything else would mean trusting a different identity provider while still calling it
 * "Sign in with Google".
 */
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Registered in the Google Cloud console; must match the callback route exactly. */
  redirectUri: string;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
}

export interface GoogleOAuthClient {
  /** Where the browser should be sent, with our signed state and our own PKCE challenge. */
  authorizationUrl(state: string, codeChallenge: string): string;
  /** Redeems the authorization code and returns the verified Google identity behind it. */
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleIdentity>;
}

export const createGoogleOAuthClient = (config: GoogleOAuthConfig): GoogleOAuthClient => {
  /**
   * The `state` carries our signed blob, and the PKCE challenge is the server's own (separate from
   * the client's), so a stolen authorization code cannot be redeemed without the verifier that
   * only this process saw.
   */
  const authorizationUrl = (state: string, codeChallenge: string): string => {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  };

  const exchangeCode = async (code: string, codeVerifier: string): Promise<GoogleIdentity> => {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
      }),
    });
    if (!response.ok)
      throw new AuthError('GOOGLE_EXCHANGE_FAILED', 'Google rejected the authorization code', 401);
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string')
      throw new AuthError('GOOGLE_EXCHANGE_FAILED', 'Google returned no identity token', 401);

    // Signature, issuer, audience and expiry are all checked against Google's published keys; a
    // token minted for another application must not sign anyone in here.
    const { payload } = await jwtVerify(body.id_token, JWKS, {
      issuer: ISSUERS,
      audience: config.clientId,
    });
    const { sub, email, email_verified: verified } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof email !== 'string')
      throw new AuthError('GOOGLE_EXCHANGE_FAILED', 'Google identity token is incomplete', 401);
    if (verified !== true)
      throw new AuthError('GOOGLE_EMAIL_UNVERIFIED', 'Google account email is not verified', 401);
    return { subject: sub, email };
  };

  return { authorizationUrl, exchangeCode };
};


/** Reads the client credentials, or `null` when the deployment has not configured Google login. */
export const googleOAuthConfigFromEnv = (): GoogleOAuthConfig | null => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
};
