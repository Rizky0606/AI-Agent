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

export interface DevicePresenceRecord {
  deviceId: string;
  userId: string;
  platform: string;
  status: 'online' | 'offline';
  connectedAt: string;
  lastSeenAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface DevicePresenceStore {
  savePresence(record: DevicePresenceRecord): Promise<void> | void;
  getPresence(deviceId: string): Promise<DevicePresenceRecord | null> | DevicePresenceRecord | null;
  listRecentPresences(
    userId: string,
    platform?: string,
  ): Promise<DevicePresenceRecord[]> | DevicePresenceRecord[];
  updateLastSeen?(deviceId: string, lastSeenAt: string): Promise<void> | void;
}

export class InMemoryDevicePresenceStore implements DevicePresenceStore {
  private readonly presences = new Map<string, DevicePresenceRecord>();

  savePresence(record: DevicePresenceRecord): void {
    this.presences.set(record.deviceId, { ...record });
  }

  getPresence(deviceId: string): DevicePresenceRecord | null {
    const item = this.presences.get(deviceId);
    return item ? { ...item } : null;
  }

  listRecentPresences(userId: string, platform?: string): DevicePresenceRecord[] {
    const result: DevicePresenceRecord[] = [];
    for (const record of this.presences.values()) {
      if (record.userId !== userId) continue;
      if (platform !== undefined && record.platform !== platform) continue;
      result.push({ ...record });
    }
    return result;
  }

  updateLastSeen(deviceId: string, lastSeenAt: string): void {
    const item = this.presences.get(deviceId);
    if (item) {
      item.lastSeenAt = lastSeenAt;
    }
  }
}

export interface DeviceAuditSink {
  logDeviceEvent(event: {
    action: 'device.connected' | 'device.disconnected' | 'device.heartbeat' | 'device.command_dispatched';
    deviceId: string;
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> | void;
}

export interface DeviceConnectionManagerOptions {
  presenceStore?: DevicePresenceStore | undefined;
  auditSink?: DeviceAuditSink | undefined;
  /** Bounded window (ms) where a recently seen device is retained across API restarts. Default 30,000ms. */
  presenceGraceMs?: number | undefined;
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

  private readonly presenceStore: DevicePresenceStore;
  private readonly auditSink?: DeviceAuditSink | undefined;
  private readonly presenceGraceMs: number;

  constructor(options?: DeviceConnectionManagerOptions) {
    this.emitter.setMaxListeners(200);
    this.presenceStore = options?.presenceStore ?? new InMemoryDevicePresenceStore();
    this.auditSink = options?.auditSink;
    this.presenceGraceMs = options?.presenceGraceMs ?? 30_000;
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
      previous.socket.close();
    }

    const now = new Date().toISOString();
    const session: ConnectedDeviceSession = {
      deviceId,
      userId,
      platform,
      socket,
      connectedAt: now,
      lastSeenAt: now,
      metadata,
    };

    this.sessions.set(deviceId, session);

    // Persist bounded presence record
    void Promise.resolve(
      this.presenceStore.savePresence({
        deviceId,
        userId,
        platform,
        status: 'online',
        connectedAt: now,
        lastSeenAt: now,
        metadata,
      }),
    ).catch(() => {});

    // Audit device connection event
    if (this.auditSink) {
      void Promise.resolve(
        this.auditSink.logDeviceEvent({
          action: 'device.connected',
          deviceId,
          userId,
          metadata: { platform, ...metadata },
        }),
      ).catch(() => {});
    }

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

    const now = new Date().toISOString();
    void Promise.resolve(
      this.presenceStore.savePresence({
        deviceId,
        userId: existing.userId,
        platform: existing.platform,
        status: 'offline',
        connectedAt: existing.connectedAt,
        lastSeenAt: now,
        metadata: existing.metadata,
      }),
    ).catch(() => {});

    if (this.auditSink) {
      void Promise.resolve(
        this.auditSink.logDeviceEvent({
          action: 'device.disconnected',
          deviceId,
          userId: existing.userId,
          metadata: { platform: existing.platform },
        }),
      ).catch(() => {});
    }

    this.emitter.emit('status', {
      deviceId,
      userId: existing.userId,
      platform: existing.platform,
      status: 'offline',
    });
  }

  isDeviceOnline(deviceId: string): boolean {
    if (this.sessions.has(deviceId)) return true;

    // Check bounded presence store for recent heartbeat
    const record = this.presenceStore.getPresence(deviceId);
    if (record instanceof Promise) {
      // Synchronous check fallback: if in promise form, check memory session
      return false;
    }
    if (record && record.status === 'online') {
      const elapsed = Date.now() - new Date(record.lastSeenAt).getTime();
      return elapsed <= this.presenceGraceMs;
    }
    return false;
  }

  /**
   * Device ids currently connected or within bounded reconnect grace window for the user.
   */
  listOnlineDeviceIds(userId: string, platform?: string | undefined): string[] {
    const ids = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (platform !== undefined && session.platform !== platform) continue;
      ids.add(session.deviceId);
    }

    // Merge in devices with active bounded presence within grace window
    const recent = this.presenceStore.listRecentPresences(userId, platform);
    if (Array.isArray(recent)) {
      const now = Date.now();
      for (const item of recent) {
        if (item.status === 'online') {
          const elapsed = now - new Date(item.lastSeenAt).getTime();
          if (elapsed <= this.presenceGraceMs) {
            ids.add(item.deviceId);
          }
        }
      }
    }

    return Array.from(ids);
  }

  updateHeartbeat(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    const now = new Date().toISOString();
    if (session) {
      session.lastSeenAt = now;
    }
    void Promise.resolve(this.presenceStore.updateLastSeen?.(deviceId, now)).catch(() => {});
  }

  /**
   * Waits for a device session to (re)appear, up to `timeoutMs`.
   * Sessions live in this process, so an API restart drops physical sockets.
   * If a device has recently been online, the dispatcher waits boundedly for the
   * client reconnection loop to dial back in.
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

    if (this.auditSink) {
      void Promise.resolve(
        this.auditSink.logDeviceEvent({
          action: 'device.command_dispatched',
          deviceId,
          userId: session.userId,
          metadata: {
            commandId: command.commandId,
            command: command.command,
            capability: command.capability,
          },
        }),
      ).catch(() => {});
    }

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
