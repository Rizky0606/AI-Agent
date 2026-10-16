import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuthRepository, AuthUser, RefreshSession } from '../auth/service.ts';
import { refreshTokens, userIdentities, users } from './schema.ts';
import type { Database } from './client.ts';

const toAuthUser = (row: {
  id: string;
  email: string;
  passwordHash: string | null;
  defaultModel?: string | null;
  defaultMode?: string | null;
  createdAt: Date;
}): AuthUser => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  defaultModel: row.defaultModel ?? null,
  defaultMode: row.defaultMode ?? 'auto',
  createdAt: row.createdAt,
});

export class SqlAuthRepository implements AuthRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }
  async createUser(email: string, passwordHash: string | null): Promise<AuthUser> {
    const [row] = await this.db.insert(users).values({ email, passwordHash }).returning();
    if (!row) throw new Error('user insert failed');
    return toAuthUser(row);
  }
  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toAuthUser(row) : null;
  }
  async findUserById(id: string): Promise<AuthUser | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toAuthUser(row) : null;
  }
  async updateUserPreferences(
    userId: string,
    preferences: { defaultModel?: string | null | undefined; defaultMode?: string | undefined },
  ): Promise<AuthUser> {
    const toUpdate: Record<string, unknown> = {};
    if (preferences.defaultModel !== undefined) toUpdate.defaultModel = preferences.defaultModel;
    if (preferences.defaultMode !== undefined) toUpdate.defaultMode = preferences.defaultMode;

    const [row] = await this.db
      .update(users)
      .set(toUpdate)
      .where(eq(users.id, userId))
      .returning();
    if (!row) throw new Error('user not found');
    return toAuthUser(row);
  }
  /**
   * Resolves the local user for a provider sign-in. The email is the anchor: an existing account
   * with that verified email keeps its id, so a password account and its Google login never split
   * into two users. `onConflictDoUpdate` makes the insert atomic, so two devices signing in with
   * the same Google account at once cannot create duplicates.
   */
  async upsertProviderUser(provider: string, subject: string, email: string): Promise<AuthUser> {
    const [row] = await this.db
      .insert(users)
      .values({ email })
      .onConflictDoUpdate({ target: users.email, set: { email: sql`excluded.email` } })
      .returning();
    if (!row) throw new Error('user upsert failed');
    await this.db
      .insert(userIdentities)
      .values({ userId: row.id, provider, subject, email })
      .onConflictDoUpdate({
        target: [userIdentities.provider, userIdentities.subject],
        set: { userId: row.id, email },
      });
    return toAuthUser(row);
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
