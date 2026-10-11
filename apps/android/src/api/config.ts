export interface AndroidConfig {
  apiUrl: string;
  wsUrl: string;
}

export const DEFAULT_API_URL = 'http://10.0.2.2:3000';

/**
 * Derives the WebSocket URL from an HTTP/HTTPS URL by replacing the protocol scheme.
 */
export function deriveWsUrl(httpUrl: string): string {
  const trimmed = httpUrl.replace(/\/+$/, '');
  return trimmed.replace(/^http(s?):/i, 'ws$1:');
}

/**
 * Resolves the initial API URL from configuration (EXPO_PUBLIC_API_URL) with fallback.
 */
export function getInitialApiUrl(): string {
  const envUrl = process.env['EXPO_PUBLIC_API_URL'];
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return DEFAULT_API_URL;
}

/**
 * Resolves the initial WebSocket URL from configuration (EXPO_PUBLIC_WS_URL)
 * or derives it from the configured API URL.
 */
export function getInitialWsUrl(): string {
  const envWsUrl = process.env['EXPO_PUBLIC_WS_URL'];
  if (envWsUrl && typeof envWsUrl === 'string' && envWsUrl.trim().length > 0) {
    return envWsUrl.trim().replace(/\/+$/, '');
  }
  return deriveWsUrl(getInitialApiUrl());
}

export function getAppConfig(): AndroidConfig {
  return {
    apiUrl: getInitialApiUrl(),
    wsUrl: getInitialWsUrl(),
  };
}
