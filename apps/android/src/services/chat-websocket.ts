import type { ApiClient } from '../api/client.ts';
import { defaultApiClient } from '../api/client.ts';
import type { ChatMessage, ChatMode, MessageAttachment } from '../api/types.ts';
import { useChatStore } from '../state/chat-store.ts';

export interface ChatWebSocketOptions {
  client?: ApiClient;
  conversationId: string;
  onDelta?: (delta: string) => void;
  onCompleted?: (message: ChatMessage, modelUsed: string) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export class ChatWebSocketClient {
  private readonly client: ApiClient;
  private conversationId: string;
  private ws: WebSocket | null = null;
  private isClosedExplicitly = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private connectionGeneration = 0;
  private authenticated = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activeMessageId: string | null = null;

  constructor(options: ChatWebSocketOptions) {
    this.client = options.client ?? defaultApiClient;
    this.conversationId = options.conversationId;
  }

  async connect(): Promise<void> {
    const generation = ++this.connectionGeneration;
    this.isClosedExplicitly = false;
    this.authenticated = false;
    const store = useChatStore.getState();
    store.setConnectionStatus('connecting');
    try {
      const token = await this.client.getStorage().getAccessToken();
      if (generation !== this.connectionGeneration) return;
      if (!token) { store.setConnectionStatus('disconnected'); store.setError('Unauthenticated: missing access token'); return; }
      this.ws = new WebSocket(`${this.client.getBaseWsUrl()}/v1/chat/ws?token=${encodeURIComponent(token)}&conversationId=${encodeURIComponent(this.conversationId)}`);
      this.ws.onopen = () => { if (generation === this.connectionGeneration) this.reconnectAttempts = 0; };
      this.ws.onmessage = (event) => { if (generation !== this.connectionGeneration) return; try { this.handleFrame(JSON.parse(event.data as string)); } catch { /* ignore malformed frame */ } };
      this.ws.onerror = () => { if (generation === this.connectionGeneration) useChatStore.getState().setError('WebSocket connection error'); };
      this.ws.onclose = () => {
        if (generation !== this.connectionGeneration) return;
        this.authenticated = false;
        const current = useChatStore.getState();
        if (current.isSending || current.isStreaming) { current.failSend('Chat connection closed. Retry your message.'); current.cancelStreaming(); }
        if (!this.isClosedExplicitly) this.scheduleReconnect(); else current.setConnectionStatus('disconnected');
      };
    } catch (err) { store.setConnectionStatus('disconnected'); store.setError(err instanceof Error ? err.message : 'Failed to connect'); }
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const store = useChatStore.getState();
    switch (frame['type']) {

      case 'auth.ok':
        this.authenticated = true;
        store.setConnectionStatus('connected');
        return;
      case 'conversation.created': {
        const id = frame['conversationId'];
        if (typeof id === 'string') { this.conversationId = id; store.remapConversationId(id); }
        return;
      }
      case 'message.created': {
        const msg = frame['message'] as ChatMessage;
        store.appendMessage(msg);
        if (msg.role === 'user') store.acknowledgeSend();
        if (msg.role === 'assistant') {
          this.activeMessageId = msg.id;
          store.startStreaming(msg.id);
        }
        break;
      }
      case 'message.delta': {
        if (!this.authenticated) return;
        if (typeof frame['delta'] === 'string') store.appendDelta(frame['delta']);
        break;
      }
      case 'message.completed': {
        const completedMsg = frame['message'] as ChatMessage;
        store.finishStreaming(completedMsg);
        this.activeMessageId = null;
        break;
      }
      case 'message.cancelled': {
        const cancelledMsg = frame['message'] as ChatMessage | undefined;
        if (cancelledMsg) store.finishStreaming(cancelledMsg);
        else store.cancelStreaming();
        this.activeMessageId = null;
        break;
      }
      case 'error': {
        store.setError(typeof frame['message'] === 'string' ? frame['message'] : 'Model stream error');
        store.failSend(typeof frame['message'] === 'string' ? frame['message'] : 'Model stream error');
        store.cancelStreaming();
        this.activeMessageId = null;
        break;
      }
    }
  }

  sendMessage(params: {
    content: string;
    attachments?: MessageAttachment[] | undefined;
    model?: string | undefined;
    mode?: ChatMode | undefined;
    workspaceId?: string | undefined;
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      throw new Error('Chat WebSocket is not connected');
    }

    const payload = {
      type: 'chat.send',
      ...(this.conversationId ? { conversationId: this.conversationId } : {}),
      content: params.content,
      attachments: params.attachments ?? [],
      model: params.model,
      mode: params.mode ?? 'auto',
      workspaceId: params.workspaceId,
      stream: true,
    };

    this.ws.send(JSON.stringify(payload));
  }

  cancelActiveStream(): void {
    const store = useChatStore.getState();
    store.cancelStreaming();
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      store.requestCancellation();
      this.ws.send(JSON.stringify({ type: 'chat.cancel', messageId: this.activeMessageId }));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      useChatStore.getState().setConnectionStatus('disconnected');
      useChatStore.getState().setError('Max reconnect attempts reached');
      return;
    }

    useChatStore.getState().setConnectionStatus('reconnecting');
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  disconnect(): void {
    this.connectionGeneration++;
    this.isClosedExplicitly = true;
    this.authenticated = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    useChatStore.getState().setConnectionStatus('disconnected');
  }
}
