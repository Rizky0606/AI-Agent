import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { NormalizedRuntimeEvent } from './index.ts';
import { parseOmpLine, MAX_LINE_BUFFER_BYTES, MAX_EVENTS_PER_RUN } from './index.ts';

export type OmpSessionState =
  | 'uninitialized'
  | 'starting'
  | 'handshaking'
  | 'ready'
  | 'busy'
  | 'idle'
  | 'closing'
  | 'closed'
  | 'crashed';

export type OmpRpcCommand =
  | { id: string; type: 'prompt'; prompt: string }
  | { id: string; type: 'steer'; message: string }
  | { id: string; type: 'follow_up'; message: string }
  | { id: string; type: 'abort' }
  | { id: string; type: 'get_state' }
  | { id: string; type: 'clear_queue' };

export interface OmpRpcResponse {
  id: string;
  type: 'response';
  command: string;
  success: boolean;
  data?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

export interface OmpRpcHandshake {
  type: 'ready';
  protocolVersion: number;
  supportedProtocolVersions: number[];
  maxFrameBytes: number;
  maxReassembledFrameBytes: number;
}

export interface OmpRpcSessionOptions {
  sessionId?: string | undefined;
  resume?: boolean | undefined;
  workspaceDir: string;
  binPath?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  commandTimeoutMs?: number | undefined;
  idleTimeoutMs?: number | undefined;
  onEvent?: ((event: NormalizedRuntimeEvent) => void) | undefined;
  onStateChange?: ((state: OmpSessionState) => void) | undefined;
}

/**
 * Incremental NDJSON/JSONL parser with bounded memory buffers.
 * Safely handles chunk splits, multiple events per chunk, oversized lines, and invalid JSON.
 */
export class OmpJsonlParser {
  private lineBuffer = '';
  private truncated = false;
  readonly maxLineBytes: number;

  constructor(maxLineBytes = MAX_LINE_BUFFER_BYTES) {
    this.maxLineBytes = maxLineBytes;
  }

  isTruncated(): boolean {
    return this.truncated;
  }

  feed(chunk: Buffer | string): Array<{ raw: string; parsed?: Record<string, unknown> }> {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const results: Array<{ raw: string; parsed?: Record<string, unknown> }> = [];

    // Guard against memory explosion if chunk has no newline and buffer grows too large
    if (this.lineBuffer.length + str.length > this.maxLineBytes && !str.includes('\n')) {
      this.truncated = true;
      this.lineBuffer = '';
      return results;
    }

    this.lineBuffer += str;
    let newlineIdx: number;

    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);

      if (!line) continue;

      if (line.length > this.maxLineBytes) {
        this.truncated = true;
        continue;
      }

      if (!line.startsWith('{')) {
        // Plain text log line from runtime
        results.push({ raw: line });
        continue;
      }

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        results.push({ raw: line, parsed });
      } catch {
        // Discard malformed JSON without crashing parser
        results.push({ raw: line });
      }
    }

    if (this.lineBuffer.length > this.maxLineBytes) {
      this.truncated = true;
      this.lineBuffer = this.lineBuffer.slice(-this.maxLineBytes);
    }

    return results;
  }

  flush(): Array<{ raw: string; parsed?: Record<string, unknown> }> {
    const remaining = this.lineBuffer.trim();
    this.lineBuffer = '';
    if (!remaining || remaining.length > this.maxLineBytes) return [];

    if (!remaining.startsWith('{')) return [{ raw: remaining }];

    try {
      const parsed = JSON.parse(remaining) as Record<string, unknown>;
      return [{ raw: remaining, parsed }];
    } catch {
      return [{ raw: remaining }];
    }
  }
}

/**
 * Bi-directional stdio RPC adapter for OMP (Oh-My-Pi).
 * Follows the verified protocol:
 * 1. Subprocess starts with `--mode rpc`.
 * 2. Handshake `ready` frame parsed from stdout.
 * 3. Commands (`prompt`, `steer`, `follow_up`, `abort`, `get_state`) sent via stdin JSONL.
 * 4. Correlates response frames by `id`.
 * 5. Normalizes streaming events with idempotency and memory bounds.
 */
export class OmpRpcSession {
  private state: OmpSessionState = 'uninitialized';
  private child?: ChildProcess | undefined;
  private readonly parser = new OmpJsonlParser();
  private readonly pendingCommands = new Map<
    string,
    {
      resolve: (res: OmpRpcResponse) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private handshakePromise?: Promise<OmpRpcHandshake> | undefined;
  private handshakeResolve?: ((value: OmpRpcHandshake) => void) | undefined;
  private handshakeReject?: ((reason: Error) => void) | undefined;
  private idleTimer?: NodeJS.Timeout | undefined;
  private sessionId?: string | undefined;
  private eventCount = 0;
  private readonly seenEventIds = new Set<string>();

  readonly options: OmpRpcSessionOptions;

  constructor(options: OmpRpcSessionOptions) {
    this.options = options;
    this.sessionId = options.sessionId;
  }

  getState(): OmpSessionState {
    return this.state;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getEventCount(): number {
    return this.eventCount;
  }

  private setState(newState: OmpSessionState): void {
    this.state = newState;
    this.options.onStateChange?.(newState);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const timeout = this.options.idleTimeoutMs ?? 300_000; // 5 min idle default
    if (timeout > 0 && (this.state === 'ready' || this.state === 'idle')) {
      this.idleTimer = setTimeout(() => {
        void this.close();
      }, timeout);
      this.idleTimer.unref();
    }
  }

  /**
   * Starts the OMP process in RPC mode and awaits the `ready` handshake frame.
   */
  async start(): Promise<OmpRpcHandshake> {
    if (this.state !== 'uninitialized' && this.state !== 'closed') {
      throw new Error(`Cannot start OMP RPC session from state: ${this.state}`);
    }

    this.setState('starting');

    const isWin = process.platform === 'win32';
    const bin = this.options.binPath ?? 'omp';
    const args = ['--mode', 'rpc'];

    if (this.options.sessionId) {
      args.push('--session', this.options.sessionId);
      if (this.options.resume) {
        args.push('--resume');
      }
    } else {
      args.push('--no-session');
    }

    const isBatchScript = isWin && (bin.toLowerCase().endsWith('.cmd') || bin.toLowerCase().endsWith('.bat'));
    const spawnFile = isBatchScript ? (process.env.COMSPEC || 'cmd.exe') : bin;
    const spawnArgs = isBatchScript ? ['/d', '/s', '/c', bin, ...args] : args;

    this.handshakePromise = new Promise<OmpRpcHandshake>((resolve, reject) => {
      this.handshakeResolve = resolve;
      this.handshakeReject = reject;
    });

    const child = spawn(spawnFile, spawnArgs, {
      cwd: this.options.workspaceDir,
      env: this.options.env ?? process.env,
      detached: !isWin,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;
    this.setState('handshaking');

    const handshakeTimeoutMs = 15_000;
    const handshakeTimer = setTimeout(() => {
      if (this.state === 'handshaking' || this.state === 'starting') {
        const err = new Error(`OMP RPC handshake timed out after ${handshakeTimeoutMs}ms`);
        this.handshakeReject?.(err);
        this.kill();
      }
    }, handshakeTimeoutMs);
    handshakeTimer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      const records = this.parser.feed(chunk);
      for (const record of records) {
        if (!record.parsed) continue;
        this.handleMessage(record.parsed);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Stderr is logged or ignored; never treated as unauthenticated commands
      const line = chunk.toString('utf8').trim();
      if (line && line.length <= 1024) {
        // Safe truncated diagnostic
      }
    });

    child.once('error', (err) => {
      clearTimeout(handshakeTimer);
      this.setState('crashed');
      this.handshakeReject?.(new Error(`Failed to spawn OMP RPC process: ${err.message}`));
      this.rejectAllPending(err);
    });

    child.once('close', (code, signal) => {
      clearTimeout(handshakeTimer);
      if (this.idleTimer) clearTimeout(this.idleTimer);
      if (this.state !== 'closing' && this.state !== 'closed') {
        this.setState('crashed');
        const err = new Error(`OMP RPC process exited unexpectedly (code: ${code}, signal: ${signal})`);
        this.handshakeReject?.(err);
        this.rejectAllPending(err);
      } else {
        this.setState('closed');
      }
    });

    try {
      const handshake = await this.handshakePromise;
      clearTimeout(handshakeTimer);
      this.setState('ready');
      this.resetIdleTimer();
      return handshake;
    } catch (err) {
      clearTimeout(handshakeTimer);
      this.kill();
      throw err;
    }
  }

  /**
   * Processes parsed messages from stdout stream.
   */
  handleMessage(parsed: Record<string, unknown>): void {
    const type = String(parsed.type ?? '');

    // 1. Handshake frame: ready
    if (type === 'ready') {
      const handshake: OmpRpcHandshake = {
        type: 'ready',
        protocolVersion: Number(parsed.protocolVersion ?? 1),
        supportedProtocolVersions: Array.isArray(parsed.supportedProtocolVersions)
          ? parsed.supportedProtocolVersions.map(Number)
          : [1],
        maxFrameBytes: Number(parsed.maxFrameBytes ?? 1_048_576),
        maxReassembledFrameBytes: Number(parsed.maxReassembledFrameBytes ?? 67_108_864),
      };
      this.handshakeResolve?.(handshake);
      return;
    }

    // 2. RPC response correlation: response
    if (type === 'response') {
      const id = String(parsed.id ?? '');
      const pending = this.pendingCommands.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(id);
        const resp: OmpRpcResponse = {
          id,
          type: 'response',
          command: String(parsed.command ?? ''),
          success: Boolean(parsed.success),
          data: typeof parsed.data === 'object' && parsed.data !== null ? (parsed.data as Record<string, unknown>) : undefined,
          error: typeof parsed.error === 'string' ? parsed.error : undefined,
        };

        // Capture session ID if returned in response data
        if (resp.data && typeof resp.data['sessionId'] === 'string') {
          this.sessionId = resp.data['sessionId'];
        }

        if (this.state === 'busy') {
          this.setState('idle');
          this.resetIdleTimer();
        }

        pending.resolve(resp);
      }
      return;
    }

    // 3. Informational initial frames (ignore safely)
    if (type === 'available_commands_update' || type === 'extension_ui_request') {
      return;
    }

    // 4. Session identity frame
    if (type === 'session' && typeof parsed.sessionId === 'string') {
      this.sessionId = parsed.sessionId;
      return;
    }

    // 5. Normalizable runtime events: map through parseOmpLine with deduplication
    const rawLine = JSON.stringify(parsed);
    const normalized = parseOmpLine(rawLine);
    if (normalized) {
      if (this.eventCount < MAX_EVENTS_PER_RUN && !this.seenEventIds.has(normalized.id)) {
        this.seenEventIds.add(normalized.id);
        this.eventCount += 1;
        this.options.onEvent?.(normalized);
      }
    }
  }

  /**
   * Sends an arbitrary RPC command frame over stdin and awaits the correlated response.
   */
  async sendCommand(cmd: OmpRpcCommand): Promise<OmpRpcResponse> {
    if (this.state !== 'ready' && this.state !== 'idle' && this.state !== 'busy') {
      throw new Error(`Cannot send command in state '${this.state}'`);
    }

    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('OMP RPC stdin pipe is not available');
    }

    if (cmd.type === 'prompt') {
      this.setState('busy');
    }

    if (this.idleTimer) clearTimeout(this.idleTimer);

    const timeoutMs = this.options.commandTimeoutMs ?? 60_000;

    return new Promise<OmpRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(cmd.id);
        reject(new Error(`Command '${cmd.type}' (id: ${cmd.id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();

      this.pendingCommands.set(cmd.id, { resolve, reject, timer });

      const payload = JSON.stringify(cmd) + '\n';
      this.child!.stdin!.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingCommands.delete(cmd.id);
          reject(new Error(`Failed to write command to OMP stdin: ${err.message}`));
        }
      });
    });
  }

  /**
   * Sends a user prompt to initiate or continue an agent turn.
   */
  async prompt(promptText: string): Promise<OmpRpcResponse> {
    const id = randomUUID();
    return this.sendCommand({ id, type: 'prompt', prompt: promptText });
  }

  /**
   * Injects mid-turn guidance or steering message.
   */
  async steer(message: string): Promise<OmpRpcResponse> {
    const id = randomUUID();
    return this.sendCommand({ id, type: 'steer', message });
  }

  /**
   * Queues a subsequent message to be processed after the active turn.
   */
  async followUp(message: string): Promise<OmpRpcResponse> {
    const id = randomUUID();
    return this.sendCommand({ id, type: 'follow_up', message });
  }

  /**
   * Aborts active generation immediately via RPC command.
   */
  async abort(): Promise<OmpRpcResponse> {
    const id = randomUUID();
    return this.sendCommand({ id, type: 'abort' });
  }

  /**
   * Queries agent state (active model, thinking level, streaming status).
   */
  async getStateDetails(): Promise<OmpRpcResponse> {
    const id = randomUUID();
    return this.sendCommand({ id, type: 'get_state' });
  }

  /**
   * Clears pending queued steering and follow-up messages.
   */
  async clearQueue(): Promise<OmpRpcResponse> {
    const id = randomUUID();
    return this.sendCommand({ id, type: 'clear_queue' });
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingCommands.delete(id);
    }
  }

  /**
   * Graceful termination of the session.
   */
  async close(): Promise<void> {
    if (this.state === 'closed' || this.state === 'closing') return;

    this.setState('closing');
    if (this.idleTimer) clearTimeout(this.idleTimer);

    // If active turn in progress, attempt abort first
    if (this.state === 'busy') {
      try {
        await Promise.race([
          this.abort(),
          new Promise<void>((_, r) => setTimeout(() => r(new Error('abort timeout')), 1500)),
        ]);
      } catch {
        // Fallback to force kill if abort does not answer
      }
    }

    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }

    const gracefulExit = new Promise<void>((resolve) => {
      if (!this.child || this.child.exitCode !== null) return resolve();
      this.child.once('close', () => resolve());
    });

    let timeoutKillTimer: NodeJS.Timeout | undefined;
    const timeoutKill = new Promise<void>((resolve) => {
      timeoutKillTimer = setTimeout(() => {
        this.kill();
        resolve();
      }, 2000);
      timeoutKillTimer.unref();
    });

    await Promise.race([gracefulExit, timeoutKill]);
    if (timeoutKillTimer) clearTimeout(timeoutKillTimer);
    this.kill();
    this.setState('closed');
  }

  /**
   * Force termination of the process group.
   */
  kill(): void {
    if (!this.child) return;
    const pid = this.child.pid;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          try {
            spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          } catch {
            /* ignore if taskkill fails or process already exited */
          }
          try {
            this.child.kill();
          } catch {
            /* ignore if already dead */
          }
        } else {
          process.kill(-pid, 'SIGKILL');
        }
      } catch {
        // Process may already be dead
      }
    }
    try {
      this.child.stdin?.destroy();
      this.child.stdout?.destroy();
      this.child.stderr?.destroy();
    } catch {
      /* ignore stream destruction error */
    }
    this.setState('closed');
  }
}
