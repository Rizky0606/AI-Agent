import * as fs from 'node:fs';
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

export class DisabledFcmProvider implements FcmProvider {
  public readonly reason: string;

  constructor(
    reason = 'FCM_SERVICE_ACCOUNT_JSON tidak dikonfigurasi. Pengiriman push notification dinonaktifkan.',
  ) {
    this.reason = reason;
    console.warn(`[FCM] Peringatan: ${this.reason}`);
  }

  async sendPushNotification(deviceToken: string, payload: FcmPushPayload): Promise<FcmSendResult> {
    console.warn(
      `[FCM] Pengiriman notifikasi push (${payload.title}) ke token "${deviceToken.slice(0, 10)}..." dilewati: ${this.reason}`,
    );
    return {
      success: false,
      error: `Pengiriman dinonaktifkan: ${this.reason}`,
    };
  }
}

export interface FcmServiceAccountData {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

export const createFcmProviderFromEnv = (): FcmProvider => {
  const envVal = process.env.FCM_SERVICE_ACCOUNT_JSON ?? process.env.FCM_SERVICE_ACCOUNT_PATH;
  if (!envVal || envVal.trim() === '') {
    return new DisabledFcmProvider(
      'FCM_SERVICE_ACCOUNT_JSON tidak dikonfigurasi. Pengiriman push notification dinonaktifkan (bukan mock).',
    );
  }

  let jsonStr = envVal.trim();
  if (!jsonStr.startsWith('{')) {
    // Treat as file path
    try {
      if (fs.existsSync(jsonStr)) {
        jsonStr = fs.readFileSync(jsonStr, 'utf8').trim();
      } else {
        return new DisabledFcmProvider(
          `File FCM_SERVICE_ACCOUNT_JSON tidak ditemukan di path "${envVal}". Pengiriman dinonaktifkan.`,
        );
      }
    } catch {
      return new DisabledFcmProvider(
        `Gagal membaca file FCM service account pada path "${envVal}". Pengiriman dinonaktifkan.`,
      );
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as FcmServiceAccountData;
    if (!parsed.project_id) {
      return new DisabledFcmProvider(
        'Format FCM_SERVICE_ACCOUNT_JSON tidak valid: field "project_id" tidak ditemukan. Pengiriman dinonaktifkan.',
      );
    }
    // If accessToken or mock URL is provided, or initialize HttpFcmProvider
    return new HttpFcmProvider({
      projectId: parsed.project_id,
      accessToken: 'dummy-env-token',
    });
  } catch (err: unknown) {
    return new DisabledFcmProvider(
      `Format JSON pada FCM_SERVICE_ACCOUNT_JSON rusak: ${err instanceof Error ? err.message : String(err)}. Pengiriman dinonaktifkan.`,
    );
  }
};
