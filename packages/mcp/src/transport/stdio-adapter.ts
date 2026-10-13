import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { type McpServerAdapter, type McpToolDescriptor, McpError } from '../types.ts';

/** MCP revision this client speaks. Servers negotiate down if they only support an older one. */
const MCP_PROTOCOL_VERSION = '2024-11-05';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Boot + handshake gets its own budget because `npx`-style launchers can be slow to warm up. */
const DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_DIAGNOSTIC_CHARS = 2_000;

export interface StdioMcpServerOptions {
  /** Matches `McpServerConfig.id`; used for error attribution and diagnostics. */
  serverId: string;
  command: string;
  args?: readonly string[] | undefined;
  /** Extra environment entries layered on top of `process.env` for the child. */
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
  /**
   * Capability granted to every tool this server exposes. MCP has no capability
   * concept, so the operator declares it here and `McpHub` enforces it against
   * `McpServerConfig.allowedCapabilities`.
   */
  capability: string;
  requestTimeoutMs?: number | undefined;
  initializeTimeoutMs?: number | undefined;
  /** Receives child stderr and any non-JSON stdout, so server noise stays visible. */
  onDiagnostic?: ((line: string) => void) | undefined;
}

interface PendingRequest {
  method: string;
  timer: NodeJS.Timeout;
  detachAbort: () => void;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface JsonRpcMessage {
  id?: unknown;
  method?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * Speaks MCP over a child process using newline-delimited JSON-RPC on stdio.
 *
 * The child is spawned lazily on first use and reused for every subsequent call.
 * A failed handshake kills the child and clears the startup latch, so a later call
 * retries instead of inheriting a permanently rejected promise.
 */
export class StdioMcpServerAdapter implements McpServerAdapter {
  private readonly options: StdioMcpServerOptions;
  private readonly requestTimeoutMs: number;
  private readonly initializeTimeoutMs: number;

  private child: ChildProcessWithoutNullStreams | undefined;
  private startup: Promise<void> | undefined;
  private nextRequestId = 1;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private readonly pending = new Map<number, PendingRequest>();

  constructor(options: StdioMcpServerOptions) {
    this.options = options;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.ensureStarted();
    const result = await this.request('tools/list', {});
    const tools = (result as { tools?: unknown } | null)?.tools;
    if (!Array.isArray(tools)) return [];

    const descriptors: McpToolDescriptor[] = [];
    for (const entry of tools) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const name = record['name'];
      if (typeof name !== 'string' || name.length === 0) continue;

      const description = record['description'];
      const inputSchema = record['inputSchema'];
      const outputSchema = record['outputSchema'];

      descriptors.push({
        name,
        description: typeof description === 'string' ? description : '',
        capability: this.options.capability,
        ...(isPlainObject(inputSchema) ? { inputSchema } : {}),
        ...(isPlainObject(outputSchema) ? { outputSchema } : {}),
      });
    }
    return descriptors;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal | undefined,
  ): Promise<{ content: string; error?: string }> {
    await this.ensureStarted();
    const result = await this.request('tools/call', { name, arguments: args }, signal);
    const record = isPlainObject(result) ? result : {};
    const content = renderContent(record['content']);
    return record['isError'] === true ? { content, error: content } : { content };
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.startup = undefined;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.failPending(new McpError(`Server MCP '${this.options.serverId}' ditutup.`, this.options.serverId));
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      // Escalate only if the server ignores SIGTERM.
      const escalate = setTimeout(() => child.kill('SIGKILL'), DEFAULT_SHUTDOWN_TIMEOUT_MS);
      escalate.unref();
      child.once('close', () => {
        clearTimeout(escalate);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  private ensureStarted(): Promise<void> {
    if (!this.startup) {
      this.startup = this.start().catch((err: unknown) => {
        // Clear the latch so a transient spawn failure does not poison every later call.
        this.startup = undefined;
        throw err;
      });
    }
    return this.startup;
  }

  private async start(): Promise<void> {
    const child = spawn(this.options.command, [...(this.options.args ?? [])], {
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => this.consumeStderr(chunk));

    child.on('error', (err: Error) => {
      this.failPending(
        new McpError(
          `Server MCP '${this.options.serverId}' gagal dijalankan: ${err.message}`,
          this.options.serverId,
        ),
      );
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.child === child) this.child = undefined;
      this.failPending(
        new McpError(
          `Server MCP '${this.options.serverId}' berhenti (code=${String(code)}, signal=${String(signal)}).`,
          this.options.serverId,
        ),
      );
    });

    try {
      await this.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'personal-ai-os', version: '1.0.0' },
        },
        undefined,
        this.initializeTimeoutMs,
      );
      this.notify('notifications/initialized', {});
    } catch (err: unknown) {
      // A half-open child would keep stdin open and never answer, so take it down.
      this.child = undefined;
      child.kill('SIGKILL');
      throw err;
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal | undefined,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    const id = this.nextRequestId++;
    const serverId = this.options.serverId;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.takePending(id);
        reject(new McpError(`Permintaan MCP '${method}' ke '${serverId}' melewati batas ${timeoutMs} ms.`, serverId));
      }, timeoutMs);
      timer.unref();

      const onAbort = (): void => {
        if (!this.takePending(id)) return;
        this.notify('notifications/cancelled', { requestId: id, reason: 'client aborted' });
        reject(new McpError(`Permintaan MCP '${method}' ke '${serverId}' dibatalkan.`, serverId));
      };

      if (signal?.aborted) {
        clearTimeout(timer);
        reject(new McpError(`Permintaan MCP '${method}' ke '${serverId}' dibatalkan sebelum dikirim.`, serverId));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        method,
        timer,
        resolve,
        reject,
        detachAbort: () => signal?.removeEventListener('abort', onAbort),
      });

      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (err: unknown) {
        const entry = this.takePending(id);
        if (entry) entry.reject(err);
      }
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) return;
    try {
      this.write({ jsonrpc: '2.0', method, params });
    } catch {
      // Notifications are best-effort; a dead child is already reported elsewhere.
    }
  }

  private write(message: Record<string, unknown>): void {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new McpError(`Server MCP '${this.options.serverId}' tidak berjalan.`, this.options.serverId);
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Removes a pending entry and its timers/listeners. Returns it so the caller can settle it. */
  private takePending(id: number): PendingRequest | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.detachAbort();
    return entry;
  }

  private failPending(error: McpError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.detachAbort();
      entry.reject(error);
    }
    this.pending.clear();
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    let newlineIndex = this.stderrBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stderrBuffer.slice(0, newlineIndex).trim();
      this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
      if (line.length > 0) this.reportDiagnostic(line);
      newlineIndex = this.stderrBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // MCP reserves stdout for JSON-RPC. Surface violations instead of swallowing them.
      this.reportDiagnostic(`stdout non-JSON: ${line}`);
      return;
    }
    if (!isPlainObject(parsed)) return;

    const message = parsed as JsonRpcMessage;
    const { id, method } = message;

    // Server-initiated request or notification. Answer requests so the server does not
    // block waiting on a reply we will never send.
    if (typeof method === 'string') {
      if (id === undefined || id === null) {
        this.reportDiagnostic(`notifikasi server: ${method}`);
        return;
      }
      try {
        this.write({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Metode '${method}' tidak didukung klien.` },
        });
      } catch {
        // The child died mid-write; the close handler reports it.
      }
      return;
    }

    if (typeof id !== 'number') return;

    const error = message.error;
    if (isPlainObject(error)) {
      const detail = error['message'];
      this.takePending(id)?.reject(
        new McpError(
          `Server MCP '${this.options.serverId}' menolak permintaan: ${typeof detail === 'string' ? detail : JSON.stringify(error)}`,
          this.options.serverId,
        ),
      );
      return;
    }

    this.takePending(id)?.resolve(message.result);
  }

  private reportDiagnostic(line: string): void {
    const truncated =
      line.length > MAX_DIAGNOSTIC_CHARS ? `${line.slice(0, MAX_DIAGNOSTIC_CHARS)}…` : line;
    if (this.options.onDiagnostic) {
      this.options.onDiagnostic(truncated);
      return;
    }
    console.error(
      JSON.stringify({ service: 'mcp-stdio', serverId: this.options.serverId, line: truncated }),
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flattens an MCP `content` array into text. Non-text parts (images, embedded
 * resources) have no textual form, so they are replaced by a placeholder rather
 * than silently dropped.
 */
function renderContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const text = entry['text'];
    if (typeof text === 'string') {
      parts.push(text);
      continue;
    }
    const type = entry['type'];
    parts.push(`[${typeof type === 'string' ? type : 'unknown'} content omitted]`);
  }
  return parts.join('\n');
}
