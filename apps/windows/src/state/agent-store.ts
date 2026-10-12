import { create } from 'zustand';
import type { ConnectionStatus } from '../connection/agent-connection.ts';
import { type CapabilityName, CapabilityRegistry } from '../security/capability-registry.ts';
import { PathValidator } from '../security/path-validator.ts';
import { type DeviceIdentity, DeviceIdentityManager } from '../connection/device-identity.ts';

export interface LocalTaskEntry {
  id: string;
  command: string;
  cwd: string;
  capability: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: string;
  durationMs?: number | undefined;
  exitCode?: number | undefined;
  output?: string | undefined;
  error?: string | undefined;
}

export interface DiagnosticLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface AgentState {
  // Connection & Server
  serverUrl: string;
  authToken: string;
  connectionStatus: ConnectionStatus;
  lastConnectedAt: string | null;

  // Device
  device: DeviceIdentity;

  // Security & Capabilities
  capabilities: Record<CapabilityName, boolean>;
  allowedRoots: string[];

  // Local Tasks
  tasks: LocalTaskEntry[];

  // Diagnostics Logs
  logs: DiagnosticLog[];

  // Actions
  setServerUrl: (url: string) => void;
  setAuthToken: (token: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setDevice: (device: DeviceIdentity) => void;
  syncDeviceIdentity: () => Promise<void>;
  connectToServer: () => Promise<void>;
  disconnectFromServer: () => void;
  toggleCapability: (name: CapabilityName, enabled: boolean) => void;
  addAllowedRoot: (path: string) => void;
  removeAllowedRoot: (path: string) => void;
  addTask: (task: LocalTaskEntry) => void;
  updateTask: (id: string, updates: Partial<LocalTaskEntry>) => void;
  addLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  clearLogs: () => void;
  resetAllDefaults: () => void;
}

export const createAgentStore = (
  registry: CapabilityRegistry,
  pathValidator: PathValidator,
  identityMgr: DeviceIdentityManager,
  executor?: import('../security/types.ts').ICommandExecutor,
) => {
  let activeConnection: import('../connection/agent-connection.ts').AgentConnection | null = null;

  const getInitialCapabilities = (): Record<CapabilityName, boolean> => {
    const rules = registry.getAllRules();
    const map = {} as Record<CapabilityName, boolean>;
    for (const key of Object.keys(rules) as CapabilityName[]) {
      map[key] = rules[key]!.enabled;
    }
    return map;
  };

  return create<AgentState>((set, get) => ({
    serverUrl: import.meta.env.VITE_SERVER_URL ?? 'https://ai.ojixx.my.id',
    authToken: '',
    connectionStatus: 'disconnected',
    lastConnectedAt: null,

    device: identityMgr.getIdentity(),
    capabilities: getInitialCapabilities(),
    allowedRoots: pathValidator.getAllowedRoots(),

    tasks: [],
    logs: [],

    setServerUrl: (url) => set({ serverUrl: url }),
    setAuthToken: (token) => set({ authToken: token }),
    setDevice: (device) => set({ device }),
    setConnectionStatus: (status) =>
      set((state) => ({
        connectionStatus: status,
        lastConnectedAt: status === 'connected' ? new Date().toISOString() : state.lastConnectedAt,
      })),

    syncDeviceIdentity: async () => {
      const updated = await identityMgr.syncWithTauri();
      set({ device: updated });
    },

    connectToServer: async () => {
      const state = get();
      if (!state.authToken.trim()) {
        state.addLog('warn', 'Token autentikasi belum diisi. Masukkan token di tab Settings.');
        return;
      }
      if (activeConnection) {
        activeConnection.disconnect();
      }

      const { AgentConnection } = await import('../connection/agent-connection.ts');
      const { TauriCommandExecutor } = await import('../security/tauri-executor.ts');
      const exec = executor ?? new TauriCommandExecutor(registry, pathValidator);

      activeConnection = new AgentConnection({
        serverUrl: state.serverUrl,
        token: state.authToken,
        identity: state.device,
        executor: exec,
        onStatusChange: (status) => set({ connectionStatus: status }),
        onLogMessage: (level, msg) => get().addLog(level, msg),
      });

      await activeConnection.connect();
    },

    disconnectFromServer: () => {
      if (activeConnection) {
        activeConnection.disconnect();
        activeConnection = null;
      }
      set({ connectionStatus: 'disconnected' });
    },

    toggleCapability: (name, enabled) => {
      registry.setCapability(name, enabled);
      set((state) => ({
        capabilities: {
          ...state.capabilities,
          [name]: enabled,
        },
      }));
    },

    addAllowedRoot: (rootPath) => {
      pathValidator.addAllowedRoot(rootPath);
      set({ allowedRoots: pathValidator.getAllowedRoots() });
    },

    removeAllowedRoot: (rootPath) => {
      pathValidator.removeAllowedRoot(rootPath);
      set({ allowedRoots: pathValidator.getAllowedRoots() });
    },

    addTask: (task) =>
      set((state) => ({
        tasks: [task, ...state.tasks].slice(0, 100), // keep latest 100
      })),

    updateTask: (id, updates) =>
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      })),

    addLog: (level, message) =>
      set((state) => ({
        logs: [
          {
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            level,
            message,
          },
          ...state.logs,
        ].slice(0, 300), // keep latest 300 logs
      })),

    clearLogs: () => set({ logs: [] }),

    resetAllDefaults: () => {
      registry.resetToDefaults();
      set({
        capabilities: getInitialCapabilities(),
      });
    },
  }));
};
