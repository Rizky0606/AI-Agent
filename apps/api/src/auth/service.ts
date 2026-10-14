import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { jwtVerify, SignJWT } from 'jose';

export type AuthUser = { id: string; email: string; passwordHash: string | null; createdAt: Date };
export type RefreshSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export interface AuthRepository {
  createUser(email: string, passwordHash: string | null): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  createRefreshSession(session: RefreshSession): Promise<void>;
  findRefreshSession(tokenHash: string): Promise<RefreshSession | null>;
  revokeRefreshSession(id: string, at: Date): Promise<void>;
  revokeAllRefreshSessions(userId: string, at: Date): Promise<void>;
  /**
   * Resolves the local user behind a provider's (provider, subject) pair, creating both the user
   * and the identity link on first sign-in. Accounts are matched on verified email first so that
   * someone who already registered with a password keeps the same id when they later use Google.
   */
  upsertProviderUser(provider: string, subject: string, email: string): Promise<AuthUser>;
}

export class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUser>();
  readonly sessions = new Map<string, RefreshSession>();
  readonly identities = new Map<string, string>();

  async createUser(email: string, passwordHash: string | null): Promise<AuthUser> {
    if ([...this.users.values()].some((user) => user.email === email))
      throw new Error('email already registered');
    const user = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
    this.users.set(user.id, user);
    return user;
  }

  async upsertProviderUser(provider: string, subject: string, email: string): Promise<AuthUser> {
    const linked = this.identities.get(`${provider}:${subject}`);
    const existing = linked ? this.users.get(linked) : undefined;
    if (existing) return existing;
    const user = (await this.findUserByEmail(email)) ?? (await this.createUser(email, null));
    this.identities.set(`${provider}:${subject}`, user.id);
    return user;
  }

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async findUserById(id: string): Promise<AuthUser | null> {
    return this.users.get(id) ?? null;
  }

  async createRefreshSession(session: RefreshSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async findRefreshSession(tokenHash: string): Promise<RefreshSession | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }
  async revokeRefreshSession(id: string, at: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = at;
  }
  async revokeAllRefreshSessions(userId: string, at: Date): Promise<void> {
    for (const session of this.sessions.values())
      if (session.userId === userId) session.revokedAt = at;
  }
}

export class AuthError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const newRefreshToken = (): string => randomBytes(32).toString('base64url');

export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: Pick<AuthUser, 'id' | 'email'>;
};

/**
 * What `/v1/auth/google/start` stashes inside the `state` parameter. It is signed rather than
 * stored so a restart between start and callback cannot lose an in-flight login.
 */
export type OAuthState = {
  /** Where the callback hands the login code back to. Validated against the allowlist on start. */
  redirectUri: string;
  /** The client's own opaque value, echoed back untouched so it can correlate the response. */
  clientState: string;
  /** PKCE challenge the client must later prove it holds the verifier for. */
  codeChallenge: string;
  /** Server-side PKCE verifier for the leg between this server and Google. */
  providerVerifier: string;
};

const OAUTH_STATE_AUDIENCE = 'oauth-state';
const LOGIN_CODE_AUDIENCE = 'login-code';
const OAUTH_STATE_TTL_SECONDS = 600;
const LOGIN_CODE_TTL_SECONDS = 60;

/** RFC 7636 S256: the only challenge method the clients use, so nothing here is negotiable. */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export const createAuthService = (repository: AuthRepository, jwtSecret: string) => {
  if (Buffer.byteLength(jwtSecret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
  const secret = new TextEncoder().encode(jwtSecret);
  const accessTtl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
  const refreshTtl = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 2_592_000);

  const issue = async (user: AuthUser): Promise<AuthResult> => {
    const accessToken = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${accessTtl}s`)
      .sign(secret);
    const refreshToken = newRefreshToken();
    await repository.createRefreshSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      revokedAt: null,
    });
    return { accessToken, refreshToken, user: { id: user.id, email: user.email } };
  };

  return {
    async register(email: string, password: string): Promise<AuthResult> {
      const user = await repository.createUser(
        normalizeEmail(email),
        await hash(password, {
          algorithm: 2,
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        }),
      );
      return issue(user);
    },
    async login(email: string, password: string): Promise<AuthResult> {
      const user = await repository.findUserByEmail(normalizeEmail(email));
      if (!user || !user.passwordHash || !(await verify(user.passwordHash, password)))
        throw new AuthError('INVALID_CREDENTIALS', 'invalid credentials');
      return issue(user);
    },
    async refresh(refreshToken: string): Promise<AuthResult> {
      const session = await repository.findRefreshSession(tokenHash(refreshToken));
      if (!session || session.expiresAt <= new Date())
        throw new AuthError('INVALID_REFRESH_TOKEN', 'refresh token invalid or expired');
      if (session.revokedAt) {
        await repository.revokeAllRefreshSessions(session.userId, new Date());
        throw new AuthError('REFRESH_REUSE', 'refresh token reuse detected');
      }
      const user = await repository.findUserById(session.userId);
      if (!user) throw new AuthError('INVALID_REFRESH_TOKEN', 'refresh token invalid or expired');
      await repository.revokeRefreshSession(session.id, new Date());
      return issue(user);
    },
    async logout(refreshToken: string): Promise<void> {
      const session = await repository.findRefreshSession(tokenHash(refreshToken));
      if (session && !session.revokedAt)
        await repository.revokeRefreshSession(session.id, new Date());
    },
    async authorizeUser(accessToken: string, userId: string): Promise<boolean> {
      try {
        const verified = await jwtVerify(accessToken, secret, { algorithms: ['HS256'] });
        return verified.payload.sub === userId;
      } catch {
        return false;
      }
    },
    async authenticate(accessToken: string): Promise<AuthUser> {
      try {
        const verified = await jwtVerify(accessToken, secret, { algorithms: ['HS256'] });
        const userId = verified.payload.sub;
        if (!userId) throw new Error('missing subject');
        const user = await repository.findUserById(userId);
        if (!user) throw new Error('user missing');
        return user;
      } catch {
        throw new AuthError('UNAUTHENTICATED', 'authentication required');
      }
    },
    /**
     * Sign-in through a federated provider. The caller has already verified the provider's own
     * assertion (signature, issuer, audience, verified email); this only maps it onto a local
     * user and mints the same token pair a password login would.
     */
    async loginWithProvider(provider: string, subject: string, email: string): Promise<AuthResult> {
      return issue(await repository.upsertProviderUser(provider, subject, normalizeEmail(email)));
    },
    async createOAuthState(state: OAuthState): Promise<string> {
      return new SignJWT({ ...state })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setAudience(OAUTH_STATE_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
        .sign(secret);
    },
    async readOAuthState(token: string): Promise<OAuthState> {
      try {
        const { payload } = await jwtVerify(token, secret, {
          algorithms: ['HS256'],
          audience: OAUTH_STATE_AUDIENCE,
        });
        const { redirectUri, clientState, codeChallenge, providerVerifier } = payload as Record<
          string,
          unknown
        >;
        if (
          typeof redirectUri !== 'string' ||
          typeof clientState !== 'string' ||
          typeof codeChallenge !== 'string' ||
          typeof providerVerifier !== 'string'
        )
          throw new Error('malformed state');
        return { redirectUri, clientState, codeChallenge, providerVerifier };
      } catch {
        throw new AuthError('INVALID_OAUTH_STATE', 'login request expired or tampered with', 400);
      }
    },
    /**
     * A one-minute, single-purpose stand-in for the token pair, safe to put in a redirect URL
     * that a browser or another app on the device can observe. It is worthless without the PKCE
     * verifier, which never leaves the client.
     */
    async createLoginCode(userId: string, codeChallenge: string): Promise<string> {
      return new SignJWT({ codeChallenge })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setAudience(LOGIN_CODE_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${LOGIN_CODE_TTL_SECONDS}s`)
        .sign(secret);
    },
    async exchangeLoginCode(code: string, codeVerifier: string): Promise<AuthResult> {
      try {
        const { payload } = await jwtVerify(code, secret, {
          algorithms: ['HS256'],
          audience: LOGIN_CODE_AUDIENCE,
        });
        if (payload['codeChallenge'] !== pkceChallenge(codeVerifier))
          throw new AuthError('INVALID_LOGIN_CODE', 'login code does not match this device', 400);
        const user = payload.sub ? await repository.findUserById(payload.sub) : null;
        if (!user) throw new AuthError('INVALID_LOGIN_CODE', 'login code does not match a user', 400);
        return issue(user);
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError('INVALID_LOGIN_CODE', 'login code invalid or expired', 400);
      }
    },
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
