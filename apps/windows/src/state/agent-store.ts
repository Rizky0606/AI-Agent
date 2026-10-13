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

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; cancelled?: boolean; }
export interface ChatConversation { id: string; title: string; messages: ChatMessage[]; }

export interface AgentState {
  serverUrl: string;
  authToken: string;
  connectionStatus: ConnectionStatus;
  lastConnectedAt: string | null;
  device: DeviceIdentity;
  capabilities: Record<CapabilityName, boolean>;
  allowedRoots: string[];
  tasks: LocalTaskEntry[];
  logs: DiagnosticLog[];
  conversations: ChatConversation[];
  activeConversationId: string;
  chatDraft: string;
  chatStreaming: boolean;
  chatError: string | null;
  selectedModel: string;
  selectedMode: 'auto' | 'fast' | 'coding' | 'complex' | 'research';
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
  setChatDraft: (draft: string) => void;
  setActiveConversation: (id: string) => void;
  newConversation: () => void;
  sendChat: () => void;
  cancelChat: () => void;
  retryChat: () => void;
  clearChatError: () => void;
  setSelectedModel: (model: string) => void;
  setSelectedMode: (mode: AgentState['selectedMode']) => void;
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
    conversations: [{ id: '', title: 'New conversation', messages: [] }],
    activeConversationId: '',
    chatDraft: '',
    chatStreaming: false,
    chatError: null,
    selectedModel: 'auto',
    selectedMode: 'auto',

    setServerUrl: (url) => set({ serverUrl: url }),
    setChatDraft: (chatDraft) => set({ chatDraft }),
    setActiveConversation: (activeConversationId) => set({ activeConversationId }),
    newConversation: () => { const id = crypto.randomUUID(); set((state) => ({ conversations: [{ id, title: 'New conversation', messages: [] }, ...state.conversations], activeConversationId: id })); },
    sendChat: () => { const state = get(); if (!state.chatDraft.trim() || !activeConnection) return; const id = state.activeConversationId || crypto.randomUUID(); set({ activeConversationId: id, chatDraft: '', chatStreaming: true }); activeConnection.sendChatMessage({ type: 'chat.send', conversationId: id, content: state.chatDraft.trim(), model: state.selectedModel === 'auto' ? undefined : state.selectedModel, mode: state.selectedMode }); },
    cancelChat: () => { activeConnection?.cancelChat(); set({ chatStreaming: false }); },
    retryChat: () => undefined,
    clearChatError: () => set({ chatError: null }),
    setSelectedModel: (selectedModel) => set({ selectedModel }),
    setSelectedMode: (selectedMode) => set({ selectedMode }),
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
          onChatMessage: (frame) => set((current) => {
            const conversationId = frame.conversationId ?? current.activeConversationId;
            const conversations = current.conversations.map((conversation) => {
              if (conversation.id !== conversationId) return conversation;
              const id = frame.messageId ?? `assistant-${Date.now()}`;
              const existing = conversation.messages.find((message) => message.id === id);
              const content = frame.delta ? `${existing?.content ?? ''}${frame.delta}` : frame.content ?? existing?.content ?? '';
              return { ...conversation, messages: existing ? conversation.messages.map((message) => message.id === id ? { ...message, content } : message) : [...conversation.messages, { id, role: 'assistant' as const, content }] };
            });
            return { conversations, chatStreaming: frame.type === 'message.delta', chatError: frame.type === 'error' ? frame.message ?? frame.code ?? 'Chat error' : current.chatError };
          }),
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
