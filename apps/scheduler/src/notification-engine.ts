import { randomUUID } from 'node:crypto';
import type { FcmProvider } from './fcm-provider.ts';
import {
  type NotificationData,
  type NotificationPreferences,
  type NotificationRecord,
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

export class NotificationEngine {
  private readonly notifications = new Map<string, NotificationRecord>();
  private readonly userPreferences = new Map<string, NotificationPreferences>();
  private readonly recentDedupeKeys = new Map<string, number>(); // dedupKey -> expireTime
  private readonly fcmProvider: FcmProvider;
  private readonly dedupeWindowMs: number;
  private readonly maxRetryAttempts: number;

  constructor(options?: {
    fcmProvider?: FcmProvider | undefined;
    dedupeWindowMs?: number | undefined;
    maxRetryAttempts?: number | undefined;
  }) {
    this.fcmProvider = options?.fcmProvider ?? {
      sendPushNotification: async () => ({ success: true }),
    };
    this.dedupeWindowMs = options?.dedupeWindowMs ?? 60 * 1000; // 60 seconds
    this.maxRetryAttempts = options?.maxRetryAttempts ?? 3; // Max 3 attempts
  }

  setUserPreferences(userId: string, preferences: NotificationPreferences): void {
    this.userPreferences.set(userId, preferences);
  }

  getUserPreferences(userId: string): NotificationPreferences {
    return (
      this.userPreferences.get(userId) ?? {
        enabled: true,
        channels: { push: true, websocket: true },
        categories: {
          approvalRequired: true,
          taskCompleted: true,
          taskFailed: true,
          blocker: true,
        },
      }
    );
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
    const expiresAt = this.recentDedupeKeys.get(dedupKey);
    if (expiresAt && expiresAt > now) {
      // Find previous notification or return duplicate marked record
      const existing = Array.from(this.notifications.values()).find(
        (n) => n.userId === input.userId && n.type === input.type,
      );
      if (existing) return existing;
    }

    this.recentDedupeKeys.set(dedupKey, now + this.dedupeWindowMs);

    const id = randomUUID();
    const deepLink = NotificationEngine.buildDeepLink(input.type, input.data);
    const prefs = this.getUserPreferences(input.userId);

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

    this.notifications.set(id, record);

    // 2. Check user preferences & categories
    if (!this.isCategoryEnabled(prefs, input.type)) {
      record.deliveryState = 'skipped';
      return record;
    }

    // 3. Quiet hours check: non-urgent notifications are skipped or postponed
    const isUrgent = input.type === 'approval_required' || input.type === 'blocker';
    if (!isUrgent && this.isQuietHoursActive(prefs, new Date(now))) {
      record.deliveryState = 'skipped';
      return record;
    }

    // 4. Send via FCM if deviceToken provided and push channel enabled
    if (input.deviceToken && prefs.channels.push) {
      record.deliveryState = 'sending';

      let lastError: string | undefined;
      let success = false;

      for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
        record.attempts = attempt;
        const res = await this.fcmProvider.sendPushNotification(input.deviceToken, {
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
          success = true;
          record.deliveryState = 'delivered';
          record.deliveredAt = new Date().toISOString();
          break;
        } else {
          lastError = res.error ?? 'Unknown push dispatch error';
          record.lastError = lastError;
          // Apply minimal backoff delay for simulation and tests
          if (attempt < this.maxRetryAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
          }
        }
      }

      if (!success) {
        record.deliveryState = 'failed';
        record.lastError = lastError;
      }
    } else {
      // Delivered via internal/websocket channels
      record.deliveryState = 'delivered';
      record.deliveredAt = new Date(now).toISOString();
    }

    return record;
  }

  getNotification(id: string): NotificationRecord | undefined {
    return this.notifications.get(id);
  }

  listNotifications(userId: string): NotificationRecord[] {
    return Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markAsRead(id: string): NotificationRecord | undefined {
    const notif = this.notifications.get(id);
    if (notif) {
      notif.deliveryState = 'read';
      notif.readAt = new Date().toISOString();
    }
    return notif;
  }
}
