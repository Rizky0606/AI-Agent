import { EventEmitter } from 'node:events';

export interface DeviceSocket {
  send(data: string): void;
  close(): void;
  readyState?: number | undefined;
}

export interface ConnectedDeviceSession {
  deviceId: string;
  userId: string;
  platform: string;
  socket: DeviceSocket;
  connectedAt: string;
  lastSeenAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface DeviceCommandPayload {
  commandId: string;
  command: string;
  capability?: string | undefined;
  action?: string | undefined;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface DeviceCommandResult {
  commandId: string;
  success: boolean;
  result?:
    | {
        exitCode: number;
        stdout: string;
        stderr: string;
        truncated: boolean;
        durationMs: number;
      }
    | undefined;
  error?:
    | {
        code: string;
        message: string;
      }
    | undefined;
}

export class DeviceOfflineError extends Error {
  readonly deviceId: string;

  constructor(deviceId: string, detail = 'offline or unreachable') {
    super(`Device "${deviceId}" is ${detail}`);
    this.name = 'DeviceOfflineError';
    this.deviceId = deviceId;
  }
}

export class DeviceConnectionManager {
  private readonly sessions = new Map<string, ConnectedDeviceSession>();
  private readonly emitter = new EventEmitter();
  private readonly pendingCommands = new Map<
    string,
    {
      deviceId: string;
      resolve: (result: DeviceCommandResult) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  registerConnection(
    deviceId: string,
    userId: string,
    platform: string,
    socket: DeviceSocket,
    metadata?: Record<string, unknown> | undefined,
  ): void {
    const previous = this.sessions.get(deviceId);
    if (previous) {
      // Same key, new socket: the old one is stale, and its close event must not tear down the
      // session that replaced it.
      previous.socket.close();
    }

    const session: ConnectedDeviceSession = {
      deviceId,
      userId,
      platform,
      socket,
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      metadata,
    };

    this.sessions.set(deviceId, session);
    this.emitter.emit('status', { deviceId, userId, platform, status: 'online' });
  }

  /**
   * Drops the session only when it still belongs to `socket`, so a socket that was replaced by a
   * reconnect cannot unregister its successor.
   */
  unregisterConnection(deviceId: string, socket?: DeviceSocket | undefined): void {
    const existing = this.sessions.get(deviceId);
    if (!existing) return;
    if (socket !== undefined && existing.socket !== socket) return;
    this.sessions.delete(deviceId);
    this.emitter.emit('status', {
      deviceId,
      userId: existing.userId,
      platform: existing.platform,
      status: 'offline',
    });
  }

  isDeviceOnline(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }

  /**
   * Device ids currently connected for the user. The dispatch path is the only thing that can
   * reach a socket, so presence has to be answered here rather than from the devices table.
   */
  listOnlineDeviceIds(userId: string, platform?: string | undefined): string[] {
    const ids: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (platform !== undefined && session.platform !== platform) continue;
      ids.push(session.deviceId);
    }
    return ids;
  }

  updateHeartbeat(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (session) {
      session.lastSeenAt = new Date().toISOString();
    }
  }

  /**
   * Waits for a device session to (re)appear, up to `timeoutMs`.
   *
   * Sessions live in this process, so an API restart drops every one of them. Without a grace
   * window, a task approved moments earlier fails instantly even though the agent reconnects
   * seconds later, and the user has to approve the same command again. Resolves `true` as soon as
   * a matching session exists, `false` when the window closes.
   */
  async waitForConnection(
    deviceId: string,
    timeoutMs: number,
    userId?: string | undefined,
  ): Promise<boolean> {
    const existing = this.sessions.get(deviceId);
    if (existing && (userId === undefined || existing.userId === userId)) return true;
    if (timeoutMs <= 0) return false;

    return new Promise<boolean>((resolve) => {
      const finish = (connected: boolean): void => {
        clearTimeout(timer);
        this.emitter.off('status', onStatus);
        resolve(connected);
      };
      const onStatus = (event: { deviceId: string; status: 'online' | 'offline' }): void => {
        const session = this.sessions.get(deviceId);
        if (event.status !== 'online' || event.deviceId !== deviceId || !session) return;
        if (userId !== undefined && session.userId !== userId) return;
        finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.emitter.on('status', onStatus);
    });
  }

  /**
   * Routes a device's `command.result` frame back to the dispatch waiting for it. The frame is
   * parsed here rather than cast at the call site: the socket is on the far side of a trust
   * boundary, and a device that reports success without an exit code must not be able to turn a
   * failed command into a completed task.
   */
  handleCommandResult(deviceId: string, frame: Record<string, unknown>): void {
    const commandId = frame['commandId'];
    if (typeof commandId !== 'string') return;
    const pending = this.pendingCommands.get(commandId);
    if (!pending || pending.deviceId !== deviceId) return;

    clearTimeout(pending.timer);
    this.pendingCommands.delete(commandId);

    const raw = frame['result'];
    const result =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined;
    const error =
      typeof frame['error'] === 'object' && frame['error'] !== null
        ? (frame['error'] as Record<string, unknown>)
        : undefined;
    const exitCode = result?.['exitCode'];

    if (frame['success'] !== true || typeof exitCode !== 'number') {
      pending.resolve({
        commandId,
        success: false,
        error: {
          code: typeof error?.['code'] === 'string' ? error['code'] : 'COMMAND_FAILED',
          message:
            typeof error?.['message'] === 'string'
              ? error['message']
              : 'Device reported failure without an exit code',
        },
      });
      return;
    }

    pending.resolve({
      commandId,
      success: true,
      result: {
        exitCode,
        stdout: typeof result?.['stdout'] === 'string' ? result['stdout'] : '',
        stderr: typeof result?.['stderr'] === 'string' ? result['stderr'] : '',
        truncated: result?.['truncated'] === true,
        durationMs: typeof result?.['durationMs'] === 'number' ? result['durationMs'] : 0,
      },
    });
  }

  /**
   * Sends `command.execute` over the device's WSS session and resolves with what the device
   * reports back. A device owned by somebody else is reported exactly like an absent one, so the
   * caller cannot use this endpoint to probe which device ids exist.
   */
  async dispatchCommand(
    deviceId: string,
    command: DeviceCommandPayload,
    options?: { userId?: string | undefined; timeoutMs?: number | undefined },
  ): Promise<DeviceCommandResult> {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const session = this.sessions.get(deviceId);
    if (!session || (options?.userId !== undefined && session.userId !== options.userId)) {
      throw new DeviceOfflineError(deviceId);
    }

    const payload = {
      type: 'command.execute',
      ...command,
    };

    return new Promise<DeviceCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(command.commandId);
        reject(new Error(`Command ${command.commandId} dispatch to device timed out`));
      }, timeoutMs);

      this.pendingCommands.set(command.commandId, { deviceId, resolve, reject, timer });

      try {
        const raw = JSON.stringify(payload);
        session.socket.send(raw);
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(command.commandId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  onDeviceStatusChange(
    listener: (event: {
      deviceId: string;
      userId: string;
      platform: string;
      status: 'online' | 'offline';
    }) => void,
  ): () => void {
    this.emitter.on('status', listener);
    return () => {
      this.emitter.off('status', listener);
    };
  }
}
