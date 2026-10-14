import { create } from 'zustand';
import type { TaskEventEnvelope, TaskRecord } from '@personal-ai-os/shared';
import { ApiClient, type ApprovalRecord, type ArtifactItem, type ArtifactPreview, type AuthSession, type ModelDescriptor } from '../api/client.ts';
import { type ConnectionStatus } from '../connection/agent-connection.ts';
import { TaskEventsStream, type StreamStatus } from '../connection/events-stream.ts';
import { type CapabilityName, CapabilityRegistry } from '../security/capability-registry.ts';
import { PathValidator } from '../security/path-validator.ts';
import { type DeviceIdentity, DeviceIdentityManager } from '../connection/device-identity.ts';
import { invoke } from '@tauri-apps/api/core';
import { buildGoogleStartUrl, codeChallengeFor, parseCallbackQuery, randomBase64Url } from '../auth/google.ts';


export interface DiagnosticLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Persisted session; `serverUrl` stays in-memory like it always has. */
const SESSION_STORAGE_KEY = 'personal-ai-os.windows.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  email: string;
}

const readStoredSession = (): StoredSession => {
  const empty: StoredSession = { accessToken: '', refreshToken: '', email: '' };
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    return {
      accessToken: parsed.accessToken ?? '',
      refreshToken: parsed.refreshToken ?? '',
      email: parsed.email ?? '',
    };
  } catch {
    // Storage unavailable (private mode, tests): the session lives in memory only.
    return empty;
  }
};

const persistSession = (session: StoredSession): void => {
  try {
    globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Same as above: nothing to do when storage is unavailable.
  }
};

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; cancelled?: boolean; }
export interface ChatConversation { id: string; title: string; messages: ChatMessage[]; }

export interface TaskEventEntry {
  id: string;
  eventType: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface ArtifactPreviewState {
  artifactId: string;
  content: string;
  truncated: boolean;
}
export interface AgentState {
  serverUrl: string;
  authToken: string;
  refreshToken: string;
  userEmail: string;
  connectionStatus: ConnectionStatus;
  device: DeviceIdentity;
  capabilities: Record<CapabilityName, boolean>;
  allowedRoots: string[];
  logs: DiagnosticLog[];
  conversations: ChatConversation[];
  activeConversationId: string;
  chatDraft: string;
  chatStreaming: boolean;
  chatError: string | null;
  selectedModel: string;
  selectedMode: 'auto' | 'fast' | 'coding' | 'complex' | 'research';
  serverTasks: TaskRecord[];
  selectedTaskId: string | null;
  selectedTask: TaskRecord | null;
  taskEvents: TaskEventEntry[];
  eventStreamStatus: StreamStatus;
  approvals: ApprovalRecord[];
  artifacts: ArtifactItem[];
  artifactPreview: ArtifactPreviewState | null;
  apiError: string | null;
  setServerUrl: (url: string) => void;
  setAuthToken: (token: string) => void;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setDevice: (device: DeviceIdentity) => void;
  syncDeviceIdentity: () => Promise<void>;
  connectToServer: () => Promise<void>;
  disconnectFromServer: () => void;
  toggleCapability: (name: CapabilityName, enabled: boolean) => void;
  addAllowedRoot: (path: string) => void;
  removeAllowedRoot: (path: string) => void;
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
  refreshServerTasks: () => Promise<void>;
  selectServerTask: (taskId: string) => Promise<void>;
  refreshTaskEvents: () => Promise<void>;
  pauseServerTask: (taskId: string) => Promise<void>;
  resumeServerTask: (taskId: string) => Promise<void>;
  cancelServerTask: (taskId: string) => Promise<void>;
  refreshApprovals: (status?: string | undefined) => Promise<void>;
  decideApproval: (approvalId: string, decision: 'approve' | 'deny', reason?: string | undefined) => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  openArtifact: (artifactId: string) => Promise<void>;
  closeArtifactPreview: () => void;
  clearApiError: () => void;
  models: ModelDescriptor[];
  modelCatalogStatus: string | null;
  refreshModels: () => Promise<void>;
}

export const createAgentStore = (
  registry: CapabilityRegistry,
  pathValidator: PathValidator,
  identityMgr: DeviceIdentityManager,
  executor?: import('../security/types.ts').ICommandExecutor,
) => {
  let activeConnection: import('../connection/agent-connection.ts').AgentConnection | null = null;
  let loginInFlight = false;
  const getInitialCapabilities = (): Record<CapabilityName, boolean> => {
    const rules = registry.getAllRules();
    const map = {} as Record<CapabilityName, boolean>;
    for (const key of Object.keys(rules) as CapabilityName[]) {
      map[key] = rules[key]!.enabled;
    }
    return map;
  };
  return create<AgentState>((set, get) => {
    const applySession = (session: AuthSession): void => {
      persistSession({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        email: session.user.email,
      });
      set({
        authToken: session.accessToken,
        refreshToken: session.refreshToken,
        userEmail: session.user.email,
      });
    };
    const clearSession = (): void => {
      persistSession({ accessToken: '', refreshToken: '', email: '' });
      set({ authToken: '', refreshToken: '', userEmail: '' });
    };
    const api = (): ApiClient =>
      new ApiClient({
        baseUrl: () => get().serverUrl,
        token: () => get().authToken,
        refresh: async () => {
          const { refreshToken } = get();
          if (!refreshToken) return null; // Manual token: let the 401 surface as-is.
          const session = await api().refreshSession(refreshToken);
          applySession(session);
          return session.accessToken;
        },
      });
    let eventsStream: TaskEventsStream | null = null;
    const appendEvent = (event: TaskEventEnvelope): void => {
      set((state) => ({
        taskEvents: [
          ...state.taskEvents,
          {
            id: event.id,
            eventType: event.eventType,
            createdAt: event.createdAt,
            payload: event.payload ?? {},
          },
        ],
      }));
      if (event.eventType === 'task.completed' || event.eventType === 'task.failed' || event.eventType === 'task.cancelled') {
        const taskId = get().selectedTaskId;
        if (taskId) void get().selectServerTask(taskId);
      }
    };

    const run = async (action: () => Promise<void>): Promise<void> => {
      try {
        await action();
        set({ apiError: null });
      } catch (error) {
        set({ apiError: error instanceof Error ? error.message : String(error) });
      }
    };
    const storedSession = readStoredSession();
    return {
    serverUrl: import.meta.env.VITE_SERVER_URL ?? 'https://ai.ojixx.my.id',
    authToken: storedSession.accessToken,
    refreshToken: storedSession.refreshToken,
    userEmail: storedSession.email,
    connectionStatus: 'disconnected',

    device: identityMgr.getIdentity(),
    capabilities: getInitialCapabilities(),
    allowedRoots: pathValidator.getAllowedRoots(),

    logs: [],
    conversations: [{ id: '', title: 'New conversation', messages: [] }],
    activeConversationId: '',
    chatDraft: '',
    chatStreaming: false,
    chatError: null,
    selectedModel: 'auto',
    selectedMode: 'auto',
    serverTasks: [],
    selectedTaskId: null,
    selectedTask: null,
    taskEvents: [],
    eventStreamStatus: 'disconnected',
    approvals: [],
    artifacts: [],
    artifactPreview: null,
    apiError: null,
    models: [],
    modelCatalogStatus: null,

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

    refreshServerTasks: () => run(async () => {
      const { tasks } = await api().listTasks();
      set({ serverTasks: tasks });
    }),

    selectServerTask: (taskId) => run(async () => {
      const [task, events] = await Promise.all([
        api().getTask(taskId),
        api().getTaskEvents(taskId),
      ]);
      set({ selectedTaskId: taskId, selectedTask: task, taskEvents: events.events });
      eventsStream?.disconnect();
      eventsStream?.reset();
      eventsStream = new TaskEventsStream({
        serverUrl: () => get().serverUrl,
        token: () => get().authToken,
        taskId: () => get().selectedTaskId,
        onEvent: appendEvent,
        onStatusChange: (eventStreamStatus) => set({ eventStreamStatus }),
      });
      eventsStream.connect();
    }),

    refreshTaskEvents: () => run(async () => {
      const taskId = get().selectedTaskId;
      if (!taskId) return;
      const [task, events] = await Promise.all([
        api().getTask(taskId),
        api().getTaskEvents(taskId),
      ]);
      set({ selectedTask: task, taskEvents: events.events });
    }),

    pauseServerTask: (taskId) => run(async () => {
      const task = await api().pauseTask(taskId);
      set({ selectedTask: task });
    }),

    resumeServerTask: (taskId) => run(async () => {
      const task = await api().resumeTask(taskId);
      set({ selectedTask: task });
    }),

    cancelServerTask: (taskId) => run(async () => {
      const task = await api().cancelTask(taskId);
      set({ selectedTask: task });
    }),

    refreshApprovals: (status) => run(async () => {
      const { approvals } = await api().listApprovals({ status });
      set({ approvals });
    }),

    decideApproval: (approvalId, decision, reason) => run(async () => {
      await api().decideApproval(approvalId, decision, reason);
      const { approvals } = await api().listApprovals({});
      set({ approvals });
      const taskId = get().selectedTaskId;
      if (taskId) await get().selectServerTask(taskId);
    }),

    refreshArtifacts: () => run(async () => {
      const { artifacts } = await api().listArtifacts();
      set({ artifacts });
    }),

    openArtifact: (artifactId) => run(async () => {
      const preview: ArtifactPreview = await api().previewArtifact(artifactId);
      set({ artifactPreview: { artifactId, ...preview } });
    }),

    closeArtifactPreview: () => set({ artifactPreview: null }),
    clearApiError: () => set({ apiError: null }),

    refreshModels: () => run(async () => {
      const catalog = await api().listModels();
      set({
        models: catalog.models,
        modelCatalogStatus: `Source: ${catalog.source} · ${catalog.models.length} models`,
      });
    }),

    googleLogin: () => run(async () => {
      if (loginInFlight) return;
      loginInFlight = true;
      try {
        const codeVerifier = randomBase64Url(32);
        const state = randomBase64Url(16);
        const startUrlTemplate = buildGoogleStartUrl(
          get().serverUrl,
          await codeChallengeFor(codeVerifier),
          state,
        );
        const rawQuery = await invoke<string>('google_login', { startUrlTemplate });
        const callback = parseCallbackQuery(rawQuery);
        if (callback.state !== state) throw new Error('State OAuth tidak cocok — login dibatalkan.');
        const session = await api().exchangeLoginCode(callback.code, codeVerifier);
        applySession(session);
        get().addLog('info', `Login Google berhasil sebagai ${session.user.email}`);
      } finally {
        loginInFlight = false;
      }
    }),

    logout: () => run(async () => {
      const { refreshToken } = get();
      get().disconnectFromServer();
      clearSession();
      if (!refreshToken) return;
      try {
        await api().logout(refreshToken);
      } catch (error) {
        // The local session is already gone; a dead refresh token is the server's problem.
        get().addLog('warn', `Logout server gagal (sesi lokal sudah dibersihkan): ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    setAuthToken: (token) => {
      persistSession({ accessToken: token, refreshToken: get().refreshToken, email: get().userEmail });
      set({ authToken: token });
    },
    setDevice: (device) => set({ device }),
    setConnectionStatus: (status) => set({ connectionStatus: status }),

    syncDeviceIdentity: async () => {
      const updated = await identityMgr.syncWithTauri();
      set({ device: updated });
    },

    connectToServer: async () => {
      const state = get();
      if (!state.authToken.trim()) {
        state.addLog('warn', 'Belum masuk. Gunakan "Masuk dengan Google" di tab Settings.');
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
        keyStore: identityMgr.keys,
        executor: exec,
        onStatusChange: (status) => set({ connectionStatus: status }),
        onDeviceId: (deviceId) => set({ device: identityMgr.setServerDeviceId(deviceId) }),
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
      eventsStream?.disconnect();
      eventsStream = null;
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
    };
  });
};
