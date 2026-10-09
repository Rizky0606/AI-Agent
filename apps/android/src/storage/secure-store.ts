export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  setAccessToken(token: string): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clearTokens(): Promise<void>;
  getServerUrl(): Promise<string | null>;
  setServerUrl(url: string): Promise<void>;
  getDeviceId(): Promise<string | null>;
  setDeviceId(id: string): Promise<void>;
}

const ACCESS_TOKEN_KEY = 'personal_ai_access_token';
const REFRESH_TOKEN_KEY = 'personal_ai_refresh_token';
const SERVER_URL_KEY = 'personal_ai_server_url';
const DEVICE_ID_KEY = 'personal_ai_device_id';

export class InMemoryTokenStorage implements TokenStorage {
  private store = new Map<string, string>();

  async getAccessToken(): Promise<string | null> {
    return this.store.get(ACCESS_TOKEN_KEY) ?? null;
  }

  async setAccessToken(token: string): Promise<void> {
    this.store.set(ACCESS_TOKEN_KEY, token);
  }

  async getRefreshToken(): Promise<string | null> {
    return this.store.get(REFRESH_TOKEN_KEY) ?? null;
  }

  async setRefreshToken(token: string): Promise<void> {
    this.store.set(REFRESH_TOKEN_KEY, token);
  }

  async clearTokens(): Promise<void> {
    this.store.delete(ACCESS_TOKEN_KEY);
    this.store.delete(REFRESH_TOKEN_KEY);
  }

  async getServerUrl(): Promise<string | null> {
    return this.store.get(SERVER_URL_KEY) ?? null;
  }

  async setServerUrl(url: string): Promise<void> {
    this.store.set(SERVER_URL_KEY, url);
  }

  async getDeviceId(): Promise<string | null> {
    return this.store.get(DEVICE_ID_KEY) ?? null;
  }

  async setDeviceId(id: string): Promise<void> {
    this.store.set(DEVICE_ID_KEY, id);
  }
}

interface SecureStoreModule {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class NativeSecureTokenStorage implements TokenStorage {
  private secureStoreModule: SecureStoreModule | null = null;
  private readonly fallbackMemory = new InMemoryTokenStorage();

  private async getModule(): Promise<SecureStoreModule | null> {
    if (this.secureStoreModule) return this.secureStoreModule;
    try {
      // Dynamic import to prevent Node ESM loader failures in test runners
      const mod = (await import('expo-secure-store')) as SecureStoreModule;
      if (typeof mod?.getItemAsync === 'function') {
        this.secureStoreModule = mod;
        return this.secureStoreModule;
      }
    } catch {
      // not in Expo runtime
    }
    return null;
  }

  async getAccessToken(): Promise<string | null> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.getAccessToken();
    try {
      return await mod.getItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      return this.fallbackMemory.getAccessToken();
    }
  }

  async setAccessToken(token: string): Promise<void> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.setAccessToken(token);
    try {
      await mod.setItemAsync(ACCESS_TOKEN_KEY, token);
    } catch {
      await this.fallbackMemory.setAccessToken(token);
    }
  }

  async getRefreshToken(): Promise<string | null> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.getRefreshToken();
    try {
      return await mod.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      return this.fallbackMemory.getRefreshToken();
    }
  }

  async setRefreshToken(token: string): Promise<void> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.setRefreshToken(token);
    try {
      await mod.setItemAsync(REFRESH_TOKEN_KEY, token);
    } catch {
      await this.fallbackMemory.setRefreshToken(token);
    }
  }

  async clearTokens(): Promise<void> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.clearTokens();
    try {
      await mod.deleteItemAsync(ACCESS_TOKEN_KEY);
      await mod.deleteItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      await this.fallbackMemory.clearTokens();
    }
  }

  async getServerUrl(): Promise<string | null> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.getServerUrl();
    try {
      return await mod.getItemAsync(SERVER_URL_KEY);
    } catch {
      return this.fallbackMemory.getServerUrl();
    }
  }

  async setServerUrl(url: string): Promise<void> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.setServerUrl(url);
    try {
      await mod.setItemAsync(SERVER_URL_KEY, url);
    } catch {
      await this.fallbackMemory.setServerUrl(url);
    }
  }

  async getDeviceId(): Promise<string | null> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.getDeviceId();
    try {
      return await mod.getItemAsync(DEVICE_ID_KEY);
    } catch {
      return this.fallbackMemory.getDeviceId();
    }
  }

  async setDeviceId(id: string): Promise<void> {
    const mod = await this.getModule();
    if (!mod) return this.fallbackMemory.setDeviceId(id);
    try {
      await mod.setItemAsync(DEVICE_ID_KEY, id);
    } catch {
      await this.fallbackMemory.setDeviceId(id);
    }
  }
}

export const defaultTokenStorage: TokenStorage = new NativeSecureTokenStorage();
