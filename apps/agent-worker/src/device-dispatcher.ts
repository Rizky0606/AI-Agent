import { DeviceOfflineError, type DeviceCommandResult } from '@personal-ai-os/api/services';

export interface DeviceCommandRequest {
  userId: string;
  deviceId: string;
  command: string;
  capability?: string | undefined;
  action?: string | undefined;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Presence and command dispatch for the user's devices.
 *
 * The Windows agent dials the API, so the sockets live in the API process and the worker has none
 * of its own. Everything here therefore goes through the API's `/v1/internal/*` routes, which are
 * token-guarded and never exposed by the reverse proxy.
 */
export interface DeviceDispatcher {
  listOnlineDevices(userId: string, platform: string): Promise<string[]>;
  dispatchCommand(request: DeviceCommandRequest): Promise<DeviceCommandResult>;
}

/** Extra time on top of the device's own timeout before the worker gives up on the API call. */
const DISPATCH_GRACE_MS = 15_000;

const parseDeviceIds = (body: unknown): string[] => {
  if (typeof body !== 'object' || body === null || !('devices' in body)) return [];
  const devices = body.devices;
  return Array.isArray(devices) ? devices.filter((id): id is string => typeof id === 'string') : [];
};

const failureDetail = (body: unknown, status: number): string => {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = body.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }
  }
  return `HTTP ${status}`;
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export class HttpDeviceDispatcher implements DeviceDispatcher {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: { baseUrl: string; token: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
  }

  private async send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, 'x-internal-token': this.token },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`API tidak dapat dihubungi untuk dispatch perangkat (${path}): ${detail}`);
    }
  }

  async listOnlineDevices(userId: string, platform: string): Promise<string[]> {
    const response = await this.send(
      `/v1/internal/devices?userId=${encodeURIComponent(userId)}&platform=${encodeURIComponent(platform)}`,
      { method: 'GET' },
      10_000,
    );
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(`Gagal membaca perangkat online: ${failureDetail(body, response.status)}`);
    }
    return parseDeviceIds(body);
  }

  async dispatchCommand(request: DeviceCommandRequest): Promise<DeviceCommandResult> {
    const response = await this.send(
      '/v1/internal/device-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      },
      (request.timeoutMs ?? 60_000) + DISPATCH_GRACE_MS,
    );
    const body = await readJson(response);
    if (response.status === 404) {
      throw new DeviceOfflineError(request.deviceId);
    }
    if (!response.ok) {
      throw new Error(`Dispatch perintah ke perangkat gagal: ${failureDetail(body, response.status)}`);
    }
    if (typeof body !== 'object' || body === null || !('result' in body)) {
      throw new Error('Perangkat tidak mengembalikan hasil perintah yang dapat dibaca.');
    }
    const result = body.result;
    if (
      typeof result !== 'object' ||
      result === null ||
      !('commandId' in result) ||
      typeof result.commandId !== 'string' ||
      !('success' in result) ||
      typeof result.success !== 'boolean'
    ) {
      throw new Error('Hasil perintah dari perangkat tidak lengkap; task tidak dapat diverifikasi.');
    }
    return result as DeviceCommandResult;
  }
}
