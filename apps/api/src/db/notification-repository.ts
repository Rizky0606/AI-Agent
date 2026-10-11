import { desc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { notifications, type NotificationRow } from './schema.ts';
import type {
  DeliveryState,
  NotificationData,
  NotificationRecord,
  NotificationStorage,
  NotificationType,
} from '@personal-ai-os/scheduler';

export class SqlNotificationRepository implements NotificationStorage {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private mapRowToRecord(row: NotificationRow): NotificationRecord {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      data: (row.data ?? {}) as NotificationData,
      deliveryState: row.deliveryState as DeliveryState,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      deepLink: row.deepLink ?? '',
      lastError: row.lastError ?? undefined,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : undefined,
      readAt: row.readAt ? row.readAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async saveNotification(record: NotificationRecord): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .insert(notifications)
        .values({
          id: record.id,
          userId: record.userId,
          type: record.type,
          title: record.title,
          body: record.body,
          data: record.data,
          deliveryState: record.deliveryState,
          attempts: record.attempts,
          maxAttempts: record.maxAttempts,
          deepLink: record.deepLink,
          lastError: record.lastError ?? null,
          deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : null,
          readAt: record.readAt ? new Date(record.readAt) : null,
          createdAt: new Date(record.createdAt),
        })
        .onConflictDoUpdate({
          target: notifications.id,
          set: {
            deliveryState: record.deliveryState,
            attempts: record.attempts,
            lastError: record.lastError ?? null,
            deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : null,
            readAt: record.readAt ? new Date(record.readAt) : null,
          },
        });
    } catch {
      // Graceful fallback
    }
  }

  async updateNotification(record: NotificationRecord): Promise<void> {
    return this.saveNotification(record);
  }

  async getNotification(id: string): Promise<NotificationRecord | null> {
    if (!this.db) return null;
    try {
      const [row] = await this.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .limit(1);
      return row ? this.mapRowToRecord(row) : null;
    } catch {
      return null;
    }
  }

  async listNotifications(userId: string): Promise<NotificationRecord[]> {
    if (!this.db) return [];
    try {
      const rows = await this.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt));
      return rows.map((r) => this.mapRowToRecord(r));
    } catch {
      return [];
    }
  }
}
