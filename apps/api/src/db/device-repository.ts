import { eq } from 'drizzle-orm';
import { devices } from './schema.ts';
import type { Database } from './client.ts';

export class SqlDeviceRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
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
