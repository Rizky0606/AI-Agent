import { create } from 'zustand';
import type { TaskEventEnvelope, TaskRecord } from '@personal-ai-os/shared';
import { ApiClient, type ApprovalRecord, type ArtifactItem, type ArtifactPreview, type AuthSession, type ModelDescriptor } from '../api/client.ts';
import { AgentConnection, ChatConnection, type ConnectionStatus } from '../connection/agent-connection.ts';
import { TaskEventsStream, type StreamStatus } from '../connection/events-stream.ts';
import { type CapabilityName, CapabilityRegistry } from '../security/capability-registry.ts';
import { PathValidator } from '../security/path-validator.ts';
import type { ICommandExecutor } from '../security/types.ts';
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

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; cancelled?: boolean; model?: string | null; }
export interface ChatConversation { id: string; title: string; messages: ChatMessage[]; projectId?: string; }
export type ChatStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

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
  chatStatus: ChatStatus;
  chatError: string | null;
  selectedModel: string;
  selectedMode: 'auto' | 'fast' | 'coding' | 'complex' | 'research';
  serverTasks: TaskRecord[];
  selectedTaskId: string | null;
  selectedTask: TaskRecord | null;
  taskEvents: TaskEventEntry[];
  /** Tasks spawned from the active conversation, newest first. */
  conversationTasks: TaskRecord[];
  taskLaunchError: string | null;
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
  refreshChat: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedMode: (mode: AgentState['selectedMode']) => void;
  refreshConversationTasks: () => Promise<void>;
  launchChatTask: (input: { kind: string; prompt: string }) => Promise<void>;
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
  executor?: ICommandExecutor,
) => {
  let activeChatConnection: ChatConnection | null = null;
  let pendingChat: { content: string; conversationId: string } | null = null;
  let chatScope: string | null = null;
  let activeConnection: AgentConnection | null = null;
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
    let chatEventsStream: TaskEventsStream | null = null;
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
      // Keep the chat's conversation task strip current without polling.
      if (event.taskId && get().conversationTasks.some((task) => task.id === event.taskId)) void get().refreshConversationTasks();
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
    chatStatus: 'disconnected',
    chatError: null,
    selectedModel: 'auto',
    selectedMode: 'auto',
    serverTasks: [],
    selectedTaskId: null,
    selectedTask: null,
    taskEvents: [],
    conversationTasks: [],
    taskLaunchError: null,
    eventStreamStatus: 'disconnected',
    approvals: [],
    artifacts: [],
    artifactPreview: null,
    apiError: null,
    models: [],
    modelCatalogStatus: null,

    setServerUrl: (url) => { if (get().serverUrl === url) return; set({ serverUrl: url }); void get().refreshChat(); },
    setChatDraft: (chatDraft) => set({ chatDraft }),
    setActiveConversation: (activeConversationId) => { set({ activeConversationId, conversationTasks: [] }); void get().refreshConversationTasks(); },
    newConversation: () => { const id = `draft-${crypto.randomUUID()}`; set((state) => ({ conversations: [{ id, title: 'New conversation', messages: [] }, ...state.conversations], activeConversationId: id, chatError: null })); },
    sendChat: () => {
      const state = get();
      const content = state.chatDraft.trim();
      if (!content || state.chatStreaming) return;
      if (!state.authToken.trim() || !activeChatConnection) { set({ chatError: 'Sign in to send a message.' }); return; }
      const id = state.activeConversationId || `draft-${crypto.randomUUID()}`;
      pendingChat = { content, conversationId: id };
      set((current) => ({ activeConversationId: id, chatDraft: '', chatStreaming: true, chatError: null, conversations: current.conversations.some((item) => item.id === id) ? current.conversations : [{ id, title: content.slice(0, 48), messages: [] }, ...current.conversations] }));
      activeChatConnection.sendChatMessage({ type: 'chat.send', ...(!id.startsWith('draft-') ? { conversationId: id } : {}), content, model: state.selectedModel === 'auto' ? undefined : state.selectedModel, mode: state.selectedMode });
    },
    cancelChat: () => { activeChatConnection?.cancelChat(); },
    retryChat: () => {
      const pending = pendingChat;
      if (get().chatStreaming) return;
      if (!pending) { set({ chatError: 'No failed message to retry. Enter a message first.' }); return; }
      set({ chatDraft: pending.content, activeConversationId: pending.conversationId });
      get().sendChat();
    },
    clearChatError: () => set({ chatError: null }),
    setSelectedModel: (selectedModel) => set({ selectedModel }),
    setSelectedMode: (selectedMode) => set({ selectedMode }),
    // Tasks spawned from the active conversation. Read straight from the server, never inferred.
    refreshConversationTasks: () => run(async () => {
      const conversationId = get().activeConversationId;
      if (!conversationId || conversationId.startsWith('draft-') || !get().authToken.trim()) {
        set({ conversationTasks: [] });
        return;
      }
      const { tasks } = await api().listTasks({ conversationId });
      set({ conversationTasks: tasks });
    }),

    launchChatTask: async ({ kind, prompt }) => {
      const state = get();
      const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
      const content = prompt.trim();
      if (!conversation || !conversation.id || conversation.id.startsWith('draft-')) {
        set({ taskLaunchError: 'Send a message first so the conversation has a server id.' });
        return;
      }
      if (!content) { set({ taskLaunchError: 'Enter the instruction to run as a task.' }); return; }
      if (!conversation.projectId) { set({ taskLaunchError: 'This conversation has no project to run the task in.' }); return; }
      set({ taskLaunchError: null });
      await run(async () => {
        await api().createTask({ projectId: conversation.projectId!, kind, payload: { prompt: content }, conversationId: conversation.id });
        const { tasks } = await api().listTasks({ conversationId: conversation.id });
        set({ conversationTasks: tasks });
      });
    },
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
      if (get().authToken === token) return;
      persistSession({ accessToken: token, refreshToken: get().refreshToken, email: get().userEmail });
      set({ authToken: token });
      void get().refreshChat();
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
        // Chat runs on its own account-authenticated socket.
      });

      await activeConnection.connect();
    },

    refreshChat: async () => {
      const state = get();
      const scope = `${state.serverUrl}\n${state.authToken}`;
      if (chatScope === scope && activeChatConnection) return;
      chatScope = scope;
      set({ conversations: [{ id: '', title: 'New conversation', messages: [] }], activeConversationId: '', chatStreaming: false, chatStatus: 'disconnected', chatError: null });
      activeChatConnection?.disconnect();
      activeChatConnection = new ChatConnection({
        serverUrl: state.serverUrl,
        token: state.authToken,
        onStatusChange: (chatStatus) => { if (`${get().serverUrl}\n${get().authToken}` === scope) set({ chatStatus }); },
        onFrame: (frame) => set((current) => {
          if (`${current.serverUrl}\n${current.authToken}` !== scope) return {};
          if (frame.type === 'conversation.created' && frame.conversationId) {
            const provisional = pendingChat?.conversationId;
            if (pendingChat && provisional) pendingChat = { ...pendingChat, conversationId: frame.conversationId };
            const conversations = current.conversations.map((conversation) => conversation.id === provisional ? { ...conversation, id: frame.conversationId! } : conversation);
            if (current.activeConversationId === provisional) return { conversations, activeConversationId: frame.conversationId };
            return { conversations };
          }
          const conversationId = frame.conversationId ?? current.activeConversationId;
          const incoming = typeof frame.message === 'object' && frame.message !== null ? frame.message : undefined;
          const id = frame.messageId ?? incoming?.id;
          if (frame.type === 'error') return { chatStreaming: false, chatError: typeof frame.message === 'string' ? frame.message : frame.code ?? 'Chat error' };
          if (!conversationId || !id) return current;
          const role = incoming?.role ?? 'assistant';
          const conversations = current.conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            const existing = conversation.messages.find((message) => message.id === id);
            const content = frame.delta ? `${existing?.content ?? ''}${frame.delta}` : incoming?.content ?? frame.content ?? existing?.content ?? '';
            const message = { id, role: role === 'system' ? 'assistant' : role, content, cancelled: Boolean(incoming?.cancelled || incoming?.metadata?.['cancelled']), model: frame.resolvedModel ?? existing?.model } as ChatMessage;
            return { ...conversation, messages: existing ? conversation.messages.map((item) => item.id === id ? { ...item, ...message } : item) : [...conversation.messages, message] };
          });
          const done = frame.type === 'message.completed' || frame.type === 'message.cancelled';
          if (done) pendingChat = null;
          return { conversations, chatStreaming: !done };
        }),
      });
      pendingChat = null;
      if (!state.authToken.trim()) { activeChatConnection.disconnect(); activeChatConnection = null; return; }
      activeChatConnection.connect();
      // One account-scoped event stream so the conversation task strip tracks progress live.
      // Task-scoped streams are created separately by `selectServerTask`.
      if (!chatEventsStream) {
        chatEventsStream = new TaskEventsStream({
          serverUrl: () => get().serverUrl,
          token: () => get().authToken,
          taskId: () => null,
          onEvent: appendEvent,
        });
      }
      chatEventsStream.connect();
      try {
        const history = await api().listConversations();
        const conversations: ChatConversation[] = await Promise.all(history.conversations.map(async (item) => ({ id: item.id, title: item.title ?? 'Conversation', projectId: item.projectId ?? undefined, messages: (await api().listMessages(item.id)).messages.flatMap((message): ChatMessage[] => message.role === 'user' || message.role === 'assistant' ? [{ id: message.id, role: message.role, content: message.content, cancelled: Boolean(message.cancelled || message.metadata?.['cancelled']), model: typeof message.metadata?.['resolvedModel'] === 'string' ? message.metadata['resolvedModel'] : null }] : []) })));
        if (`${get().serverUrl}\n${get().authToken}` !== scope) return;
        set((current) => {
          const merged = conversations.map((conversation) => {
            const live = current.conversations.find((item) => item.id === conversation.id);
            if (!live) return conversation;
            return { ...conversation, messages: [...conversation.messages.map((message) => live.messages.find((item) => item.id === message.id) ?? message), ...live.messages.filter((message) => !conversation.messages.some((item) => item.id === message.id))] };
          });
          const live = current.conversations.filter((conversation) => conversation.id && !conversations.some((item) => item.id === conversation.id));
          return { conversations: [...live, ...merged].length ? [...live, ...merged] : current.conversations, activeConversationId: current.activeConversationId || conversations[0]?.id || '' };
        });
        // Runs after `activeConversationId` exists, so the first load is not a no-op.
        await get().refreshConversationTasks();
      } catch (error) { set({ chatError: error instanceof Error ? error.message : String(error) }); }
    },

    disconnectFromServer: () => {
      activeChatConnection?.disconnect();
      activeChatConnection = null;
      chatEventsStream?.disconnect();
      chatEventsStream = null;
      if (activeConnection) {
        activeConnection.disconnect();
        activeConnection = null;
      }
      eventsStream?.disconnect();
      eventsStream = null;
      set({ connectionStatus: 'disconnected', chatStreaming: false });
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
