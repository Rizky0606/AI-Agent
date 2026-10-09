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

export class FcmService {
  private readonly client: ApiClient;
  private readonly handlers: Set<NotificationHandler> = new Set();

  constructor(client: ApiClient = defaultApiClient) {
    this.client = client;
  }

  /**
   * Integration point for Firebase Cloud Messaging token setup.
   * In a native production build, this would interface with `@react-native-firebase/messaging`
   * or `expo-notifications`.
   */
  async registerToken(token: string): Promise<void> {
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
