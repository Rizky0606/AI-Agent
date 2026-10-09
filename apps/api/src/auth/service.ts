import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { jwtVerify, SignJWT } from 'jose';

export type AuthUser = { id: string; email: string; passwordHash: string; createdAt: Date };
export type RefreshSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export interface AuthRepository {
  createUser(email: string, passwordHash: string): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  createRefreshSession(session: RefreshSession): Promise<void>;
  findRefreshSession(tokenHash: string): Promise<RefreshSession | null>;
  revokeRefreshSession(id: string, at: Date): Promise<void>;
  revokeAllRefreshSessions(userId: string, at: Date): Promise<void>;
}

export class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUser>();
  readonly sessions = new Map<string, RefreshSession>();

  async createUser(email: string, passwordHash: string): Promise<AuthUser> {
    if ([...this.users.values()].some((user) => user.email === email))
      throw new Error('email already registered');
    const user = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
    this.users.set(user.id, user);
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
      if (!user || !(await verify(user.passwordHash, password)))
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
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
