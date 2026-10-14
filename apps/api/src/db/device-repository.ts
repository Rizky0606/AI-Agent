import { and, eq } from 'drizzle-orm';
import { devices } from './schema.ts';
import type { Database } from './client.ts';

export class SqlDeviceRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }
  /**
   * Resolves the row a Windows agent session belongs to. Identity is the public key, not the name:
   * a re-installed agent that lost its key gets its own row instead of taking over the old one, and
   * a device that never registered is created here, so the handshake has a stable owner to hang a
   * session on.
   */
  async registerAgent(
    userId: string,
    input: { name: string; platform: string; publicKey: string },
  ): Promise<{ id: string; name: string; platform: string }> {
    const [existing] = await this.db
      .select({ id: devices.id, name: devices.name, platform: devices.platform })
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.publicKey, input.publicKey)))
      .limit(1);
    if (existing) {
      // The key proved possession, so this is the moment the device was last actually seen.
      await this.db
        .update(devices)
        .set({ lastSeenAt: new Date() })
        .where(eq(devices.id, existing.id));
      return existing;
    }

    const [row] = await this.db
      .insert(devices)
      .values({
        userId,
        name: input.name,
        platform: input.platform,
        publicKey: input.publicKey,
      })
      .returning({ id: devices.id, name: devices.name, platform: devices.platform });
    if (!row) throw new Error('device insert failed');
    return row;
  }

  async create(
    userId: string,
    input: { name: string; platform: string },
  ): Promise<{ id: string; name: string; platform: string }> {
    const [row] = await this.db
      .insert(devices)
      .values({ userId, name: input.name, platform: input.platform })
      .returning({ id: devices.id, name: devices.name, platform: devices.platform });
    if (!row) throw new Error('device insert failed');
    return row;
  }

  async listByUser(
    userId: string,
  ): Promise<Array<{ id: string; name: string; platform: string; lastSeenAt: Date | null }>> {
    return this.db
      .select({
        id: devices.id,
        name: devices.name,
        platform: devices.platform,
        lastSeenAt: devices.lastSeenAt,
      })
      .from(devices)
      .where(eq(devices.userId, userId));
  }
}
