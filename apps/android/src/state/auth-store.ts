import { create } from 'zustand';
import { ApiClient, defaultApiClient } from '../api/client.ts';
import { createPkceParams, parseAuthRedirect } from '../api/pkce.ts';
import type { Device, User } from '../api/types.ts';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  serverUrl: string;
  device: Device | null;

  // Actions
  initialize: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  registerDevice: (deviceName?: string) => Promise<void>;
  clearError: () => void;
}

export const createAuthStore = (client: ApiClient = defaultApiClient) => {
  let pendingLogin: {
    state: string;
    resolve: (code: string) => void;
    reject: (err: Error) => void;
  } | null = null;
  let linkSubscription: { remove(): void } | null = null;

  const handleAuthUrl = (url: string): void => {
    const pending = pendingLogin;
    if (!pending) return;
    let code: string | null;
    try {
      code = parseAuthRedirect(url, pending.state)?.code ?? null;
    } catch (err) {
      pendingLogin = null;
      pending.reject(err instanceof Error ? err : new Error('Google sign-in failed'));
      return;
    }
    if (!code) return; // unrelated deep link, keep waiting
    pendingLogin = null;
    pending.resolve(code);
  };

  // Dynamic import: react-native cannot be loaded by the Node test runtime.
  const ensureLinkListener = async (): Promise<void> => {
    if (linkSubscription) return;
    try {
      const { Linking } = await import('react-native');
      linkSubscription = Linking.addEventListener('url', ({ url }) => handleAuthUrl(url));
    } catch {
      // not in a React Native runtime
    }
  };

  return create<AuthState>((set, get) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
    serverUrl: client.getBaseUrl(),
    device: null,

    initialize: async () => {
      set({ isLoading: true, error: null });
      try {
        await ensureLinkListener();
        const storage = client.getStorage();
        const storedUrl = await storage.getServerUrl();
        if (storedUrl) {
          client.setBaseUrl(storedUrl);
          set({ serverUrl: storedUrl });
        }

        const token = await storage.getAccessToken();
        if (!token) {
          set({ isLoading: false, isAuthenticated: false, user: null });
          return;
        }

        const me = await client.getMe();
        set({ user: me.user, isAuthenticated: true, isLoading: false });

        // Auto-register device if not registered
        const deviceId = await storage.getDeviceId();
        if (!deviceId) {
          await get().registerDevice();
        }
      } catch (err) {
        set({
          isLoading: false,
          isAuthenticated: false,
          user: null,
          error: err instanceof Error ? err.message : 'Initialization failed',
        });
      }
    },

    loginWithGoogle: async () => {
      set({ isLoading: true, error: null });
      try {
        const { verifier, challenge, state } = await createPkceParams();
        // Bounded: if the user abandons the browser, the button must not stay disabled forever.
        const codePromise = new Promise<string>((resolve, reject) => {
          pendingLogin = { state, resolve, reject };
          setTimeout(() => {
            if (pendingLogin?.state !== state) return;
            pendingLogin = null;
            reject(new Error('Google sign-in timed out. Coba lagi.'));
          }, 300_000);
        });

        await ensureLinkListener();
        const { Linking } = await import('react-native');
        await Linking.openURL(client.googleStartUrl(challenge, state));

        const code = await codePromise;
        const res = await client.exchangeLoginCode(code, verifier);
        set({ user: res.user, isAuthenticated: true, isLoading: false, error: null });
        await get().registerDevice();
      } catch (err) {
        pendingLogin = null;
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : 'Google sign-in failed',
        });
        throw err;
      }
    },

    login: async (email: string, pass: string) => {
      set({ isLoading: true, error: null });
      try {
        const res = await client.login(email, pass);
        set({ user: res.user, isAuthenticated: true, isLoading: false });
        await get().registerDevice();
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : 'Login failed',
        });
        throw err;
      }
    },

    register: async (email: string, pass: string) => {
      set({ isLoading: true, error: null });
      try {
        const res = await client.register(email, pass);
        set({ user: res.user, isAuthenticated: true, isLoading: false });
        await get().registerDevice();
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : 'Registration failed',
        });
        throw err;
      }
    },

    logout: async () => {
      set({ isLoading: true });
      try {
        await client.logout();
      } finally {
        set({ user: null, isAuthenticated: false, isLoading: false, device: null });
      }
    },

    setServerUrl: async (url: string) => {
      client.setBaseUrl(url);
      await client.getStorage().setServerUrl(url);
      set({ serverUrl: url });
    },

    registerDevice: async (deviceName = 'Personal Android Client') => {
      try {
        const res = await client.registerDevice(deviceName, 'android');
        set({ device: res.device });
      } catch {
        // non-blocking device registration
      }
    },

    clearError: () => set({ error: null }),
  }));
};

export const useAuthStore = createAuthStore();
