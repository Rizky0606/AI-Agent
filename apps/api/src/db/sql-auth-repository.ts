import { and, eq, isNull } from 'drizzle-orm';
import type { AuthRepository, AuthUser, RefreshSession } from '../auth/service.ts';
import { refreshTokens, users } from './schema.ts';
import type { Database } from './client.ts';

export class SqlAuthRepository implements AuthRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }
  async createUser(email: string, passwordHash: string): Promise<AuthUser> {
    const [row] = await this.db.insert(users).values({ email, passwordHash }).returning();
    if (!row) throw new Error('user insert failed');
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
    };
  }
  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row
      ? { id: row.id, email: row.email, passwordHash: row.passwordHash, createdAt: row.createdAt }
      : null;
  }
  async findUserById(id: string): Promise<AuthUser | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row
      ? { id: row.id, email: row.email, passwordHash: row.passwordHash, createdAt: row.createdAt }
      : null;
  }
  async createRefreshSession(session: RefreshSession): Promise<void> {
    await this.db.insert(refreshTokens).values(session);
  }
  async findRefreshSession(tokenHash: string): Promise<RefreshSession | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row
      ? {
          id: row.id,
          userId: row.userId,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
        }
      : null;
  }
  async revokeRefreshSession(id: string, at: Date): Promise<void> {
    await this.db.update(refreshTokens).set({ revokedAt: at }).where(eq(refreshTokens.id, id));
  }
  async revokeAllRefreshSessions(userId: string, at: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
