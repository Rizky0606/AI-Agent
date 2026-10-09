import type { ApiClient } from '../api/client.ts';
import { defaultApiClient } from '../api/client.ts';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';

export interface TaskEventsWsOptions {
  client?: ApiClient;
  taskId?: string | undefined;
  onEvent: (event: TaskEventEnvelope) => void;
  onStatusChange?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
}

export class TaskEventsWebSocketClient {
  private readonly client: ApiClient;
  private readonly taskId?: string | undefined;
  private readonly onEvent: (event: TaskEventEnvelope) => void;
  private readonly onStatusChange?:
    ((status: 'connected' | 'reconnecting' | 'disconnected') => void) | undefined;
  private ws: WebSocket | null = null;
  private isClosedExplicitly = false;
  private lastEventId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: TaskEventsWsOptions) {
    this.client = options.client ?? defaultApiClient;
    this.taskId = options.taskId;
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
  }

  async connect(): Promise<void> {
    this.isClosedExplicitly = false;
    this.notifyStatus('reconnecting');

    try {
      const token = await this.client.getStorage().getAccessToken();
      if (!token) {
        this.notifyStatus('disconnected');
        return;
      }

      const httpUrl = this.client.getBaseUrl();
      const params = new URLSearchParams({ token });
      if (this.taskId) params.set('taskId', this.taskId);
      if (this.lastEventId) params.set('last_event_id', this.lastEventId);

      const wsUrl = httpUrl.replace(/^http(s?):/i, 'ws$1:') + `/v1/events/ws?${params.toString()}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.notifyStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data as string) as TaskEventEnvelope;
          if (envelope?.id) {
            this.lastEventId = envelope.id;
          }
          this.onEvent(envelope);
        } catch {
          // invalid envelope frame
        }
      };

      this.ws.onerror = () => {
        // error will trigger onclose
      };

      this.ws.onclose = () => {
        if (!this.isClosedExplicitly) {
          this.scheduleReconnect();
        } else {
          this.notifyStatus('disconnected');
        }
      };
    } catch {
      this.notifyStatus('disconnected');
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.notifyStatus('disconnected');
      return;
    }

    this.notifyStatus('reconnecting');
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private notifyStatus(status: 'connected' | 'reconnecting' | 'disconnected'): void {
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }

  disconnect(): void {
    this.isClosedExplicitly = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.notifyStatus('disconnected');
  }
}
