import type { ICommandExecutor } from '../security/types.ts';
import type { CapabilityName } from '../security/capability-registry.ts';
import type { DeviceIdentity } from './device-identity.ts';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface AgentConnectionOptions {
  serverUrl: string;
  token: string;
  identity: DeviceIdentity;
  executor: ICommandExecutor;
  heartbeatIntervalMs?: number | undefined;
  maxReconnectAttempts?: number | undefined;
  onStatusChange?: ((status: ConnectionStatus) => void) | undefined;
  onLogMessage?: ((level: 'info' | 'warn' | 'error', message: string) => void) | undefined;
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
}

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
      const wsUrl =
        httpBase.replace(/^http(s?):/i, 'ws$1:') +
        `/v1/agent/ws?token=${encodeURIComponent(this.options.token)}&deviceId=${encodeURIComponent(this.options.identity.id)}&platform=windows`;

      this.log('info', `Initiating outbound WSS connection to ${httpBase}...`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.log('info', `Successfully connected to server as device ${this.options.identity.id}`);

        // Send device registration handshake
        this.send({
          type: 'device.handshake',
          device: this.options.identity,
          capabilities: this.options.executor.getCapabilityRegistry().getAllRules(),
          allowedRoots: this.options.executor.getPathValidator().getAllowedRoots(),
        });

        this.startHeartbeat();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw) as InboundServerMessage;
          void this.handleServerMessage(msg);
        } catch (err) {
          this.log(
            'warn',
            `Failed to parse inbound message: ${err instanceof Error ? err.message : String(err)}`,
          );
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
