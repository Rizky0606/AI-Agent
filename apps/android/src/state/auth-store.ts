import { create } from 'zustand';
import { ApiClient, defaultApiClient } from '../api/client.ts';
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
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  registerDevice: (deviceName?: string) => Promise<void>;
  clearError: () => void;
}

export const createAuthStore = (client: ApiClient = defaultApiClient) =>
  create<AuthState>((set, get) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
    serverUrl: client.getBaseUrl(),
    device: null,

    initialize: async () => {
      set({ isLoading: true, error: null });
      try {
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

export const useAuthStore = createAuthStore();
