import { create } from 'zustand';
import type { ChatMessage, MessageAttachment } from '../api/types.ts';

export interface ChatState {
  currentConversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamingDelta: string;
  draftText: string;
  draftAttachments: MessageAttachment[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  error: string | null;

  // Actions
  setConversationId: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
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
  create<ChatState>((set) => ({
    currentConversationId: null,
    messages: [],
    isStreaming: false,
    streamingMessageId: null,
    streamingDelta: '',
    draftText: '',
    draftAttachments: [],
    connectionStatus: 'disconnected',
    error: null,

    setConversationId: (id) =>
      set({ currentConversationId: id, messages: [], streamingDelta: '', isStreaming: false }),

    setMessages: (messages) => set({ messages }),

    appendMessage: (message) =>
      set((state) => ({
        messages: [...state.messages, message],
      })),

    startStreaming: (tempId) =>
      set({
        isStreaming: true,
        streamingMessageId: tempId,
        streamingDelta: '',
        error: null,
      }),

    appendDelta: (delta) =>
      set((state) => ({
        streamingDelta: state.streamingDelta + delta,
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
          streamingMessageId: null,
          streamingDelta: '',
        };
      }),

    cancelStreaming: () =>
      set((state) => {
        if (!state.isStreaming) return state;
        // Keep partial delta if any
        const partialMessage: ChatMessage | null = state.streamingMessageId
          ? {
              id: state.streamingMessageId,
              conversationId: state.currentConversationId ?? '',
              role: 'assistant',
              content: state.streamingDelta + ' [cancelled]',
              createdAt: new Date().toISOString(),
            }
          : null;

        return {
          messages: partialMessage ? [...state.messages, partialMessage] : state.messages,
          isStreaming: false,
          streamingMessageId: null,
          streamingDelta: '',
        };
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
