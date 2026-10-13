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

  unregisterConnection(deviceId: string): void {
    const existing = this.sessions.get(deviceId);
    if (existing) {
      this.sessions.delete(deviceId);
      this.emitter.emit('status', {
        deviceId,
        userId: existing.userId,
        platform: existing.platform,
        status: 'offline',
      });
    }
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

  getOnlineDevices(userId: string): Array<{
    deviceId: string;
    platform: string;
    connectedAt: string;
    lastSeenAt: string;
  }> {
    const list: Array<{
      deviceId: string;
      platform: string;
      connectedAt: string;
      lastSeenAt: string;
    }> = [];

    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        list.push({
          deviceId: session.deviceId,
          platform: session.platform,
          connectedAt: session.connectedAt,
          lastSeenAt: session.lastSeenAt,
        });
      }
    }

    return list;
  }

  updateHeartbeat(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (session) {
      session.lastSeenAt = new Date().toISOString();
    }
  }

  handleCommandResult(result: DeviceCommandResult): void {
    const pending = this.pendingCommands.get(result.commandId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingCommands.delete(result.commandId);
      pending.resolve(result);
    }
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

      this.pendingCommands.set(command.commandId, { resolve, reject, timer });

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
