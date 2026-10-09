import type { FcmPushPayload } from './types.ts';

export interface FcmSendResult {
  success: boolean;
  messageId?: string | undefined;
  error?: string | undefined;
}

export interface FcmProvider {
  sendPushNotification(deviceToken: string, payload: FcmPushPayload): Promise<FcmSendResult>;
}

export class MockFcmProvider implements FcmProvider {
  public sentMessages: Array<{ deviceToken: string; payload: FcmPushPayload; timestamp: number }> =
    [];
  public failureMode: 'none' | 'transient_fail_then_succeed' | 'always_fail' = 'none';
  public failuresBeforeSuccess = 2;
  private attemptCounts = new Map<string, number>();

  async sendPushNotification(deviceToken: string, payload: FcmPushPayload): Promise<FcmSendResult> {
    const attempts = (this.attemptCounts.get(deviceToken) ?? 0) + 1;
    this.attemptCounts.set(deviceToken, attempts);

    if (this.failureMode === 'always_fail') {
      return {
        success: false,
        error: 'FCM gateway returned 503 Service Unavailable',
      };
    }

    if (this.failureMode === 'transient_fail_then_succeed') {
      if (attempts <= this.failuresBeforeSuccess) {
        return {
          success: false,
          error: `Temporary FCM network error on attempt ${attempts}`,
        };
      }
    }

    this.sentMessages.push({
      deviceToken,
      payload,
      timestamp: Date.now(),
    });

    return {
      success: true,
      messageId: `projects/personal-ai-os/messages/msg-${Date.now()}-${attempts}`,
    };
  }

  reset(): void {
    this.sentMessages = [];
    this.attemptCounts.clear();
    this.failureMode = 'none';
    this.failuresBeforeSuccess = 2;
  }
}

export class HttpFcmProvider implements FcmProvider {
  private readonly projectId: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(options: { projectId: string; accessToken: string; baseUrl?: string | undefined }) {
    this.projectId = options.projectId;
    this.accessToken = options.accessToken;
    this.baseUrl =
      options.baseUrl ?? `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
  }

  async sendPushNotification(deviceToken: string, payload: FcmPushPayload): Promise<FcmSendResult> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            data: payload.data,
            android: {
              priority: 'HIGH',
              notification: {
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                channelId: 'personal_ai_notifications',
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `FCM HTTP ${response.status}: ${errorText}`,
        };
      }

      const resData = (await response.json()) as { name?: string };
      return {
        success: true,
        messageId: resData.name,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
