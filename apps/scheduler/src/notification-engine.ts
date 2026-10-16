import { randomUUID } from 'node:crypto';
import type { FcmProvider } from './fcm-provider.ts';
import {
  type NotificationData,
  type NotificationPreferences,
  type NotificationRecord,
  type NotificationStorage,
  type NotificationType,
} from './types.ts';

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Partial<NotificationData> | undefined;
  deviceToken?: string | undefined;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  channels: { push: true, websocket: true },
  categories: {
    approvalRequired: true,
    taskCompleted: true,
    taskFailed: true,
    blocker: true,
  },
};

export class NotificationEngine {
  private readonly notifications = new Map<string, NotificationRecord>();
  private readonly preferences = new Map<string, NotificationPreferences>();
  private readonly dedupe = new Map<string, { notificationId: string; expiresAt: number }>();
  private readonly fcmProvider: FcmProvider;
  private readonly storage?: NotificationStorage | undefined;
  private readonly resolveDeviceTokens?: ((userId: string) => Promise<string[]>) | undefined;
  private readonly dedupeWindowMs: number;
  private readonly maxRetryAttempts: number;

  constructor(options?: {
    fcmProvider?: FcmProvider | undefined;
    storage?: NotificationStorage | undefined;
    resolveDeviceTokens?: ((userId: string) => Promise<string[]>) | undefined;
    dedupeWindowMs?: number | undefined;
    maxRetryAttempts?: number | undefined;
  }) {
    this.fcmProvider = options?.fcmProvider ?? {
      sendPushNotification: async () => ({ success: true }),
    };
    this.storage = options?.storage;
    this.resolveDeviceTokens = options?.resolveDeviceTokens;
    this.dedupeWindowMs = options?.dedupeWindowMs ?? 60 * 1000; // 60 seconds
    this.maxRetryAttempts = options?.maxRetryAttempts ?? 3; // Max 3 attempts
  }

  async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    const cached = this.preferences.get(userId);
    if (cached) return cached;
    const stored = this.storage ? await this.storage.getUserPreferences(userId) : null;
    const preferences = stored ?? { ...DEFAULT_PREFERENCES };
    this.preferences.set(userId, preferences);
    return preferences;
  }

  async setUserPreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
    this.preferences.set(userId, preferences);
    if (this.storage) {
      await this.storage.saveUserPreferences(userId, preferences);
    }
  }

  /**
   * Helper to construct appropriate deep link for task or approval
   */
  static buildDeepLink(type: NotificationType, data?: Partial<NotificationData>): string {
    if (data?.deepLink) return data.deepLink;
    if (data?.approvalId) {
      return `personal-ai://approvals/${data.approvalId}`;
    }
    if (data?.taskId) {
      return `personal-ai://tasks/${data.taskId}`;
    }
    return `personal-ai://notifications`;
  }

  private isCategoryEnabled(prefs: NotificationPreferences, type: NotificationType): boolean {
    if (!prefs.enabled) return false;
    switch (type) {
      case 'approval_required':
        return prefs.categories.approvalRequired;
      case 'task_completed':
        return prefs.categories.taskCompleted;
      case 'task_failed':
        return prefs.categories.taskFailed;
      case 'blocker':
        return prefs.categories.blocker;
      default:
        return true;
    }
  }

  private isQuietHoursActive(prefs: NotificationPreferences, now = new Date()): boolean {
    if (!prefs.quietHours?.enabled) return false;
    const { start, end, timezone } = prefs.quietHours;

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
      const currentMinutes = hour * 60 + minute;

      const [startHour, startMin] = start.split(':').map((s) => parseInt(s, 10));
      const [endHour, endMin] = end.split(':').map((s) => parseInt(s, 10));
      const startMinutes = (startHour ?? 0) * 60 + (startMin ?? 0);
      const endMinutes = (endHour ?? 0) * 60 + (endMin ?? 0);

      if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      } else {
        // Overnight window e.g. 22:00 to 07:00
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      }
    } catch {
      return false;
    }
  }

  /**
   * Dispatch notification with deduplication, user preferences, delivery state tracking,
   * and bounded exponential retry loop.
   */
  async dispatchNotification(
    input: SendNotificationInput,
    now = Date.now(),
  ): Promise<NotificationRecord> {
    const entityId = input.data?.approvalId ?? input.data?.taskId ?? 'global';
    const dedupKey = `notif:${input.userId}:${input.type}:${entityId}`;

    // 1. Check deduplication window
    const seen = this.dedupe.get(dedupKey);
    if (seen && seen.expiresAt > now) {
      const existing = await this.getNotification(seen.notificationId);
      if (existing) return existing;
    }

    const id = randomUUID();
    const deepLink = NotificationEngine.buildDeepLink(input.type, input.data);
    const prefs = await this.getUserPreferences(input.userId);

    const record: NotificationRecord = {
      id,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: {
        ...input.data,
        type: input.type,
        deepLink,
      },
      deliveryState: 'pending',
      attempts: 0,
      maxAttempts: this.maxRetryAttempts,
      deepLink,
      createdAt: new Date(now).toISOString(),
    };

    this.dedupe.set(dedupKey, { notificationId: id, expiresAt: now + this.dedupeWindowMs });
    await this.save(record);

    // 2. Check user preferences & categories
    if (!this.isCategoryEnabled(prefs, input.type)) {
      record.deliveryState = 'skipped';
      await this.save(record);
      return record;
    }

    // 3. Quiet hours check: non-urgent notifications are skipped or postponed
    const isUrgent = input.type === 'approval_required' || input.type === 'blocker';
    if (!isUrgent && this.isQuietHoursActive(prefs, new Date(now))) {
      record.deliveryState = 'skipped';
      await this.save(record);
      return record;
    }

    // 4. Push delivery. Tokens come from the caller when known, otherwise from the device registry;
    // without any token the notification is only available on the internal/websocket channel.
    const tokens =
      input.deviceToken !== undefined
        ? [input.deviceToken]
        : ((await this.resolveDeviceTokens?.(input.userId)) ?? []);

    if (tokens.length === 0 || !prefs.channels.push) {
      record.deliveryState = 'delivered';
      record.deliveredAt = new Date(now).toISOString();
      await this.save(record);
      return record;
    }

    record.deliveryState = 'sending';
    await this.save(record);

    let lastError: string | undefined;
    let delivered = false;

    for (const deviceToken of tokens) {
      for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
        record.attempts = attempt;
        const res = await this.fcmProvider.sendPushNotification(deviceToken, {
          title: record.title,
          body: record.body,
          data: {
            type: record.type,
            deepLink: record.deepLink,
            taskId: record.data.taskId,
            approvalId: record.data.approvalId,
          },
        });

        if (res.success) {
          delivered = true;
          break;
        }

        lastError = res.error ?? 'Unknown push dispatch error';
        record.lastError = lastError;
        if (res.error?.includes('dinonaktifkan') || res.error?.includes('disabled')) {
          break;
        }
        // Apply minimal backoff delay for simulation and tests
        if (attempt < this.maxRetryAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
        }
      }
      if (delivered) break;
    }

    if (delivered) {
      record.deliveryState = 'delivered';
      record.deliveredAt = new Date().toISOString();
      await this.update(record);
    } else {
      record.deliveryState = 'failed';
      record.lastError = lastError;
      await this.update(record);
    }

    return record;
  }

  async getNotification(id: string): Promise<NotificationRecord | undefined> {
    const stored = this.storage ? await this.storage.getNotification(id) : null;
    return stored ?? this.notifications.get(id);
  }

  async listNotifications(userId: string): Promise<NotificationRecord[]> {
    if (this.storage) return this.storage.listNotifications(userId);
    return Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markAsRead(id: string): Promise<NotificationRecord | undefined> {
    const notification = await this.getNotification(id);
    if (!notification) return undefined;
    notification.deliveryState = 'read';
    notification.readAt = new Date().toISOString();
    await this.update(notification);
    return notification;
  }

  private async save(record: NotificationRecord): Promise<void> {
    this.notifications.set(record.id, record);
    if (this.storage) {
      await this.storage.saveNotification(record);
    }
  }

  private async update(record: NotificationRecord): Promise<void> {
    this.notifications.set(record.id, record);
    if (this.storage) {
      await this.storage.updateNotification(record);
    }
  }
}
