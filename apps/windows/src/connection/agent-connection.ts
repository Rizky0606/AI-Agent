import type { ICommandExecutor } from '../security/types.ts';
import type { CapabilityName } from '../security/capability-registry.ts';
import type { DeviceIdentity } from './device-identity.ts';
import type { DeviceKeyStore } from './device-key.ts';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';


export interface ChatFrame {
  type: string;
  conversationId?: string;
  messageId?: string;
  delta?: string;
  content?: string;
  code?: string;
  message?: string | { id: string; role: 'user' | 'assistant' | 'system'; content: string; cancelled?: boolean; metadata?: Record<string, unknown> };
  usage?: Record<string, unknown>;
  resolvedModel?: string;
  model?: string;
  fallbackUsed?: boolean;
}

export interface AgentConnectionOptions {
  serverUrl: string;
  token: string;
  identity: DeviceIdentity;
  /** Holds the P-256 key this agent signs the server's challenge with. */
  keyStore: DeviceKeyStore;
  executor: ICommandExecutor;
  heartbeatIntervalMs?: number | undefined;
  maxReconnectAttempts?: number | undefined;
  onStatusChange?: ((status: ConnectionStatus) => void) | undefined;
  onLogMessage?: ((level: 'info' | 'warn' | 'error', message: string) => void) | undefined;
  /** Receives the id the server assigned to this device key. */
  onDeviceId?: ((deviceId: string) => void) | undefined;
}

export interface InboundServerMessage {
  type: string;
  id?: string | undefined;
  commandId?: string | undefined;
  command?: string | undefined;
  capability?: string | undefined;
  action?: string | undefined;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
  challenge?: string | undefined;
  deviceId?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
}

/** Server codes that a retry cannot fix: the credential or the key is wrong, not the network. */
const FATAL_HANDSHAKE_CODES = new Set([
  'UNAUTHORIZED',
  'DEVICE_KEY_INVALID',
  'DEVICE_SIGNATURE_INVALID',
  'DEVICE_SIGNATURE_MISSING',
  'DEVICE_NAME_INVALID',
  'DEVICE_PLATFORM_INVALID',
]);


export class AgentConnection {
  private options: AgentConnectionOptions;
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private isClosedExplicitly = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(options: AgentConnectionOptions) {
    this.options = options;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange?.(status);
      this.log('info', `Connection status changed to: ${status}`);
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.onLogMessage?.(level, message);
  }

  async connect(): Promise<void> {
    this.isClosedExplicitly = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const httpBase = this.options.serverUrl.replace(/\/+$/, '');
      // No deviceId here: the server issues it after verifying the key, and refuses a claimed one.
      const wsUrl =
        httpBase.replace(/^http(s?):/i, 'ws$1:') +
        `/v1/agent/ws?token=${encodeURIComponent(this.options.token)}`;

      this.log('info', `Initiating outbound WSS connection to ${httpBase}...`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.log('info', 'Socket open; waiting for the server challenge to sign');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw) as InboundServerMessage;
          void this.handleServerMessage(msg);
        } catch (err) {
          this.log('warn', `Failed to parse inbound message: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      this.ws.onerror = (err: Event) => {
        this.log('error', `WebSocket connection error: ${JSON.stringify(err)}`);
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (!this.isClosedExplicitly) {
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };
    } catch (err) {
      this.log(
        'error',
        `Failed to initialize connection: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.scheduleReconnect();
    }
  }

  private async handleServerMessage(msg: InboundServerMessage): Promise<void> {
    switch (msg.type) {
      case 'device.challenge':
        await this.answerChallenge(msg.challenge);
        break;

      case 'device.handshake_ack':
        if (msg.deviceId) {
          this.log('info', `Server registered this device as ${msg.deviceId}`);
          this.options.onDeviceId?.(msg.deviceId);
        }
        this.setStatus('connected');
        this.startHeartbeat();
        break;

      case 'device.error':
        this.handleHandshakeError(msg);
        break;

      case 'ping':
        this.send({ type: 'pong', timestamp: Date.now() });
        break;

      case 'pong':
        // Heartbeat acknowledged
        break;

      case 'command.execute':
        await this.handleExecuteCommand(msg);
        break;

      case 'command.cancel':
        this.handleCancelCommand(msg);
        break;

      default:
        this.log('warn', `Received unhandled message type: ${msg.type}`);
    }
  }

  /** Signs the server's nonce with the device key and reports the public half back. */
  private async answerChallenge(challenge: string | undefined): Promise<void> {
    if (!challenge) {
      this.log('error', 'Server sent a challenge without a nonce');
      return;
    }

    try {
      const [publicKey, signature] = await Promise.all([
        this.options.keyStore.publicKey(),
        this.options.keyStore.sign(challenge),
      ]);
      this.send({
        type: 'device.handshake',
        publicKey,
        signature,
        name: this.options.identity.name,
        platform: this.options.identity.platform,
        hostname: this.options.identity.hostname,
        capabilities: this.options.executor.getCapabilityRegistry().getAllRules(),
        allowedRoots: this.options.executor.getPathValidator().getAllowedRoots(),
      });
    } catch (err) {
      this.log(
        'error',
        `Could not sign the device challenge: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private handleHandshakeError(msg: InboundServerMessage): void {
    const code = msg.code ?? 'DEVICE_HANDSHAKE_FAILED';
    this.log('error', `Device handshake refused (${code}): ${msg.message ?? 'no detail'}`);
    if (FATAL_HANDSHAKE_CODES.has(code)) {
      // Reconnecting with the same rejected credential would only repeat the failure.
      this.isClosedExplicitly = true;
      this.setStatus('disconnected');
    }
    this.ws?.close();
  }

  private async handleExecuteCommand(msg: InboundServerMessage): Promise<void> {
    const cmdId = msg.commandId ?? msg.id ?? `cmd-${Date.now()}`;
    const commandText = msg.command;
    const cwd =
      msg.cwd ??
      (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.');
    const capability = (msg.capability as CapabilityName | undefined) ?? 'powershell';
    const action = msg.action ?? 'exec';

    if (!commandText) {
      this.send({
        type: 'command.result',
        commandId: cmdId,
        success: false,
        error: { code: 'EMPTY_COMMAND', message: 'No command string provided' },
      });
      return;
    }

    const abortController = new AbortController();
    this.activeAbortControllers.set(cmdId, abortController);

    this.send({
      type: 'command.started',
      commandId: cmdId,
      timestamp: Date.now(),
    });

    try {
      this.log('info', `Executing command [${cmdId}]: "${commandText.slice(0, 60)}" in ${cwd}`);
      const result = await this.options.executor.executePowershell(
        commandText,
        {
          capability,
          action,
          cwd,
          timeoutMs: msg.timeoutMs,
          signal: abortController.signal,
        },
        cmdId,
      );

      this.send({
        type: 'command.result',
        commandId: cmdId,
        success: result.exitCode === 0,
        result: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
          durationMs: result.durationMs,
        },
      });
      this.log('info', `Command [${cmdId}] finished with exit code ${result.exitCode}`);
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      this.send({
        type: 'command.result',
        commandId: cmdId,
        success: false,
        error: {
          code: errObj?.code ?? 'EXECUTION_ERROR',
          message: errObj?.message ?? String(err),
        },
      });
      this.log('error', `Command [${cmdId}] failed: ${errObj?.message ?? String(err)}`);
    } finally {
      this.activeAbortControllers.delete(cmdId);
    }
  }

  private handleCancelCommand(msg: InboundServerMessage): void {
    const cmdId = msg.commandId ?? msg.id;
    if (cmdId && this.activeAbortControllers.has(cmdId)) {
      this.log('warn', `Cancelling running command [${cmdId}] upon server request`);
      this.activeAbortControllers.get(cmdId)?.abort();
      this.options.executor.cancelExecution(cmdId);
      this.activeAbortControllers.delete(cmdId);
    }
  }
  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', timestamp: Date.now() });
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      this.setStatus('disconnected');
      this.log(
        'error',
        `Reached maximum reconnection attempts (${maxAttempts}). Stopped retrying.`,
      );
      return;
    }

    this.setStatus('reconnecting');
    // Exponential backoff: 1s, 2s, 4s, 8s, up to 15s + jitter
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 500,
      15_000,
    );
    this.reconnectAttempts++;
    this.log(
      'info',
      `Scheduling reconnect attempt ${this.reconnectAttempts} in ${Math.round(delay)}ms...`,
    );

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  simulateSocketDrop(): void {
    if (this.ws) {
      this.ws.close();
    }
  }

  disconnect(): void {
    this.isClosedExplicitly = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const ctrl of this.activeAbortControllers.values()) {
      ctrl.abort();
    }
    this.activeAbortControllers.clear();
    this.options.executor.cancelAll();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
    this.log('info', 'Agent disconnected explicitly');
  }
}

/** Chat uses account authentication only; no device registration or command permissions. */
export class ChatConnection {
  private ws: WebSocket | null = null;
  private pending: Record<string, unknown> | null = null;
  private activeMessageId: string | undefined;
  private cancelPending = false;
  private authenticated = false;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closedExplicitly = false;
  private readonly options: {
    serverUrl: string;
    token: string;
    onFrame: (frame: ChatFrame) => void;
    onStatusChange?: ((status: ConnectionStatus) => void) | undefined;
    maxReconnectAttempts?: number | undefined;
  };
  constructor(options: ChatConnection['options']) { this.options = options; }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private open(): void {
    const base = this.options.serverUrl.replace(/\/+$/, '').replace(/^http(s?):/i, 'ws$1:');
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${base}/v1/chat/ws?token=${encodeURIComponent(this.options.token)}`);
    this.ws = ws;
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const frame = JSON.parse(String(event.data)) as ChatFrame;
        if (frame.type === 'auth.ok') {
          this.authenticated = true;
          this.reconnectAttempts = 0;
          this.setStatus('connected');
          if (this.pending) ws.send(JSON.stringify(this.pending));
          this.pending = null;
          if (this.cancelPending) this.cancelChat();
        }
        if (frame.type === 'message.created' && typeof frame.message === 'object' && frame.message.role === 'assistant') this.activeMessageId = frame.message.id;
        this.options.onFrame(frame);
      } catch { this.options.onFrame({ type: 'error', code: 'INVALID_FRAME', message: 'Invalid chat frame received' }); }
    };
    ws.onerror = () => {
      if (this.ws !== ws || this.closedExplicitly) return;
      this.options.onFrame({ type: 'error', code: 'CHAT_CONNECTION', message: 'Chat connection failed' });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authenticated = false;
      this.cancelPending = false;
      if (this.closedExplicitly) { this.setStatus('disconnected'); return; }
      this.options.onFrame({ type: 'error', code: 'CHAT_CLOSED', message: 'Chat connection lost. Reconnecting…' });
      this.scheduleReconnect();
    };
  }

  sendChatMessage(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify(payload));
      return;
    }
    // Queue for the open (possibly still authenticating) socket instead of dialling a second one.
    this.pending = payload;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    this.closedExplicitly = false;
    this.reconnectAttempts = 0;
    this.open();
  }

  /** Opens the socket before the first message so connection state is visible immediately. */
  connect(): void {
    if (this.ws) return;
    this.closedExplicitly = false;
    this.reconnectAttempts = 0;
    this.open();
  }

  cancelChat(): void {
    this.cancelPending = this.ws?.readyState !== WebSocket.OPEN;
    if (!this.cancelPending) this.ws?.send(JSON.stringify({ type: 'chat.cancel', ...(this.activeMessageId ? { messageId: this.activeMessageId } : {}) }));
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      this.setStatus('disconnected');
      this.options.onFrame({ type: 'error', code: 'CHAT_RECONNECT_EXHAUSTED', message: 'Chat is offline. Retry to reconnect.' });
      return;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10_000);
    this.reconnectAttempts++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.open(); }, delay);
  }

  disconnect(): void {
    this.closedExplicitly = true;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.authenticated = false;
    this.pending = null;
    this.cancelPending = false;
    ws?.close();
    this.setStatus('disconnected');
  }
}
