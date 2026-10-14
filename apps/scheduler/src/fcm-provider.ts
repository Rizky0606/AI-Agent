import { createSign } from 'node:crypto';
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

export interface FcmAccessTokenSource {
  getAccessToken(now?: number): Promise<string>;
}

export interface ServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

const FCM_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const ASSERTION_LIFETIME_SECONDS = 3600;

/**
 * Menukar service account Google menjadi access token OAuth2 lewat grant
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` dan menyimpannya sampai mendekati kedaluwarsa.
 * Token yang gagal ditukar melempar error; tidak ada token literal pengganti.
 */
export class ServiceAccountTokenSource implements FcmAccessTokenSource {
  private readonly credentials: ServiceAccountCredentials;
  private cachedToken: { value: string; expiresAt: number } | undefined;

  constructor(credentials: ServiceAccountCredentials) {
    this.credentials = credentials;
  }

  private createAssertion(now: number): string {
    const issuedAt = Math.floor(now / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({
        iss: this.credentials.clientEmail,
        scope: FCM_MESSAGING_SCOPE,
        aud: this.credentials.tokenUri,
        iat: issuedAt,
        exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
      }),
    ).toString('base64url');
    const signingInput = `${header}.${claims}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.credentials.privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  async getAccessToken(now = Date.now()): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - now > TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken.value;
    }

    const response = await fetch(this.credentials.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.createAssertion(now),
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(
        `Penukaran token OAuth FCM gagal: HTTP ${response.status} ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new Error('Penukaran token OAuth FCM tidak mengembalikan access_token.');
    }

    this.cachedToken = {
      value: payload.access_token,
      expiresAt: now + (payload.expires_in ?? ASSERTION_LIFETIME_SECONDS) * 1000,
    };
    return this.cachedToken.value;
  }
}

export class HttpFcmProvider implements FcmProvider {
  private readonly projectId: string;
  private readonly tokenSource: FcmAccessTokenSource;
  private readonly baseUrl: string;

  constructor(options: {
    projectId: string;
    tokenSource: FcmAccessTokenSource;
    baseUrl?: string | undefined;
  }) {
    this.projectId = options.projectId;
    this.tokenSource = options.tokenSource;
    this.baseUrl =
      options.baseUrl ?? `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
  }

  async sendPushNotification(deviceToken: string, payload: FcmPushPayload): Promise<FcmSendResult> {
    try {
      const accessToken = await this.tokenSource.getAccessToken();
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
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
  token_uri?: string;
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
    if (!parsed.client_email || !parsed.private_key) {
      return new DisabledFcmProvider(
        'Format FCM_SERVICE_ACCOUNT_JSON tidak valid: field "client_email" atau "private_key" tidak ditemukan. Pengiriman dinonaktifkan.',
      );
    }
    return new HttpFcmProvider({
      projectId: parsed.project_id,
      tokenSource: new ServiceAccountTokenSource({
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
        tokenUri: parsed.token_uri ?? DEFAULT_TOKEN_URI,
      }),
    });
  } catch (err: unknown) {
    return new DisabledFcmProvider(
      `Format JSON pada FCM_SERVICE_ACCOUNT_JSON rusak: ${err instanceof Error ? err.message : String(err)}. Pengiriman dinonaktifkan.`,
    );
  }
};
