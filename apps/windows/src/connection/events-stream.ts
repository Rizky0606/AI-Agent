import type { TaskEventEnvelope } from '@personal-ai-os/shared';
import { deriveWsUrl } from '../api/client.ts';

export type StreamStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface TaskEventsStreamOptions {
  serverUrl: () => string;
  token: () => string;
  /** `null` subscribes to every task of the account; a task id scopes to that task. */
  taskId: () => string | null;
  onEvent: (event: TaskEventEnvelope) => void;
  onStatusChange?: ((status: StreamStatus) => void) | undefined;
  maxReconnectAttempts?: number | undefined;
}

/**
 * Subscribes to `/v1/events/ws` for the active task. Reconnects with exponential
 * backoff and replays from the last received event id so no event is lost.
 */
export class TaskEventsStream {
  private readonly options: TaskEventsStreamOptions;
  private ws: WebSocket | null = null;
  private closedExplicitly = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastEventId: string | null = null;

  constructor(options: TaskEventsStreamOptions) {
    this.options = options;
  }

  connect(): void {
    this.closeSocket();
    this.closedExplicitly = false;
    const taskId = this.options.taskId();
    const token = this.options.token();
    if (!token) {
      this.notify('disconnected');
      return;
    }

    const params = new URLSearchParams({ token });
    if (taskId) params.set('taskId', taskId);
    if (this.lastEventId) params.set('last_event_id', this.lastEventId);

    this.notify(this.reconnectAttempts > 0 ? 'reconnecting' : 'connected');
    this.ws = new WebSocket(`${deriveWsUrl(this.options.serverUrl())}/v1/events/ws?${params}`);

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const envelope = JSON.parse(String(event.data)) as TaskEventEnvelope;
        if (!envelope?.eventType) return;
        if (envelope.id) this.lastEventId = envelope.id;
        this.options.onEvent(envelope);
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      if (this.closedExplicitly) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      this.notify('disconnected');
      return;
    }
    this.notify('reconnecting');
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private notify(status: StreamStatus): void {
    this.options.onStatusChange?.(status);
  }

  disconnect(): void {
    this.closedExplicitly = true;
    this.closeSocket();
    this.reconnectAttempts = 0;
    this.notify('disconnected');
  }

  private closeSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /** Clears replay state so a newly selected task starts from its own history. */
  reset(): void {
    this.lastEventId = null;
    this.reconnectAttempts = 0;
  }
}
