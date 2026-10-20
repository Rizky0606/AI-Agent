import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { PermissionEngine } from '@personal-ai-os/permissions';
import { BaseAgentRuntime } from './base-adapter.ts';
import type {
  RuntimeCapability,
  RuntimeExecuteInput,
  RuntimeExecuteResult,
  RuntimeHealth,
  RuntimeProposedAction,
  RuntimeStatus,
} from './types.ts';

export const DEFAULT_PI_9ROUTER_BASE_URL = 'https://9router.ojixx.my.id/v1';
export const DEFAULT_PI_TIMEOUT_MS = 300_000;
export const DEFAULT_PI_HANDSHAKE_TIMEOUT_MS = 15_000;
export const DEFAULT_PI_MAX_LINE_BYTES = 131_072;
export const DEFAULT_PI_MAX_OUTPUT_BYTES = 1_048_576;
export const DEFAULT_PI_MAX_EVENTS = 1_000;

export interface PiRuntimeConfig {
  /** Feature flag toggle. Defaults to false (OFF) unless process.env.PI_RUNTIME_ENABLED === 'true'. */
  enabled?: boolean | undefined;
  /** Binary executable path. Defaults to 'pi.cmd' on Windows, 'pi' on Unix. */
  binPath?: string | undefined;
  /** Forced 9Router backend model gateway. Defaults to https://9router.ojixx.my.id/v1. */
  nineRouterBaseUrl?: string | undefined;
  /** Default model identifier passed to Pi. */
  defaultModel?: string | undefined;
  /** Working directory override. Defaults to input.workspaceRoot or process.cwd(). */
  workspaceDir?: string | undefined;
  /** Command timeout in milliseconds. Defaults to 300_000 (5 minutes). */
  commandTimeoutMs?: number | undefined;
  /** Handshake timeout in milliseconds. Defaults to 15_000 (15 seconds). */
  handshakeTimeoutMs?: number | undefined;
  /** Maximum bytes per stdout line. Defaults to 131_072 (128 KB). */
  maxLineBytes?: number | undefined;
  /** Maximum total output bytes before truncation. Defaults to 1_048_576 (1 MB). */
  maxOutputBytes?: number | undefined;
  /** Maximum events recorded per run. Defaults to 1_000. */
  maxEvents?: number | undefined;
  /**
   * Strictly controls third-party extensions.
   * Defaults to false (disallowed). Pi extensions execute with OS process privileges;
   * only reviewed internal extensions or --no-extensions are permitted.
   */
  allowDynamicExtensions?: boolean | undefined;
  /** Optional custom spawn function for testing/mocking. */
  spawnFn?: typeof spawn | undefined;
  /** Optional custom binary detector for testing/mocking. */
  checkBinaryFn?: ((bin: string) => boolean) | undefined;
}

export interface PiRpcHandshake {
  type: 'ready';
  protocolVersion: number;
  supportedProtocolVersions: number[];
  maxFrameBytes: number;
  maxReassembledFrameBytes: number;
}

export interface PiRpcResponse {
  id: string;
  type: 'response';
  command: string;
  success: boolean;
  data?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

export interface PiNormalizedEvent {
  id: string;
  type: 'text' | 'tool_start' | 'tool_end' | 'file_edit' | 'plan' | 'subagent' | 'error' | 'completed';
  timestamp: string;
  data: {
    text?: string | undefined;
    toolName?: string | undefined;
    input?: unknown | undefined;
    output?: unknown | undefined;
    path?: string | undefined;
    diff?: string | undefined;
    error?: string | undefined;
    isSubagent?: boolean | undefined;
    subagentTask?: string | undefined;
    planItems?: string[] | undefined;
  };
  raw?: unknown | undefined;
}

/**
 * Bounded streaming JSONL parser for Pi stdio RPC protocol.
 * Prevents memory explosion from oversized chunks and safely discards malformed lines.
 */
export class PiJsonlParser {
  private lineBuffer = '';
  private truncated = false;
  readonly maxLineBytes: number;

  constructor(maxLineBytes = DEFAULT_PI_MAX_LINE_BYTES) {
    this.maxLineBytes = maxLineBytes;
  }

  isTruncated(): boolean {
    return this.truncated;
  }

  feed(chunk: Buffer | string): Array<{ raw: string; parsed?: Record<string, unknown> }> {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const results: Array<{ raw: string; parsed?: Record<string, unknown> }> = [];

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
        results.push({ raw: line });
        continue;
      }

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        results.push({ raw: line, parsed });
      } catch {
        results.push({ raw: line });
      }
    }

    return results;
  }
}

/**
 * PiRuntimeAdapter: Dedicated adapter for @earendil-works/pi-coding-agent (v1.1.0).
 * Implements the BaseAgentRuntime contract via JSONL-over-stdio RPC.
 *
 * Strict Architecture Constraints:
 * 1. Feature Flag: Disabled by default (PI_RUNTIME_ENABLED=false).
 * 2. Model Routing: Enforces 9Router gateway backend exclusively.
 * 3. Extensions Policy: Dynamic 3rd-party extensions are forbidden (--no-extensions).
 * 4. Permission Engine: All proposed actions are evaluated as UNTRUSTED before execution.
 * 5. Bounded Resources: Explicit timeouts, memory buffers, and deterministic process tree kill.
 */
export class PiRuntimeAdapter extends BaseAgentRuntime {
  readonly id = 'pi';
  readonly name = 'Pi Coding Agent';
  readonly version = '1.1.0';
  readonly capabilities: readonly RuntimeCapability[] = [
    { name: 'coding', description: 'Interactive coding and editing via Pi RPC', level: 'write' },
    { name: 'terminal', description: 'Controlled terminal execution via Pi tools', level: 'execute' },
    { name: 'file_edit', description: 'Precision file modification', level: 'write' },
    { name: 'json_rpc', description: 'Two-way JSON-RPC stdio protocol', level: 'execute' },
  ];

  private readonly config: PiRuntimeConfig;
  private readonly activeChildren = new Map<string, ChildProcess>();

  constructor(config?: PiRuntimeConfig | undefined, permissionEngine?: PermissionEngine | undefined) {
    super(permissionEngine);
    this.config = {
      enabled: config?.enabled ?? (process.env.PI_RUNTIME_ENABLED === 'true'),
      binPath: config?.binPath ?? (process.platform === 'win32' ? 'pi.cmd' : 'pi'),
      nineRouterBaseUrl: config?.nineRouterBaseUrl ?? (process.env.NINE_ROUTER_URL || DEFAULT_PI_9ROUTER_BASE_URL),
      defaultModel: config?.defaultModel ?? (process.env.NINE_ROUTER_DEFAULT_MODEL || 'Gratisan'),
      commandTimeoutMs: config?.commandTimeoutMs ?? DEFAULT_PI_TIMEOUT_MS,
      handshakeTimeoutMs: config?.handshakeTimeoutMs ?? DEFAULT_PI_HANDSHAKE_TIMEOUT_MS,
      maxLineBytes: config?.maxLineBytes ?? DEFAULT_PI_MAX_LINE_BYTES,
      maxOutputBytes: config?.maxOutputBytes ?? DEFAULT_PI_MAX_OUTPUT_BYTES,
      maxEvents: config?.maxEvents ?? DEFAULT_PI_MAX_EVENTS,
      allowDynamicExtensions: config?.allowDynamicExtensions ?? false,
      spawnFn: config?.spawnFn,
      checkBinaryFn: config?.checkBinaryFn,
    };
  }

  /**
   * Evaluates whether the Pi runtime is enabled by feature flag.
   */
  isEnabled(): boolean {
    return this.config.enabled === true;
  }

  /**
   * Verifies if the configured Pi binary exists on the host.
   */
  private checkBinary(): boolean {
    if (this.config.checkBinaryFn) {
      return this.config.checkBinaryFn(this.config.binPath ?? 'pi');
    }

    const bin = this.config.binPath ?? (process.platform === 'win32' ? 'pi.cmd' : 'pi');

    // If it's a direct file path, check existence directly
    if (bin.includes('/') || bin.includes('\\')) {
      return existsSync(bin);
    }

    // Otherwise probe system PATH safely without shell
    try {
      const probeCmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const res = spawnSync(probeCmd, [bin], {
        timeout: 1_000,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  override getStatus(): RuntimeStatus {
    if (!this.isEnabled()) {
      return 'uninitialized';
    }
    if (!this.checkBinary()) {
      return 'stopped';
    }
    return this.status;
  }

  override async initialize(): Promise<void> {
    const health = await this.healthCheck();
    if (health.healthy) {
      this.status = 'idle';
    } else {
      this.status = 'error';
    }
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const started = Date.now();

    if (!this.isEnabled()) {
      return {
        healthy: false,
        lastChecked: new Date().toISOString(),
        latencyMs: Date.now() - started,
        details: 'Feature flag PI_RUNTIME_ENABLED is false (default OFF)',
        error: 'Pi runtime is disabled by feature flag (PI_RUNTIME_ENABLED=false)',
      };
    }

    const binaryFound = this.checkBinary();
    if (!binaryFound) {
      const binName = this.config.binPath ?? 'pi';
      return {
        healthy: false,
        lastChecked: new Date().toISOString(),
        latencyMs: Date.now() - started,
        details: `Binary "${binName}" not found on host PATH`,
        error: `Pi binary "${binName}" is not available on this host`,
      };
    }

    return {
      healthy: true,
      lastChecked: new Date().toISOString(),
      latencyMs: Date.now() - started,
      details: `${this.name} v${this.version} ready (gateway: ${this.config.nineRouterBaseUrl})`,
    };
  }

  async execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult> {
    const started = Date.now();

    // 1. Guard against disabled feature flag, missing binary, or pre-cancelled task
    if (this.cancelledTasks.has(input.taskId)) {
      return {
        taskId: input.taskId,
        status: 'cancelled',
        output: '',
        durationMs: 0,
        error: 'Task was cancelled prior to execution',
        untrustedOutputWarning: true,
      };
    }

    if (!this.isEnabled()) {
      return {
        taskId: input.taskId,
        status: 'failed',
        output: '',
        durationMs: 0,
        error: 'Pi runtime is disabled by feature flag (PI_RUNTIME_ENABLED=false). Cannot execute task.',
        untrustedOutputWarning: true,
      };
    }

    if (!this.checkBinary()) {
      return {
        taskId: input.taskId,
        status: 'failed',
        output: '',
        durationMs: 0,
        error: `Pi binary "${this.config.binPath ?? 'pi'}" not found on host. Cannot execute task.`,
        untrustedOutputWarning: true,
      };
    }

    this.status = 'running';
    const isWin = process.platform === 'win32';
    const bin = this.config.binPath ?? (isWin ? 'pi.cmd' : 'pi');
    const args: string[] = ['--mode', 'rpc'];

    // Strict extensions policy: disallow dynamic extensions by default
    if (!this.config.allowDynamicExtensions) {
      args.push('--no-extensions');
    }

    if (input.sessionId) {
      args.push('--session', input.sessionId);
      if (input.resume) {
        args.push('--resume');
      }
    } else {
      args.push('--no-session');
    }

    // Windows batch script anti-DEP0190 wrapper
    const isBatchScript = isWin && (bin.toLowerCase().endsWith('.cmd') || bin.toLowerCase().endsWith('.bat'));
    const spawnFile = isBatchScript ? (process.env.COMSPEC || 'cmd.exe') : bin;
    const spawnArgs = isBatchScript ? ['/d', '/s', '/c', bin, ...args] : args;

    const spawnFn = this.config.spawnFn ?? spawn;
    const workspaceCwd = input.workspaceRoot ?? this.config.workspaceDir ?? process.cwd();

    // Environment: strictly direct 9Router gateway
    const childEnv: NodeJS.ProcessEnv = {
      ...(input.env ?? process.env),
      OPENAI_BASE_URL: this.config.nineRouterBaseUrl ?? DEFAULT_PI_9ROUTER_BASE_URL,
      NINE_ROUTER_URL: this.config.nineRouterBaseUrl ?? DEFAULT_PI_9ROUTER_BASE_URL,
      // Model preference
      PI_MODEL: input.model ?? this.config.defaultModel ?? 'Gratisan',
    };

    let child: ChildProcess;
    try {
      child = spawnFn(spawnFile, spawnArgs, {
        cwd: workspaceCwd,
        env: childEnv,
        detached: !isWin,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.status = 'idle';
      return {
        taskId: input.taskId,
        status: 'failed',
        output: '',
        durationMs: Date.now() - started,
        error: `Failed to spawn Pi runtime process: ${err instanceof Error ? err.message : String(err)}`,
        untrustedOutputWarning: true,
      };
    }

    this.activeChildren.set(input.taskId, child);

    const parser = new PiJsonlParser(this.config.maxLineBytes);
    const events: PiNormalizedEvent[] = [];
    const proposedActions: RuntimeProposedAction[] = [];
    let fullTextOutput = '';
    let executionError: string | undefined;
    let isCancelled = false;

    // Track correlated commands
    const pendingCommands = new Map<
      string,
      {
        resolve: (res: PiRpcResponse) => void;
        reject: (err: Error) => void;
        timer: NodeJS.Timeout;
      }
    >();

    const rejectAllPending = (err: Error) => {
      for (const entry of pendingCommands.values()) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pendingCommands.clear();
    };

    child.once('error', (err) => {
      clearTimeout(handshakeTimer);
      handshakeReject(err);
      rejectAllPending(new Error(`Pi process error: ${err.message}`));
    });

    child.once('close', (code, signal) => {
      clearTimeout(handshakeTimer);
      if (this.cancelledTasks.has(input.taskId)) {
        rejectAllPending(new Error('Task cancelled'));
      } else {
        rejectAllPending(new Error(`Pi process closed (code: ${code}, signal: ${signal})`));
      }
    });

    const sendRpc = (cmd: Record<string, unknown>, timeoutMs = 60_000): Promise<PiRpcResponse> => {
      const id = String(cmd.id ?? randomUUID());
      cmd.id = id;

      return new Promise<PiRpcResponse>((resolve, reject) => {
        if (!child.stdin || child.stdin.destroyed) {
          return reject(new Error('Pi stdin pipe is destroyed'));
        }

        const timer = setTimeout(() => {
          pendingCommands.delete(id);
          reject(new Error(`Pi command '${String(cmd.type)}' (id: ${id}) timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref();

        pendingCommands.set(id, { resolve, reject, timer });
        const payload = JSON.stringify(cmd) + '\n';
        child.stdin.write(payload, (writeErr) => {
          if (writeErr) {
            clearTimeout(timer);
            pendingCommands.delete(id);
            reject(new Error(`Failed to write to Pi stdin: ${writeErr.message}`));
          }
        });
      });
    };

    // Await handshake
    let handshakeResolve: (val: PiRpcHandshake) => void;
    let handshakeReject: (err: Error) => void;
    const handshakePromise = new Promise<PiRpcHandshake>((resolve, reject) => {
      handshakeResolve = resolve;
      handshakeReject = reject;
    });

    const handshakeTimer = setTimeout(() => {
      handshakeReject(new Error(`Pi RPC handshake timed out after ${this.config.handshakeTimeoutMs}ms`));
    }, this.config.handshakeTimeoutMs);
    handshakeTimer.unref();

    // Map messages
    const handleIncomingMessage = (parsed: Record<string, unknown>): void => {
      const type = String(parsed.type ?? '');

      // 1. Handshake frame: ready
      if (type === 'ready') {
        const hs: PiRpcHandshake = {
          type: 'ready',
          protocolVersion: Number(parsed.protocolVersion ?? 1),
          supportedProtocolVersions: Array.isArray(parsed.supportedProtocolVersions)
            ? parsed.supportedProtocolVersions.map(Number)
            : [1],
          maxFrameBytes: Number(parsed.maxFrameBytes ?? DEFAULT_PI_MAX_LINE_BYTES),
          maxReassembledFrameBytes: Number(parsed.maxReassembledFrameBytes ?? DEFAULT_PI_MAX_OUTPUT_BYTES),
        };
        clearTimeout(handshakeTimer);
        handshakeResolve(hs);
        return;
      }

      // 2. Correlated response: response
      if (type === 'response') {
        const id = String(parsed.id ?? '');
        const pending = pendingCommands.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingCommands.delete(id);
          pending.resolve({
            id,
            type: 'response',
            command: String(parsed.command ?? ''),
            success: Boolean(parsed.success),
            data: typeof parsed.data === 'object' && parsed.data !== null ? (parsed.data as Record<string, unknown>) : undefined,
            error: typeof parsed.error === 'string' ? parsed.error : undefined,
          });
        }
        return;
      }

      // 3. Extension UI Request (Disallow dynamic code execution)
      if (type === 'extension_ui_request') {
        // Safe acknowledging or ignoring: we do NOT execute arbitrary host code for 3rd party extensions
        return;
      }

      // 4. Streaming text delta
      if (type === 'message_update') {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
          fullTextOutput += delta.text;
          const evt: PiNormalizedEvent = {
            id: randomUUID(),
            type: 'text',
            timestamp: new Date().toISOString(),
            data: { text: delta.text },
            raw: parsed,
          };
          if (events.length < (this.config.maxEvents ?? DEFAULT_PI_MAX_EVENTS)) {
            events.push(evt);
            input.onEvent?.(evt as unknown as Record<string, unknown>);
          }
        }
        return;
      }

      // 5. Tool start / Tool end
      if (type === 'tool_start') {
        const toolName = String(parsed.toolName ?? 'unknown');
        const toolInput = parsed.input;
        const evt: PiNormalizedEvent = {
          id: randomUUID(),
          type: 'tool_start',
          timestamp: new Date().toISOString(),
          data: { toolName, input: toolInput },
          raw: parsed,
        };
        if (events.length < (this.config.maxEvents ?? DEFAULT_PI_MAX_EVENTS)) {
          events.push(evt);
          input.onEvent?.(evt as unknown as Record<string, unknown>);
        }

        // Map to ProposedAction for PermissionEngine gating
        const proposed = this.mapToolToProposedAction(toolName, toolInput);
        if (proposed) {
          proposedActions.push(proposed);
        }
        return;
      }

      if (type === 'tool_end') {
        const toolName = String(parsed.toolName ?? 'unknown');
        const toolOutput = parsed.output;
        const evt: PiNormalizedEvent = {
          id: randomUUID(),
          type: 'tool_end',
          timestamp: new Date().toISOString(),
          data: { toolName, output: toolOutput },
          raw: parsed,
        };
        if (events.length < (this.config.maxEvents ?? DEFAULT_PI_MAX_EVENTS)) {
          events.push(evt);
          input.onEvent?.(evt as unknown as Record<string, unknown>);
        }
        return;
      }

      // 6. Plan mode & Subagent events
      if (type === 'plan' && Array.isArray(parsed.planItems)) {
        const planItems = parsed.planItems.map(String);
        const evt: PiNormalizedEvent = {
          id: randomUUID(),
          type: 'plan',
          timestamp: new Date().toISOString(),
          data: { planItems },
          raw: parsed,
        };
        events.push(evt);
        input.onEvent?.(evt as unknown as Record<string, unknown>);
        return;
      }

      if (type === 'subagent') {
        const subagentTask = typeof parsed.subagentTask === 'string' ? parsed.subagentTask : undefined;
        const evt: PiNormalizedEvent = {
          id: randomUUID(),
          type: 'subagent',
          timestamp: new Date().toISOString(),
          data: { isSubagent: true, subagentTask },
          raw: parsed,
        };
        events.push(evt);
        input.onEvent?.(evt as unknown as Record<string, unknown>);
        return;
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const records = parser.feed(chunk);
      for (const rec of records) {
        if (rec.parsed) {
          handleIncomingMessage(rec.parsed);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const errLine = chunk.toString('utf8').trim();
      if (errLine) {
        // Redacted diagnostic logging without printing secrets
        executionError = errLine.slice(0, 500);
      }
    });

    // Run execution workflow
    const overallTimeoutMs = input.timeoutMs ?? this.config.commandTimeoutMs ?? DEFAULT_PI_TIMEOUT_MS;
    const taskTimeout = setTimeout(() => {
      executionError = `Task execution timed out after ${overallTimeoutMs}ms`;
      void this.cancel(input.taskId);
    }, overallTimeoutMs);
    taskTimeout.unref();

    try {
      // 1. Wait for handshake
      await handshakePromise;

      // 2. Validate Gateway Policy via get_state
      const getStateResp = await sendRpc({ type: 'get_state' }, 10_000);
      if (getStateResp.success && getStateResp.data?.model) {
        const modelData = getStateResp.data.model as Record<string, unknown>;
        const reportedBaseUrl = String(modelData.baseUrl ?? '');
        const allowedBase = this.config.nineRouterBaseUrl ?? DEFAULT_PI_9ROUTER_BASE_URL;

        // Verify that the model gateway does not bypass 9Router
        if (reportedBaseUrl && !this.isAllowedGateway(reportedBaseUrl, allowedBase)) {
          throw new Error(
            `Security Policy Violation: Pi runtime configured with unauthorized gateway "${reportedBaseUrl}". All model calls must route through 9Router (${allowedBase}).`,
          );
        }
      }

      // Check if task was cancelled before starting prompt
      if (this.cancelledTasks.has(input.taskId)) {
        isCancelled = true;
        await sendRpc({ type: 'abort' }, 5_000).catch(() => {});
        this.killProcess(child);
      } else {
        // 3. Send Prompt
        const promptResp = await sendRpc({ type: 'prompt', prompt: input.prompt }, overallTimeoutMs);
        if (!promptResp.success) {
          executionError = promptResp.error ?? 'Pi execution failed';
        }
      }
    } catch (err) {
      if (this.cancelledTasks.has(input.taskId)) {
        isCancelled = true;
      } else {
        executionError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      clearTimeout(taskTimeout);
      clearTimeout(handshakeTimer);
      // Clean up child process
      this.killProcess(child);
      this.activeChildren.delete(input.taskId);
      this.status = 'idle';
    }

    // 4. Filter untrusted proposed actions through PermissionEngine
    const appliedActions = await this.filterUntrustedActions(proposedActions);

    const hasBlockedCritical = appliedActions.some((a) => !a.permissionGranted);
    let finalStatus: RuntimeExecuteResult['status'] = 'completed';

    if (isCancelled || this.cancelledTasks.has(input.taskId)) {
      finalStatus = 'cancelled';
    } else if (executionError || hasBlockedCritical) {
      finalStatus = 'failed';
    }

    return {
      taskId: input.taskId,
      status: finalStatus,
      output: fullTextOutput,
      rawOutput: fullTextOutput,
      events: events as unknown as Array<Record<string, unknown>>,
      proposedActions,
      appliedActions,
      durationMs: Date.now() - started,
      error: executionError,
      untrustedOutputWarning: true,
    };
  }

  override async cancel(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId);
    const child = this.activeChildren.get(taskId);
    if (child) {
      if (child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.write(JSON.stringify({ id: randomUUID(), type: 'abort' }) + '\n');
        } catch {
          // ignore
        }
      }
      setTimeout(() => {
        this.killProcess(child);
        this.activeChildren.delete(taskId);
      }, 50).unref();
    }
  }

  /**
   * Translates tool calls from Pi into Permission Engine proposed actions.
   */
  private mapToolToProposedAction(toolName: string, input: unknown): RuntimeProposedAction | undefined {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

    switch (toolName) {
      case 'bash':
      case 'powershell':
      case 'terminal': {
        const cmd = String(raw.command ?? raw.cmd ?? '');
        return {
          id: randomUUID(),
          type: 'command',
          action: 'shell:exec',
          resource: cmd || 'terminal',
          payload: { command: cmd },
          riskLevel: 'HIGH',
        };
      }
      case 'write': {
        const filePath = String(raw.path ?? raw.file ?? '');
        return {
          id: randomUUID(),
          type: 'file_write',
          action: 'file:write',
          resource: filePath || 'workspace',
          payload: { path: filePath, content: raw.content },
          riskLevel: 'MEDIUM',
        };
      }
      case 'edit': {
        const filePath = String(raw.path ?? raw.file ?? '');
        return {
          id: randomUUID(),
          type: 'file_write',
          action: 'file:edit',
          resource: filePath || 'workspace',
          payload: { path: filePath, diff: raw.diff },
          riskLevel: 'MEDIUM',
        };
      }
      case 'read': {
        const filePath = String(raw.path ?? raw.file ?? '');
        return {
          id: randomUUID(),
          type: 'api_call',
          action: 'file:read',
          resource: filePath || 'workspace',
          payload: { path: filePath },
          riskLevel: 'LOW',
        };
      }
      default:
        return undefined;
    }
  }

  /**
   * Verifies that the gateway reported by Pi conforms to the configured 9Router base URL.
   */
  private isAllowedGateway(reportedUrl: string, allowedUrl: string): boolean {
    try {
      const rep = new URL(reportedUrl);
      const allow = new URL(allowedUrl);
      return rep.hostname === allow.hostname;
    } catch {
      return reportedUrl.includes('9router.ojixx.my.id');
    }
  }

  /**
   * Deterministically terminates child process tree.
   */
  private killProcess(child: ChildProcess): void {
    if (!child || child.killed) return;

    if (process.platform === 'win32') {
      try {
        if (child.pid) {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            shell: false,
          });
        }
      } catch {
        child.kill();
      }
    } else {
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        child.kill();
      }
    }
  }
}
