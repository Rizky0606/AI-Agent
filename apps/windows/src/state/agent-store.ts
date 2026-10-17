import { create } from 'zustand';
import {
  DEFAULT_BUDGET_ESTIMATES,
  compareReducer,
  createInitialResearchProgressState,
  reduceResearchProgress,
  type CompareRunDetail,
  type CompareRunSummary,
  type CreateCompareRequest,
  type PromoteCompareResponse,
  type ResearchBudgetConfig,
  type ResearchDepth,
  type ResearchProgressState,
  type ResearchRunSummary,
  type ResearchSubQuestionState,
  type TaskEventEnvelope,
  type TaskRecord,
} from '@personal-ai-os/shared';
import { ApiClient, ApiError, type ApprovalRecord, type ArtifactItem, type ArtifactPreview, type AuthSession, type ModelDescriptor, type RuntimeDescriptor, type RuntimeId, type SkillItem, type McpServerItem, type McpCallLogItem, type PromptTemplateRecord, type ScheduleJobRecord, type CreateScheduleInput, type SkillProposalRecord, type CreateSkillProposalInput } from '../api/client.ts';
import { AgentConnection, ChatConnection, type ConnectionStatus } from '../connection/agent-connection.ts';
import { TaskEventsStream, type StreamStatus } from '../connection/events-stream.ts';
import { type CapabilityName, CapabilityRegistry } from '../security/capability-registry.ts';
import { PathValidator } from '../security/path-validator.ts';
import type { ICommandExecutor } from '../security/types.ts';
import { type DeviceIdentity, DeviceIdentityManager } from '../connection/device-identity.ts';
import { invoke } from '@tauri-apps/api/core';
import { buildGoogleStartUrl, codeChallengeFor, parseCallbackQuery, randomBase64Url } from '../auth/google.ts';

export const isTokenExpired = (token: string, bufferSeconds = 30): boolean => {
  if (!token || typeof token !== 'string') return true;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return false;
    const part = parts[1];
    if (!part) return false;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = typeof globalThis.atob === 'function'
      ? globalThis.atob(base64)
      : Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(jsonStr) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 <= Date.now() + (bufferSeconds * 1000);
  } catch {
    return false;
  }
};

export interface DiagnosticLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Persisted session; `serverUrl` stays in-memory like it always has. */
const SESSION_STORAGE_KEY = 'personal-ai-os.windows.session';
const CLOSE_TO_TRAY_STORAGE_KEY = 'personal-ai-os.windows.close_to_tray';
const AUTOSTART_STORAGE_KEY = 'personal-ai-os.windows.autostart';

export type AuthState = 'unauthenticated' | 'bootstrapping' | 'authenticating' | 'authenticated';

export type LoginStep =
  | 'idle'
  | 'opening_browser'
  | 'verifying'
  | 'registering_device'
  | 'connecting'
  | 'connected'
  | 'error';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  email: string;
}

const readStoredBoolean = (key: string, defaultValue: boolean): boolean => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
};

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

const FAVORITE_MODELS_STORAGE_KEY = 'personal-ai-os.windows.favorite_models';

const readStoredFavorites = (): string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(FAVORITE_MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistFavorites = (favorites: string[]): void => {
  try {
    globalThis.localStorage?.setItem(FAVORITE_MODELS_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Ignored when storage unavailable
  }
};

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cancelled?: boolean | undefined;
  model?: string | null | undefined;
  resolvedModel?: string | null | undefined;
  fallbackUsed?: boolean | undefined;
  parentMessageId?: string | null | undefined;
  isActiveBranch?: boolean | undefined;
  branchIndex?: number | undefined;
  branchCount?: number | undefined;
  siblingMessageIds?: string[] | undefined;
}
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  projectId?: string | undefined;
  createdAt?: string | undefined;
  model?: string | null | undefined;
  mode?: ('auto' | 'fast' | 'coding' | 'complex' | 'research') | undefined;
  compactedSummary?: string | null | undefined;
}
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
  authState: AuthState;
  loginStep: LoginStep;
  loginError: string | null;
  bootstrapMessage: string | null;
  closeToTray: boolean;
  autostart: boolean;
  bootstrapAuth: () => Promise<void>;
  manualLogin: (token: string) => Promise<void>;
  clearLoginError: () => void;
  setCloseToTray: (enabled: boolean) => Promise<void>;
  setAutostart: (enabled: boolean) => Promise<void>;
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
  modelCatalogError: string | null;
  modelCatalogUnavailable: boolean;
  modelNotice: string | null;
  favoriteModels: string[];
  userDefaultModel: string | null;
  userDefaultMode: 'fast' | 'coding' | 'complex' | 'research';
  refreshModels: () => Promise<void>;
  toggleFavoriteModel: (modelId: string) => void;
  setUserDefaultModel: (modelId: string | null) => Promise<void>;
  setConversationModel: (model: string | null) => Promise<void>;
  setConversationMode: (mode: AgentState['selectedMode']) => Promise<void>;
  clearModelNotice: () => void;
  selectedRuntime: RuntimeId;
  runtimes: RuntimeDescriptor[];
  runtimeStatus: string | null;
  setSelectedRuntime: (runtime: RuntimeId) => void;
  refreshRuntimes: () => Promise<void>;
  skills: SkillItem[];
  projectSkills: Record<string, SkillItem[]>;
  mcpServers: McpServerItem[];
  mcpLogs: McpCallLogItem[];
  skillsLoading: boolean;
  mcpLoading: boolean;
  skillsError: string | null;
  mcpError: string | null;
  fetchSkills: (projectId?: string) => Promise<void>;
  toggleProjectSkill: (projectId: string, skillName: string, isEnabled: boolean) => Promise<void>;
  fetchSkillManifest: (name: string) => Promise<Record<string, unknown> | null>;
  fetchMcpServers: () => Promise<void>;
  fetchMcpLogs: (serverId?: string) => Promise<void>;
  addMcpServer: (payload: {
    id: string;
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    allowedCapabilities: string[];
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }) => Promise<void>;
  deleteMcpServer: (id: string) => Promise<void>;
  researchDepth: ResearchDepth;
  setResearchDepth: (depth: ResearchDepth) => void;
  researchBudgets: Record<ResearchDepth, ResearchBudgetConfig>;
  fetchResearchConfig: () => Promise<void>;
  activeResearchId: string | null;
  activeResearchState: ResearchProgressState | null;
  researchHistory: ResearchRunSummary[];
  isLoadingResearch: boolean;
  startResearch: (query: string, depth?: ResearchDepth) => Promise<string>;
  openResearch: (runId: string) => Promise<void>;
  closeActiveResearch: () => void;
  refreshResearchHistory: () => Promise<void>;
  approveResearchPlan: (runId: string, plan: { subQuestions: ResearchSubQuestionState[] }) => Promise<void>;
  cancelResearch: (runId: string) => Promise<void>;
  deleteResearch: (runId: string) => Promise<void>;
  activeCompareId: string | null;
  activeCompareState: CompareRunDetail | null;
  compareHistory: CompareRunSummary[];
  isLoadingCompare: boolean;
  compareError: string | null;
  startCompare: (payload: CreateCompareRequest) => Promise<string>;
  openCompare: (runId: string) => Promise<void>;
  closeActiveCompare: () => void;
  refreshCompareHistory: () => Promise<void>;
  revealCompare: (runId: string) => Promise<void>;
  selectCompareWinner: (runId: string, winnerModelId: string) => Promise<void>;
  synthesizeCompare: (runId: string, synthesisModelId?: string) => Promise<void>;
  promoteCompare: (runId: string, options?: { target?: 'new' | 'existing'; conversationId?: string }) => Promise<PromoteCompareResponse>;
  deleteCompare: (runId: string) => Promise<void>;
  // Sesi 27
  promptTemplates: PromptTemplateRecord[];
  promptTemplatesLoading: boolean;
  messageQueue: string[];
  fetchPromptTemplates: () => Promise<void>;
  createPromptTemplate: (tpl: { name: string; title?: string; content: string; description?: string }) => Promise<void>;
  deletePromptTemplate: (id: string) => Promise<void>;
  switchMessageBranch: (messageId: string) => Promise<void>;
  deleteMessageBranch: (messageId: string) => Promise<void>;
  exportActiveConversation: (format: 'markdown' | 'html') => Promise<{ filename: string; content: string }>;
  compactActiveConversation: () => Promise<{ compacted: boolean; reason?: string }>;
  queueMessage: (content: string) => void;
  dequeueAndSend: () => void;
  cycleFavoriteModel: () => void;
  // Sesi 28: Tugas Terjadwal & Usulan Skill
  schedules: ScheduleJobRecord[];
  schedulesLoading: boolean;
  skillProposals: SkillProposalRecord[];
  skillProposalsLoading: boolean;
  fetchSchedules: () => Promise<void>;
  createSchedule: (input: CreateScheduleInput) => Promise<ScheduleJobRecord>;
  pauseSchedule: (id: string) => Promise<void>;
  resumeSchedule: (id: string) => Promise<void>;
  cancelSchedule: (id: string) => Promise<void>;
  fetchSkillProposals: (status?: string) => Promise<void>;
  createSkillProposal: (input: CreateSkillProposalInput) => Promise<SkillProposalRecord>;
  approveSkillProposal: (id: string) => Promise<SkillProposalRecord>;
  rejectSkillProposal: (id: string, reason: string) => Promise<SkillProposalRecord>;
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
  let connectingInFlight = false;
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
    let researchEventsStream: TaskEventsStream | null = null;
    let compareEventsStream: TaskEventsStream | null = null;
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
    const hasStoredTokens = Boolean(storedSession.accessToken || storedSession.refreshToken);
    return {
    serverUrl: (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL ?? 'https://ai.ojixx.my.id',
    authToken: storedSession.accessToken,
    refreshToken: storedSession.refreshToken,
    userEmail: storedSession.email,
    connectionStatus: 'disconnected',
    authState: hasStoredTokens ? 'bootstrapping' : 'unauthenticated',
    loginStep: 'idle',
    loginError: null,
    bootstrapMessage: null,
    closeToTray: readStoredBoolean(CLOSE_TO_TRAY_STORAGE_KEY, true),
    autostart: readStoredBoolean(AUTOSTART_STORAGE_KEY, false),

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
    modelCatalogError: null,
    modelCatalogUnavailable: false,
    modelNotice: null,
    favoriteModels: readStoredFavorites(),
    userDefaultModel: null,
    userDefaultMode: 'fast',
    selectedRuntime: 'auto',
    runtimes: [],
    runtimeStatus: null,
    skills: [],
    projectSkills: {},
    mcpServers: [],
    mcpLogs: [],
    skillsLoading: false,
    mcpLoading: false,
    skillsError: null,
    mcpError: null,

    setServerUrl: (url) => { if (get().serverUrl === url) return; set({ serverUrl: url }); void get().refreshChat(); },
    setChatDraft: (chatDraft) => set({ chatDraft }),
    setActiveConversation: (activeConversationId) => {
      const conv = get().conversations.find((item) => item.id === activeConversationId);
      set({
        activeConversationId,
        conversationTasks: [],
        selectedModel: conv?.model || 'auto',
        selectedMode: conv?.mode || 'auto',
      });
      void get().refreshConversationTasks();
    },
    newConversation: () => {
      const id = `draft-${crypto.randomUUID()}`;
      set((state) => ({
        conversations: [{ id, title: 'Percakapan baru', messages: [], createdAt: new Date().toISOString(), model: state.selectedModel === 'auto' ? null : state.selectedModel, mode: state.selectedMode }, ...state.conversations],
        activeConversationId: id,
        chatError: null,
      }));
    },
    sendChat: () => {
      const state = get();
      const content = state.chatDraft.trim();
      if (!content) return;
      if (state.chatStreaming) {
        get().queueMessage(content);
        return;
      }
      if (!state.authToken.trim() || !activeChatConnection) { set({ chatError: 'Sign in to send a message.' }); return; }
      const id = state.activeConversationId || `draft-${crypto.randomUUID()}`;
      pendingChat = { content, conversationId: id };
      set((current) => ({
        activeConversationId: id,
        chatDraft: '',
        chatStreaming: true,
        chatError: null,
        conversations: current.conversations.some((item) => item.id === id)
          ? current.conversations
          : [{ id, title: content.slice(0, 48), messages: [], model: state.selectedModel === 'auto' ? null : state.selectedModel, mode: state.selectedMode }, ...current.conversations],
      }));
      activeChatConnection.sendChatMessage({
        type: 'chat.send',
        ...(!id.startsWith('draft-') ? { conversationId: id } : {}),
        content,
        model: state.selectedModel === 'auto' ? undefined : state.selectedModel,
        mode: state.selectedMode,
      });
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
    setSelectedModel: (selectedModel) => void get().setConversationModel(selectedModel),
    setSelectedMode: (selectedMode) => void get().setConversationMode(selectedMode),
    setConversationModel: async (model) => {
      const state = get();
      const nextModel = model || 'auto';
      set({ selectedModel: nextModel });
      const activeId = state.activeConversationId;
      if (activeId) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeId ? { ...c, model: nextModel === 'auto' ? null : nextModel } : c
          ),
        }));
        if (!activeId.startsWith('draft-') && state.authToken.trim()) {
          try {
            await api().updateConversation(activeId, { model: nextModel === 'auto' ? null : nextModel });
          } catch {
            // Background update
          }
        }
      }
    },
    setConversationMode: async (mode) => {
      const state = get();
      set({ selectedMode: mode });
      const activeId = state.activeConversationId;
      if (activeId) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeId ? { ...c, mode } : c
          ),
        }));
        if (!activeId.startsWith('draft-') && state.authToken.trim()) {
          try {
            await api().updateConversation(activeId, { mode });
          } catch {
            // Background update
          }
        }
      }
    },
    toggleFavoriteModel: (modelId) => {
      const favorites = get().favoriteModels;
      const next = favorites.includes(modelId)
        ? favorites.filter((id) => id !== modelId)
        : [...favorites, modelId];
      persistFavorites(next);
      set({ favoriteModels: next });
    },
    setUserDefaultModel: async (modelId) => {
      try {
        const res = await api().updateUserPreferences({ defaultModel: modelId });
        set({ userDefaultModel: res.defaultModel });
        void get().refreshModels();
      } catch (err) {
        set({ apiError: err instanceof Error ? err.message : String(err) });
      }
    },
    clearModelNotice: () => set({ modelNotice: null }),
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

    setSelectedRuntime: (selectedRuntime) => set({ selectedRuntime }),

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
        await api().createTask({
          projectId: conversation.projectId!,
          kind,
          payload: {
            prompt: content,
            ...(state.selectedRuntime !== 'auto' ? { runtime: state.selectedRuntime } : {}),
          },
          conversationId: conversation.id,
        });
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

    refreshModels: async () => {
      try {
        const catalog = await api().listModels();
        const currentModel = get().selectedModel;
        const modelExists = currentModel === 'auto' || catalog.models.some((m) => m.id === currentModel);
        let notice: string | null = null;
        let nextSelected = currentModel;
        if (!modelExists) {
          notice = `Model '${currentModel}' tidak lagi tersedia di katalog. Beralih ke Auto.`;
          nextSelected = 'auto';
        }
        set({
          models: catalog.models,
          modelCatalogStatus: `Source: ${catalog.source} · ${catalog.models.length} models`,
          modelCatalogError: null,
          modelCatalogUnavailable: false,
          selectedModel: nextSelected,
          ...(notice ? { modelNotice: notice } : {}),
        });
      } catch (error) {
        const errMsg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
        const isUnavailable = error instanceof ApiError && (error.status === 503 || error.code === 'PROVIDER_UNAVAILABLE');
        set({
          modelCatalogError: isUnavailable ? 'Katalog model tidak dapat dihubungi (503).' : (errMsg || 'Katalog model tidak tersedia.'),
          modelCatalogUnavailable: true,
          modelCatalogStatus: null,
        });
      }
    },

    refreshRuntimes: async () => {
      try {
        const { runtimes } = await api().listRuntimes();
        const readyCount = runtimes.filter((r) => r.status === 'ready').length;
        const statusSummary = `${readyCount}/${runtimes.length} runtime siap`;
        set({ runtimes, runtimeStatus: statusSummary });
      } catch {
        set({ runtimeStatus: 'Status runtime tidak dapat diperiksa' });
      }
    },

    bootstrapAuth: async () => {
      // Sync close-to-tray & autostart from Tauri backend if running inside Tauri
      try {
        const ctt = await invoke<boolean>('get_close_to_tray');
        const as = await invoke<boolean>('get_autostart');
        set({ closeToTray: ctt, autostart: as });
      } catch {
        // Ignored when running outside Tauri (e.g. web tests)
      }

      const { authToken, refreshToken } = get();
      if (!authToken && !refreshToken) {
        set({ authState: 'unauthenticated', loginStep: 'idle', bootstrapMessage: null });
        return;
      }

      set({ authState: 'bootstrapping', bootstrapMessage: 'Memverifikasi sesi...' });

      try {
        let currentToken = authToken;
        if (!currentToken || isTokenExpired(currentToken)) {
          if (!refreshToken) {
            clearSession();
            set({
              authState: 'unauthenticated',
              loginStep: 'idle',
              loginError: null,
              bootstrapMessage: null,
            });
            return;
          }
          set({ bootstrapMessage: 'Menyegarkan sesi autentikasi...' });
          try {
            const session = await api().refreshSession(refreshToken);
            applySession(session);
            currentToken = session.accessToken;
          } catch (refreshErr) {
            const isOffline =
              (refreshErr instanceof TypeError && refreshErr.message.toLowerCase().includes('fetch')) ||
              (refreshErr instanceof ApiError && (refreshErr.status === 502 || refreshErr.status === 503 || refreshErr.status === 504 || refreshErr.status === 0)) ||
              (refreshErr instanceof Error && (refreshErr.message.toLowerCase().includes('network') || refreshErr.message.toLowerCase().includes('failed to fetch') || refreshErr.message.toLowerCase().includes('econnrefused')));

            if (isOffline) {
              set({
                authState: 'unauthenticated',
                loginStep: 'error',
                loginError: 'Server tidak terjangkau. Periksa koneksi internet Anda.',
                bootstrapMessage: null,
              });
              return;
            }

            clearSession();
            set({
              authState: 'unauthenticated',
              loginStep: 'error',
              loginError: 'Sesi Anda telah kedaluwarsa. Silakan masuk kembali.',
              bootstrapMessage: null,
            });
            return;
          }
        }

        set({ bootstrapMessage: 'Mendaftarkan perangkat...' });
        await get().syncDeviceIdentity();

        set({ bootstrapMessage: 'Menghubungkan ke layanan...' });
        await get().connectToServer();
        void get().refreshChat();

        set({
          authState: 'authenticated',
          loginStep: 'connected',
          loginError: null,
          bootstrapMessage: null,
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const isOffline = errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('fetch') || errMsg.toLowerCase().includes('econnrefused');
        set({
          authState: 'unauthenticated',
          loginStep: 'error',
          loginError: isOffline ? 'Server tidak terjangkau. Periksa koneksi internet Anda.' : errMsg,
          bootstrapMessage: null,
        });
      }
    },

    googleLogin: async () => {
      if (loginInFlight) return;
      loginInFlight = true;
      set({ authState: 'authenticating', loginStep: 'opening_browser', loginError: null });
      try {
        const codeVerifier = randomBase64Url(32);
        const state = randomBase64Url(16);
        const startUrlTemplate = buildGoogleStartUrl(
          get().serverUrl,
          await codeChallengeFor(codeVerifier),
          state,
        );

        let rawQuery: string;
        try {
          rawQuery = await invoke<string>('google_login', { startUrlTemplate });
        } catch (invokeErr) {
          const rawMsg = invokeErr instanceof Error ? invokeErr.message : String(invokeErr);
          if (
            rawMsg.toLowerCase().includes('timeout') ||
            rawMsg.toLowerCase().includes('cancel') ||
            rawMsg.toLowerCase().includes('closed') ||
            rawMsg.toLowerCase().includes('dibatalkan')
          ) {
            throw new Error('Proses login dibatalkan atau jendela browser ditutup sebelum selesai.');
          }
          throw new Error(`Gagal membuka alur login Google: ${rawMsg}`);
        }

        set({ loginStep: 'verifying' });
        const callback = parseCallbackQuery(rawQuery);
        if (callback.state !== state) {
          throw new Error('State OAuth tidak cocok. Login dibatalkan demi keamanan.');
        }

        let session: AuthSession;
        try {
          session = await api().exchangeLoginCode(callback.code, codeVerifier);
        } catch (exchangeErr) {
          if (exchangeErr instanceof ApiError && (exchangeErr.status === 403 || exchangeErr.code === 'FORBIDDEN')) {
            throw new Error('Akun Google Anda tidak memiliki izin untuk mengakses sistem ini.');
          }
          throw exchangeErr;
        }

        applySession(session);
        get().addLog('info', `Login Google berhasil sebagai ${session.user.email}`);

        set({ loginStep: 'registering_device' });
        await get().syncDeviceIdentity();

        set({ loginStep: 'connecting' });
        await get().connectToServer();
        void get().refreshChat();

        set({
          loginStep: 'connected',
          authState: 'authenticated',
          loginError: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().addLog('error', `Login gagal: ${message}`);
        set({
          authState: 'unauthenticated',
          loginStep: 'error',
          loginError: message,
        });
      } finally {
        loginInFlight = false;
      }
    },

    manualLogin: async (token: string) => {
      const trimmed = token.trim();
      if (!trimmed) {
        set({ loginError: 'Masukkan token autentikasi yang valid.' });
        return;
      }
      set({ authState: 'authenticating', loginStep: 'verifying', loginError: null });
      try {
        get().setAuthToken(trimmed);

        set({ loginStep: 'registering_device' });
        await get().syncDeviceIdentity();

        set({ loginStep: 'connecting' });
        await get().connectToServer();
        void get().refreshChat();

        set({
          loginStep: 'connected',
          authState: 'authenticated',
          loginError: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().addLog('error', `Login manual gagal: ${message}`);
        set({
          authState: 'unauthenticated',
          loginStep: 'error',
          loginError: message,
        });
      }
    },

    clearLoginError: () => set({ loginError: null, loginStep: 'idle' }),

    setCloseToTray: async (enabled: boolean) => {
      try {
        globalThis.localStorage?.setItem(CLOSE_TO_TRAY_STORAGE_KEY, JSON.stringify(enabled));
      } catch {
        // storage fallback
      }
      set({ closeToTray: enabled });
      try {
        await invoke('set_close_to_tray', { enabled });
      } catch {
        // ignore non-tauri runtime
      }
    },

    setAutostart: async (enabled: boolean) => {
      try {
        globalThis.localStorage?.setItem(AUTOSTART_STORAGE_KEY, JSON.stringify(enabled));
      } catch {
        // storage fallback
      }
      set({ autostart: enabled });
      try {
        await invoke('set_autostart', { enabled });
      } catch {
        // ignore non-tauri runtime
      }
    },

    logout: () => run(async () => {
      const { refreshToken } = get();
      get().disconnectFromServer();
      clearSession();
      set({
        authState: 'unauthenticated',
        loginStep: 'idle',
        loginError: null,
        bootstrapMessage: null,
      });
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
        state.addLog('warn', 'Belum masuk. Silakan lakukan autentikasi terlebih dahulu.');
        return;
      }
      if (connectingInFlight) {
        return;
      }
      if (activeConnection && (activeConnection.getStatus() === 'connected' || activeConnection.getStatus() === 'connecting')) {
        return;
      }

      connectingInFlight = true;
      try {
        if (activeConnection) {
          activeConnection.disconnect();
          activeConnection = null;
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
      } finally {
        connectingInFlight = false;
      }
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
            const resolvedModel = frame.resolvedModel ?? incoming?.metadata?.['resolvedModel'] ?? existing?.resolvedModel ?? (typeof frame.model === 'string' ? frame.model : existing?.model);
            const fallbackUsed = Boolean(frame.fallbackUsed ?? incoming?.metadata?.['fallbackUsed'] ?? existing?.fallbackUsed);
            const message = {
              id,
              role: role === 'system' ? 'assistant' : role,
              content,
              cancelled: Boolean(incoming?.cancelled || incoming?.metadata?.['cancelled']),
              model: resolvedModel,
              resolvedModel,
              fallbackUsed,
              parentMessageId: incoming?.parentMessageId,
              isActiveBranch: incoming?.isActiveBranch,
              branchIndex: incoming?.branchIndex,
              branchCount: incoming?.branchCount,
              siblingMessageIds: incoming?.siblingMessageIds,
            } as ChatMessage;
            return { ...conversation, messages: existing ? conversation.messages.map((item) => item.id === id ? { ...item, ...message } : item) : [...conversation.messages, message] };
          });
          const done = frame.type === 'message.completed' || frame.type === 'message.cancelled';
          if (done) {
            pendingChat = null;
            setTimeout(() => {
              get().dequeueAndSend();
            }, 50);
          }
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
        const conversations: ChatConversation[] = await Promise.all(history.conversations.map(async (item) => ({
          id: item.id,
          title: item.title ?? 'Percakapan',
          projectId: item.projectId ?? undefined,
          createdAt: item.createdAt,
          messages: (await api().listMessages(item.id)).messages.flatMap((message): ChatMessage[] =>
            message.role === 'user' || message.role === 'assistant'
              ? [{
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  cancelled: Boolean(message.cancelled || message.metadata?.['cancelled']),
                  model: typeof message.metadata?.['resolvedModel'] === 'string' ? message.metadata['resolvedModel'] : (typeof message.metadata?.['model'] === 'string' ? message.metadata['model'] : null),
                  resolvedModel: typeof message.metadata?.['resolvedModel'] === 'string' ? message.metadata['resolvedModel'] : null,
                  fallbackUsed: Boolean(message.metadata?.['fallbackUsed']),
                  parentMessageId: message.parentMessageId,
                  isActiveBranch: message.isActiveBranch,
                  branchIndex: message.branchIndex,
                  branchCount: message.branchCount,
                  siblingMessageIds: message.siblingMessageIds,
                }]
              : []
          ),
          compactedSummary: item.compactedSummary,
        })));
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

    fetchSkills: async (projectId?: string) => {
      set({ skillsLoading: true, skillsError: null });
      try {
        if (projectId) {
          const { skills } = await api().listProjectSkills(projectId);
          set((state) => ({
            skills,
            projectSkills: { ...state.projectSkills, [projectId]: skills },
            skillsLoading: false,
          }));
        } else {
          const { skills } = await api().listSkills();
          set({ skills, skillsLoading: false });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat daftar skill.';
        set({ skillsLoading: false, skillsError: msg });
      }
    },

    toggleProjectSkill: async (projectId: string, skillName: string, isEnabled: boolean) => {
      try {
        await api().toggleProjectSkill(projectId, skillName, isEnabled);
        set((state) => {
          const updateList = (list: SkillItem[]) =>
            list.map((s) => (s.name === skillName ? { ...s, isEnabled, isProjectOverride: true } : s));
          return {
            skills: updateList(state.skills),
            projectSkills: {
              ...state.projectSkills,
              [projectId]: updateList(state.projectSkills[projectId] ?? state.skills),
            },
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengubah status skill proyek.';
        set({ skillsError: msg });
        throw err;
      }
    },

    fetchSkillManifest: async (name: string): Promise<Record<string, unknown> | null> => {
      try {
        const { manifest } = await api().getSkillManifest(name);
        return manifest;
      } catch (err) {
        const msg = err instanceof Error ? err.message : `Gagal memuat manifest skill '${name}'.`;
        set({ skillsError: msg });
        return null;
      }
    },

    fetchMcpServers: async () => {
      set({ mcpLoading: true, mcpError: null });
      try {
        const { servers } = await api().listMcpServers();
        set({ mcpServers: servers, mcpLoading: false });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat server MCP.';
        set({ mcpLoading: false, mcpError: msg });
      }
    },

    fetchMcpLogs: async (serverId?: string) => {
      try {
        const { logs } = await api().listMcpLogs(serverId ? { serverId, limit: 50 } : { limit: 50 });
        set({ mcpLogs: logs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat log panggilan MCP.';
        set({ mcpError: msg });
      }
    },

    addMcpServer: async (payload) => {
      set({ mcpLoading: true, mcpError: null });
      try {
        const { server } = await api().addMcpServer(payload);
        set((state) => ({
          mcpServers: [...state.mcpServers.filter((s) => s.id !== server.id), server],
          mcpLoading: false,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal menambahkan server MCP.';
        set({ mcpLoading: false, mcpError: msg });
        throw err;
      }
    },

    deleteMcpServer: async (id: string) => {
      set({ mcpLoading: true, mcpError: null });
      try {
        await api().deleteMcpServer(id);
        set((state) => ({
          mcpServers: state.mcpServers.filter((s) => s.id !== id),
          mcpLoading: false,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal menghapus server MCP.';
        set({ mcpLoading: false, mcpError: msg });
        throw err;
      }
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

    researchDepth: 'standard',
    setResearchDepth: (depth) => set({ researchDepth: depth }),
    researchBudgets: DEFAULT_BUDGET_ESTIMATES,
    fetchResearchConfig: () => run(async () => {
      try {
        const res = await api().getResearchConfig();
        if (res.budgets) {
          set({ researchBudgets: res.budgets });
        }
      } catch {
        // Fallback default estimates
      }
    }),
    activeResearchId: null,
    activeResearchState: null,
    researchHistory: [],
    isLoadingResearch: false,

    startResearch: async (query, depth) => {
      const chosenDepth = depth ?? get().researchDepth;
      set({ isLoadingResearch: true });
      try {
        const activeConv = get().conversations.find((c) => c.id === get().activeConversationId);
        let projectId = activeConv?.projectId;
        if (!projectId) {
          try {
            const pr = await api().listProjects();
            projectId = pr.projects[0]?.id;
          } catch {
            // ignore
          }
        }
        if (!projectId) {
          projectId = '00000000-0000-0000-0000-000000000000';
        }

        const { run: runItem } = await api().createResearch({
          projectId,
          query,
          depth: chosenDepth,
        });

        const initialProgress = createInitialResearchProgressState({
          runId: runItem.id,
          query: runItem.query,
          depth: chosenDepth,
          budgetConfig: runItem.budgetConfig,
        });

        set({
          activeResearchId: runItem.id,
          activeResearchState: initialProgress,
          isLoadingResearch: false,
        });

        researchEventsStream?.disconnect();
        researchEventsStream?.reset();
        researchEventsStream = new TaskEventsStream({
          serverUrl: () => get().serverUrl,
          token: () => get().authToken,
          taskId: () => get().activeResearchId,
          onEvent: (event) => {
            const current = get().activeResearchState;
            if (!current) return;
            const next = reduceResearchProgress(current, event);
            set({ activeResearchState: next });
            if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
              void get().refreshResearchHistory();
            }
          },
        });
        researchEventsStream.connect();

        void get().refreshResearchHistory();
        return runItem.id;
      } catch (err: unknown) {
        set({ isLoadingResearch: false });
        throw err;
      }
    },

    openResearch: (runId) => run(async () => {
      set({ isLoadingResearch: true, activeResearchId: runId });
      try {
        const details = await api().getResearch(runId);
        const planObj = details.run.plan as { subQuestions?: ResearchSubQuestionState[] } | undefined;
        const progressState: ResearchProgressState = {
          runId: details.run.id,
          status: details.run.status,
          query: details.run.query,
          depth: details.run.depth,
          plan: planObj ? { subQuestions: planObj.subQuestions ?? [] } : undefined,
          subQuestions: planObj?.subQuestions ?? [],
          sources: details.sources ?? [],
          evidence: details.evidence ?? [],
          report: details.report ?? undefined,
          budgetConfig: details.run.budgetConfig,
          budgetUsed: details.run.budgetUsed,
          seenEventIds: [],
          updatedAt: Date.now(),
        };

        set({
          activeResearchState: progressState,
          isLoadingResearch: false,
        });

        if (
          details.run.status === 'running' ||
          details.run.status === 'planning' ||
          details.run.status === 'waiting_plan_approval' ||
          details.run.status === 'queued'
        ) {
          researchEventsStream?.disconnect();
          researchEventsStream?.reset();
          researchEventsStream = new TaskEventsStream({
            serverUrl: () => get().serverUrl,
            token: () => get().authToken,
            taskId: () => get().activeResearchId,
            onEvent: (event) => {
              const current = get().activeResearchState;
              if (!current) return;
              const next = reduceResearchProgress(current, event);
              set({ activeResearchState: next });
              if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
                void get().refreshResearchHistory();
              }
            },
          });
          researchEventsStream.connect();
        }
      } catch (err: unknown) {
        set({ isLoadingResearch: false });
        throw err;
      }
    }),

    closeActiveResearch: () => {
      researchEventsStream?.disconnect();
      set({ activeResearchId: null, activeResearchState: null });
    },

    refreshResearchHistory: () => run(async () => {
      try {
        const res = await api().listResearch({ limit: 50 });
        set({ researchHistory: res.runs });
      } catch {
        // ignore
      }
    }),

    approveResearchPlan: (runId, plan) => run(async () => {
      await api().approveResearchPlan(runId, plan);
      set((state) => {
        if (state.activeResearchState && state.activeResearchState.runId === runId) {
          return {
            activeResearchState: {
              ...state.activeResearchState,
              status: 'running',
              plan: {
                subQuestions: plan.subQuestions,
                approved: true,
              },
              subQuestions: plan.subQuestions,
            },
          };
        }
        return state;
      });
    }),

    cancelResearch: (runId) => run(async () => {
      await api().cancelResearch(runId);
      set((state) => {
        if (state.activeResearchState && state.activeResearchState.runId === runId) {
          return {
            activeResearchState: {
              ...state.activeResearchState,
              status: 'cancelled',
            },
          };
        }
        return state;
      });
      void get().refreshResearchHistory();
    }),

    deleteResearch: (runId) => run(async () => {
      await api().deleteResearch(runId);
      if (get().activeResearchId === runId) {
        get().closeActiveResearch();
      }
      set((state) => ({
        researchHistory: state.researchHistory.filter((r) => r.id !== runId),
      }));
    }),

    activeCompareId: null,
    activeCompareState: null,
    compareHistory: [],
    isLoadingCompare: false,
    compareError: null,

    startCompare: async (payload) => {
      set({ isLoadingCompare: true, compareError: null });
      try {
        const summary = await api().createCompare(payload);
        const detail = await api().getCompare(summary.id);

        set({
          activeCompareId: summary.id,
          activeCompareState: detail,
          isLoadingCompare: false,
        });

        compareEventsStream?.disconnect();
        compareEventsStream?.reset();
        compareEventsStream = new TaskEventsStream({
          serverUrl: () => get().serverUrl,
          token: () => get().authToken,
          taskId: () => get().activeCompareId,
          onEvent: (event) => {
            const current = get().activeCompareState;
            if (!current) return;
            const next = compareReducer(current, event);
            set({ activeCompareState: next });
            if (next.status === 'completed' || next.status === 'failed') {
              void get().refreshCompareHistory();
            }
          },
        });
        compareEventsStream.connect();

        void get().refreshCompareHistory();
        return summary.id;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ isLoadingCompare: false, compareError: msg });
        throw err;
      }
    },

    openCompare: async (runId) => {
      set({ isLoadingCompare: true, activeCompareId: runId, compareError: null });
      try {
        const detail = await api().getCompare(runId);
        set({
          activeCompareState: detail,
          isLoadingCompare: false,
        });

        if (detail.status === 'running' || detail.status === 'queued') {
          compareEventsStream?.disconnect();
          compareEventsStream?.reset();
          compareEventsStream = new TaskEventsStream({
            serverUrl: () => get().serverUrl,
            token: () => get().authToken,
            taskId: () => get().activeCompareId,
            onEvent: (event) => {
              const current = get().activeCompareState;
              if (!current) return;
              const next = compareReducer(current, event);
              set({ activeCompareState: next });
              if (next.status === 'completed' || next.status === 'failed') {
                void get().refreshCompareHistory();
              }
            },
          });
          compareEventsStream.connect();
        }
      } catch (err: unknown) {
        set({ isLoadingCompare: false });
        throw err;
      }
    },

    closeActiveCompare: () => {
      compareEventsStream?.disconnect();
      set({ activeCompareId: null, activeCompareState: null, compareError: null });
    },

    refreshCompareHistory: () => run(async () => {
      try {
        const items = await api().listCompares();
        set({ compareHistory: items });
      } catch {
        // ignore
      }
    }),

    revealCompare: (runId) => run(async () => {
      const updated = await api().revealCompare(runId);
      set((state) => {
        if (state.activeCompareState && state.activeCompareState.id === runId) {
          return { activeCompareState: updated };
        }
        return state;
      });
      void get().refreshCompareHistory();
    }),

    selectCompareWinner: (runId, winnerModelId) => run(async () => {
      const updated = await api().selectCompareWinner(runId, winnerModelId);
      set((state) => {
        if (state.activeCompareState && state.activeCompareState.id === runId) {
          return { activeCompareState: updated };
        }
        return state;
      });
      void get().refreshCompareHistory();
    }),

    synthesizeCompare: (runId, synthesisModelId) => run(async () => {
      const updated = await api().synthesizeCompare(runId, synthesisModelId);
      set((state) => {
        if (state.activeCompareState && state.activeCompareState.id === runId) {
          return { activeCompareState: updated };
        }
        return state;
      });
      void get().refreshCompareHistory();
    }),

    promoteCompare: async (runId, options) => {
      const res = await api().promoteCompare(runId, options);
      if (res.conversationId) {
        void get().refreshChat();
      }
      return res;
    },

    deleteCompare: (runId) => run(async () => {
      await api().deleteCompare(runId);
      if (get().activeCompareId === runId) {
        get().closeActiveCompare();
      }
      set((state) => ({
        compareHistory: state.compareHistory.filter((c) => c.id !== runId),
      }));
    }),

    // --- Sesi 27 Implementations ---
    promptTemplates: [],
    promptTemplatesLoading: false,
    messageQueue: [],

    queueMessage: (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      set((state) => ({
        messageQueue: [...state.messageQueue, trimmed],
        chatDraft: '',
      }));
    },

    dequeueAndSend: () => {
      const { messageQueue, chatStreaming } = get();
      if (chatStreaming || messageQueue.length === 0) return;
      const [nextContent, ...remainingQueue] = messageQueue;
      if (!nextContent) return;
      set({ messageQueue: remainingQueue, chatDraft: nextContent });
      get().sendChat();
    },

    cycleFavoriteModel: () => {
      const state = get();
      const pool = state.favoriteModels.length > 0
        ? state.favoriteModels
        : state.models.map((m) => m.id);
      if (pool.length === 0) return;
      const currentIndex = pool.indexOf(state.selectedModel);
      const nextIndex = (currentIndex + 1) % pool.length;
      const nextModel = pool[nextIndex]!;
      void get().setConversationModel(nextModel);
    },

    fetchPromptTemplates: async () => {
      set({ promptTemplatesLoading: true });
      try {
        const { templates } = await api().listPromptTemplates();
        set({ promptTemplates: templates, promptTemplatesLoading: false });
      } catch {
        set({ promptTemplatesLoading: false });
      }
    },

    createPromptTemplate: async (tpl) => {
      await api().createPromptTemplate(tpl);
      await get().fetchPromptTemplates();
    },

    deletePromptTemplate: async (id: string) => {
      await api().deletePromptTemplate(id);
      await get().fetchPromptTemplates();
    },

    switchMessageBranch: async (messageId: string) => {
      const convId = get().activeConversationId;
      if (!convId || convId.startsWith('draft-')) return;
      try {
        const { messages } = await api().switchMessageBranch(convId, messageId);
        set((current) => ({
          conversations: current.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: messages.map((m) => ({
                    id: m.id,
                    role: m.role === 'system' ? 'assistant' : m.role,
                    content: m.content,
                    cancelled: Boolean(m.cancelled),
                    parentMessageId: m.parentMessageId ?? null,
                    isActiveBranch: m.isActiveBranch,
                    branchIndex: m.branchIndex,
                    branchCount: m.branchCount,
                    siblingMessageIds: m.siblingMessageIds,
                  })),
                }
              : c
          ),
        }));
      } catch (err) {
        set({ chatError: err instanceof Error ? err.message : 'Gagal berpindah cabang pesan' });
      }
    },

    deleteMessageBranch: async (messageId: string) => {
      const convId = get().activeConversationId;
      if (!convId || convId.startsWith('draft-')) return;
      try {
        await api().deleteMessageBranch(convId, messageId);
        // Refresh conversation messages after branch deletion
        const { messages } = await api().listMessages(convId);
        set((current) => ({
          conversations: current.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: messages.map((m) => ({
                    id: m.id,
                    role: m.role === 'system' ? 'assistant' : m.role,
                    content: m.content,
                    cancelled: Boolean(m.cancelled),
                    parentMessageId: m.parentMessageId ?? null,
                    isActiveBranch: m.isActiveBranch,
                    branchIndex: m.branchIndex,
                    branchCount: m.branchCount,
                    siblingMessageIds: m.siblingMessageIds,
                  })),
                }
              : c
          ),
        }));
      } catch (err) {
        set({ chatError: err instanceof Error ? err.message : 'Gagal menghapus cabang pesan' });
      }
    },

    exportActiveConversation: async (format: 'markdown' | 'html') => {
      const convId = get().activeConversationId;
      if (!convId || convId.startsWith('draft-')) {
        throw new Error('Percakapan aktif belum disimpan di server');
      }
      return api().exportConversation(convId, format);
    },

    compactActiveConversation: async () => {
      const convId = get().activeConversationId;
      if (!convId || convId.startsWith('draft-')) {
        return { compacted: false, reason: 'Percakapan belum tersimpan' };
      }
      try {
        const res = await api().compactConversation(convId);
        if (res.compacted && res.compactedSummary) {
          set((current) => ({
            conversations: current.conversations.map((c) =>
              c.id === convId ? { ...c, compactedSummary: res.compactedSummary ?? null } : c
            ),
          }));
        }
        return res;
      } catch (err) {
        return { compacted: false, reason: err instanceof Error ? err.message : 'Gagal meringkas konteks' };
      }
    },

    // --- Sesi 28: Tugas Terjadwal & Usulan Skill ---
    schedules: [],
    schedulesLoading: false,
    skillProposals: [],
    skillProposalsLoading: false,

    fetchSchedules: async () => {
      set({ schedulesLoading: true });
      try {
        const schedules = await api().listSchedules();
        set({ schedules, schedulesLoading: false });
      } catch {
        set({ schedulesLoading: false });
      }
    },

    createSchedule: async (input: CreateScheduleInput) => {
      const schedule = await api().createSchedule(input);
      await get().fetchSchedules();
      return schedule;
    },

    pauseSchedule: async (id: string) => {
      await api().pauseSchedule(id);
      await get().fetchSchedules();
    },

    resumeSchedule: async (id: string) => {
      await api().resumeSchedule(id);
      await get().fetchSchedules();
    },

    cancelSchedule: async (id: string) => {
      await api().cancelSchedule(id);
      await get().fetchSchedules();
    },

    fetchSkillProposals: async (status?: string) => {
      set({ skillProposalsLoading: true });
      try {
        const proposals = await api().listSkillProposals(status);
        set({ skillProposals: proposals, skillProposalsLoading: false });
      } catch {
        set({ skillProposalsLoading: false });
      }
    },

    createSkillProposal: async (input: CreateSkillProposalInput) => {
      const proposal = await api().createSkillProposal(input);
      await get().fetchSkillProposals();
      return proposal;
    },

    approveSkillProposal: async (id: string) => {
      const res = await api().approveSkillProposal(id);
      await Promise.all([
        get().fetchSkillProposals(),
        get().fetchSkills(),
      ]);
      return res.proposal;
    },

    rejectSkillProposal: async (id: string, reason: string) => {
      const res = await api().rejectSkillProposal(id, reason);
      await get().fetchSkillProposals();
      return res.proposal;
    },
    };
  });
};
