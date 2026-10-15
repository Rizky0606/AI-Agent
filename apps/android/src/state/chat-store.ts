import { create } from 'zustand';
import type { ChatMessage, ChatMode, MessageAttachment, ModelDescriptor } from '../api/types.ts';
import { defaultApiClient, ApiError } from '../api/client.ts';

export interface ChatState {
  currentConversationId: string | null;
  messages: ChatMessage[];
  models: ModelDescriptor[];
  selectedModel: string;
  selectedMode: ChatMode;
  selectedRuntime: 'auto' | 'omp' | 'hermes' | 'native';
  modelCatalogError: string | null;
  modelCatalogUnavailable: boolean;
  modelNotice: string | null;
  favoriteModels: string[];
  userDefaultModel: string | null;
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamingDelta: string;
  draftText: string;
  draftAttachments: MessageAttachment[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  error: string | null;
  isSending: boolean;
  isCancelling: boolean;
  pendingDraft: { text: string; attachments: MessageAttachment[] } | null;
  // Actions
  setModels: (models: ModelDescriptor[]) => void;
  loadCatalog: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedMode: (mode: ChatMode) => void;
  setSelectedRuntime: (runtime: 'auto' | 'omp' | 'hermes' | 'native') => void;
  setConversationModel: (model: string | null) => Promise<void>;
  setConversationMode: (mode: ChatMode) => Promise<void>;
  toggleFavoriteModel: (modelId: string) => void;
  setUserDefaultModel: (modelId: string | null) => Promise<void>;
  clearModelNotice: () => void;
  setConversationId: (id: string | null) => void;
  remapConversationId: (id: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  hydrateMessages: (conversationId: string, messages: ChatMessage[]) => void;
  beginSend: () => void;
  acknowledgeSend: () => void;
  failSend: (error: string) => void;
  requestCancellation: () => void;
  appendMessage: (message: ChatMessage) => void;
  startStreaming: (tempId: string) => void;
  appendDelta: (delta: string) => void;
  finishStreaming: (completedMessage: ChatMessage) => void;
  cancelStreaming: () => void;
  setDraftText: (text: string) => void;
  addDraftAttachment: (attachment: MessageAttachment) => void;
  removeDraftAttachment: (index: number) => void;
  clearDraft: () => void;
  setConnectionStatus: (
    status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting',
  ) => void;
  setError: (error: string | null) => void;
}

export const createChatStore = () =>
  create<ChatState>((set, get) => ({
    currentConversationId: null,
    messages: [],
    models: [],
    selectedModel: 'auto',
    selectedMode: 'auto',
    selectedRuntime: 'auto',
    modelCatalogError: null,
    modelCatalogUnavailable: false,
    modelNotice: null,
    favoriteModels: [],
    userDefaultModel: null,
    isStreaming: false,
    streamingMessageId: null,
    streamingDelta: '',
    draftText: '',
    draftAttachments: [],
    connectionStatus: 'disconnected',
    error: null,
    isSending: false,
    isCancelling: false,
    pendingDraft: null,

    setModels: (models) => {
      const current = get().selectedModel;
      const modelExists = current === 'auto' || models.some((m) => m.id === current);
      let notice: string | null = null;
      let nextSelected = current;
      if (!modelExists) {
        notice = `Model '${current}' tidak lagi tersedia di katalog. Beralih ke Auto.`;
        nextSelected = 'auto';
      }
      set({
        models,
        modelCatalogError: null,
        modelCatalogUnavailable: false,
        selectedModel: nextSelected,
        ...(notice ? { modelNotice: notice } : {}),
      });
    },

    loadCatalog: async () => {
      try {
        const catalog = await defaultApiClient.listModels();
        get().setModels(catalog.models);
      } catch (err) {
        const isUnavailable = err instanceof ApiError && (err.status === 503 || err.code === 'PROVIDER_UNAVAILABLE');
        const errMsg = err instanceof Error ? err.message : String(err);
        set({
          modelCatalogUnavailable: true,
          modelCatalogError: isUnavailable ? 'Katalog model tidak dapat dihubungi (503).' : (errMsg || 'Katalog tidak tersedia.'),
        });
      }
    },

    setSelectedModel: (selectedModel) => void get().setConversationModel(selectedModel),
    setSelectedMode: (selectedMode) => void get().setConversationMode(selectedMode),
    setSelectedRuntime: (selectedRuntime) => set({ selectedRuntime }),

    setConversationModel: async (model) => {
      const nextModel = model || 'auto';
      set({ selectedModel: nextModel });
      const conversationId = get().currentConversationId;
      if (conversationId && !conversationId.startsWith('draft-')) {
        try {
          await defaultApiClient.updateConversation(conversationId, { model: nextModel === 'auto' ? null : nextModel });
        } catch {
          // Background update
        }
      }
    },

    setConversationMode: async (mode) => {
      set({ selectedMode: mode });
      const conversationId = get().currentConversationId;
      if (conversationId && !conversationId.startsWith('draft-')) {
        try {
          await defaultApiClient.updateConversation(conversationId, { mode });
        } catch {
          // Background update
        }
      }
    },

    toggleFavoriteModel: (modelId) => {
      const favs = get().favoriteModels;
      const next = favs.includes(modelId) ? favs.filter((id) => id !== modelId) : [...favs, modelId];
      set({ favoriteModels: next });
    },

    setUserDefaultModel: async (modelId) => {
      try {
        const res = await defaultApiClient.updateUserPreferences({ defaultModel: modelId });
        set({ userDefaultModel: res.defaultModel });
        void get().loadCatalog();
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    clearModelNotice: () => set({ modelNotice: null }),

    setConversationId: (id) =>
      set((state) => state.currentConversationId === id ? {} : {
        currentConversationId: id, messages: [], streamingDelta: '', isStreaming: false,
        streamingMessageId: null, isSending: false, isCancelling: false, error: null,
      }),
    remapConversationId: (id) => set({ currentConversationId: id }),

    setMessages: (messages) => set({ messages }),
    hydrateMessages: (conversationId, messages) => set((state) => {
      if (state.currentConversationId !== conversationId) return {};
      const live = new Map(state.messages.map((message) => [message.id, message]));
      return { messages: [
        ...messages.map((message) => live.get(message.id) ?? message),
        ...state.messages.filter((message) => !messages.some((item) => item.id === message.id)),
      ] };
    }),
    beginSend: () => set((state) => ({
      isSending: true, error: null,
      pendingDraft: { text: state.draftText, attachments: state.draftAttachments },
    })),
    acknowledgeSend: () => set((state) => ({
      draftText: state.draftText === state.pendingDraft?.text ? '' : state.draftText,
      draftAttachments: state.draftAttachments === state.pendingDraft?.attachments ? [] : state.draftAttachments,
    })),
    failSend: (error) => set((state) => ({
      error, isSending: false, pendingDraft: null,
      draftText: state.pendingDraft
        ? [state.pendingDraft.text, state.draftText === state.pendingDraft.text ? '' : state.draftText].filter(Boolean).join('\n') : state.draftText,
      draftAttachments: state.pendingDraft
        ? [...state.pendingDraft.attachments, ...state.draftAttachments.filter((attachment) => !state.pendingDraft!.attachments.includes(attachment))]
        : state.draftAttachments,
    })),
    requestCancellation: () => set({ isCancelling: true }),

    appendMessage: (message) =>
      set((state) => ({
        messages: state.messages.some((m) => m.id === message.id)
          ? state.messages.map((m) => m.id === message.id ? { ...m, ...message } : m)
          : [...state.messages, message],
      })),

    startStreaming: (tempId) =>
      set((state) => ({
        isStreaming: true,
        streamingMessageId: tempId,
        streamingDelta: state.messages.find((message) => message.id === tempId)?.content ?? '',
        error: null,
      })),

    appendDelta: (delta) =>
      set((state) => ({
        streamingDelta: state.streamingDelta + delta,
        messages: state.messages.map((message) => message.id === state.streamingMessageId
          ? { ...message, content: message.content + delta } : message),
      })),

    finishStreaming: (completedMessage) =>
      set((state) => {
        // If the completed message is already in list or replaces the streamed temp message
        const filtered = state.messages.filter(
          (m) => m.id !== state.streamingMessageId && m.id !== completedMessage.id,
        );
        return {
          messages: [...filtered, completedMessage],
          isStreaming: false,
          isSending: false,
          isCancelling: false,
          pendingDraft: null,
          streamingMessageId: null,
          streamingDelta: '',
        };
      }),

    cancelStreaming: () =>
      set({
        isStreaming: false,
        isSending: false,
        isCancelling: false,
        streamingMessageId: null,
        streamingDelta: '',
      }),

    setDraftText: (draftText) => set({ draftText }),

    addDraftAttachment: (attachment) =>
      set((state) => ({
        draftAttachments: [...state.draftAttachments, attachment],
      })),

    removeDraftAttachment: (index) =>
      set((state) => ({
        draftAttachments: state.draftAttachments.filter((_, i) => i !== index),
      })),

    clearDraft: () => set({ draftText: '', draftAttachments: [] }),

    setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

    setError: (error) => set({ error }),
  }));

export const useChatStore = createChatStore();
