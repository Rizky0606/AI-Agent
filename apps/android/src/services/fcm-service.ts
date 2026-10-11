import type { ApiClient } from '../api/client.ts';
import { defaultApiClient } from '../api/client.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface PushNotificationPayload {
  title?: string;
  body?: string;
  data?: {
    type?:
      | 'approval_required'
      | 'task_completed'
      | 'task_failed'
      | 'blocker'
      | 'chat_message'
      | undefined;
    deepLink?: string | undefined;
    taskId?: string | undefined;
    approvalId?: string | undefined;
    conversationId?: string | undefined;
  };
}

export type NotificationHandler = (notification: PushNotificationPayload) => void;

export interface FcmServiceStatus {
  isConfigured: boolean;
  status: 'active' | 'inactive';
  reason: string;
}

export interface FcmServiceOptions {
  client?: ApiClient | undefined;
  credentialsAvailable?: boolean | undefined;
}

/**
 * Checks if Firebase Cloud Messaging credentials are present in environment or build config.
 */
export function areFcmCredentialsAvailable(): boolean {
  if (process.env['EXPO_PUBLIC_FCM_ENABLED'] === 'true') {
    return true;
  }
  if (
    process.env['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] &&
    process.env['EXPO_PUBLIC_FIREBASE_API_KEY']
  ) {
    return true;
  }
  return false;
}

export class FcmService {
  private readonly client: ApiClient;
  private readonly handlers: Set<NotificationHandler> = new Set();
  private readonly isConfiguredExplicitly?: boolean | undefined;

  constructor(options?: FcmServiceOptions | ApiClient) {
    if (options && 'getBaseUrl' in options) {
      this.client = options;
      this.isConfiguredExplicitly = undefined;
    } else {
      this.client = options?.client ?? defaultApiClient;
      this.isConfiguredExplicitly = options?.credentialsAvailable;
    }
  }

  /**
   * Returns whether FCM push notifications are configured and active.
   * If credentials are missing, returns 'inactive' with clear explanatory reason.
   */
  getStatus(): FcmServiceStatus {
    const configured = this.isConfiguredExplicitly ?? areFcmCredentialsAvailable();

    if (!configured) {
      return {
        isConfigured: false,
        status: 'inactive',
        reason: 'FCM belum aktif: kredensial Firebase / google-services.json belum dikonfigurasi.',
      };
    }

    return {
      isConfigured: true,
      status: 'active',
      reason: 'FCM aktif dan terkonfigurasi.',
    };
  }

  /**
   * Integration point for Firebase Cloud Messaging token setup.
   * In a native production build, this would interface with `@react-native-firebase/messaging`
   * or `expo-notifications`.
   */
  async registerToken(token: string): Promise<void> {
    const status = this.getStatus();
    if (!status.isConfigured) {
      console.warn(
        `[FcmService] Peringatan: FCM berstatus non-aktif (${status.reason}). Token push lokal tetap disimpan untuk kesiapan masa depan.`,
      );
    }

    useUiStore.getState().setFcmToken(token);
    try {
      // Register or update device record with active push token
      await this.client.registerDevice(`Android Device (${token.slice(0, 8)})`, 'android');
    } catch {
      // non-fatal
    }
  }

  onNotificationReceived(handler: NotificationHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  dispatchNotification(payload: PushNotificationPayload): boolean {
    const state = useUiStore.getState();
    if (!state.pushNotificationsEnabled) return false;

    const notifType = payload.data?.type;
    if (notifType === 'approval_required' && !state.notifyApprovalRequired) {
      return false;
    }
    if (
      (notifType === 'task_completed' || notifType === 'task_failed') &&
      !state.notifyTaskUpdates
    ) {
      return false;
    }
    if (notifType === 'blocker' && !state.notifyBlockers) {
      return false;
    }

    for (const handler of this.handlers) {
      try {
        handler(payload);
      } catch {
        // handler error ignored
      }
    }
    return true;
  }
}

export const defaultFcmService = new FcmService();
