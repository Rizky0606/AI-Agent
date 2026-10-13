import { create } from 'zustand';
import type { TaskEventEnvelope, TaskRecord } from '@personal-ai-os/shared';
import { ApiClient, type ApprovalRecord, type ArtifactItem, type ArtifactPreview, type ModelDescriptor } from '../api/client.ts';
import { type ConnectionStatus } from '../connection/agent-connection.ts';
import { TaskEventsStream, type StreamStatus } from '../connection/events-stream.ts';
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
  const getInitialCapabilities = (): Record<CapabilityName, boolean> => {
    const rules = registry.getAllRules();
    const map = {} as Record<CapabilityName, boolean>;
    for (const key of Object.keys(rules) as CapabilityName[]) {
      map[key] = rules[key]!.enabled;
    }
    return map;
  };
  return create<AgentState>((set, get) => {
    const api = (): ApiClient =>
      new ApiClient({ baseUrl: () => get().serverUrl, token: () => get().authToken });
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
    return {
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
    };
  });
};
