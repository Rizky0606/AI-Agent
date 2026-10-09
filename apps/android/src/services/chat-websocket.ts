import type { ApiClient } from '../api/client.ts';
import { defaultApiClient } from '../api/client.ts';
import type { ChatMessage, MessageAttachment } from '../api/types.ts';
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
  private readonly conversationId: string;
  private ws: WebSocket | null = null;
  private isClosedExplicitly = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activeMessageId: string | null = null;

  constructor(options: ChatWebSocketOptions) {
    this.client = options.client ?? defaultApiClient;
    this.conversationId = options.conversationId;
  }

  async connect(): Promise<void> {
    this.isClosedExplicitly = false;
    const store = useChatStore.getState();
    store.setConnectionStatus('connecting');

    try {
      const token = await this.client.getStorage().getAccessToken();
      if (!token) {
        store.setConnectionStatus('disconnected');
        store.setError('Unauthenticated: missing access token');
        return;
      }

      const httpUrl = this.client.getBaseUrl();
      const wsUrl =
        httpUrl.replace(/^http(s?):/i, 'ws$1:') +
        `/v1/chat/ws?token=${encodeURIComponent(token)}&conversationId=${encodeURIComponent(this.conversationId)}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        useChatStore.getState().setConnectionStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.handleFrame(data);
        } catch {
          // invalid JSON frame
        }
      };

      this.ws.onerror = () => {
        useChatStore.getState().setError('WebSocket connection error');
      };

      this.ws.onclose = () => {
        if (!this.isClosedExplicitly) {
          this.scheduleReconnect();
        } else {
          useChatStore.getState().setConnectionStatus('disconnected');
        }
      };
    } catch (err) {
      store.setConnectionStatus('disconnected');
      store.setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const store = useChatStore.getState();

    switch (frame['type']) {
      case 'message.created': {
        const msg = frame['message'] as ChatMessage;
        this.activeMessageId = msg.id;
        store.appendMessage(msg);
        store.startStreaming(msg.id);
        break;
      }
      case 'message.delta': {
        if (typeof frame['delta'] === 'string') {
          store.appendDelta(frame['delta']);
        }
        break;
      }
      case 'message.completed': {
        const completedMsg = frame['message'] as ChatMessage;
        store.finishStreaming(completedMsg);
        this.activeMessageId = null;
        break;
      }
      case 'message.error': {
        const errObj = frame['error'] as { message?: string } | undefined;
        store.setError(errObj?.message ?? 'Model stream error');
        store.cancelStreaming();
        this.activeMessageId = null;
        break;
      }
      case 'chat.cancelled': {
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
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Chat WebSocket is not connected');
    }

    const payload = {
      type: 'chat.send',
      content: params.content,
      attachments: params.attachments ?? [],
      model: params.model,
      stream: true,
    };

    this.ws.send(JSON.stringify(payload));
  }

  cancelActiveStream(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat.cancel', messageId: this.activeMessageId }));
    }
    useChatStore.getState().cancelStreaming();
    this.activeMessageId = null;
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
    this.isClosedExplicitly = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    useChatStore.getState().setConnectionStatus('disconnected');
  }
}
