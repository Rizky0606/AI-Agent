/* eslint no-empty: ["error", { "allowEmptyCatch": true }] */
import { prepareWorkspace } from './workspace-manager.ts';
import { OmpRpcSession } from './omp-rpc-adapter.ts';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

type RuntimeId = 'omp' | 'hermes';
type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RuntimeEventType = 'text' | 'tool_start' | 'tool_end' | 'file_edit' | 'plan' | 'subagent' | 'error' | 'completed';

export interface NormalizedRuntimeEvent {
  id: string;
  type: RuntimeEventType;
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

export interface RunRequest {
  runtimeId: RuntimeId;
  taskId: string;
  prompt: string;
  workspaceId: string;
  sessionId?: string | undefined;
  resume?: boolean | undefined;
  timeoutMs?: number | undefined;
  environment?: Record<string, string> | undefined;
  mode?: 'rpc' | 'oneshot' | undefined;
}

export interface RunRecord {
  id: string;
  request: Omit<RunRequest, 'prompt'>;
  status: RunStatus;
  output: string;
  truncated: boolean;
  events: NormalizedRuntimeEvent[];
  exitCode?: number | undefined;
  durationMs?: number | undefined;
  error?: string | undefined;
}

type RunBody = Partial<Record<keyof RunRequest, unknown>>;
type ActiveRun = {
  record: RunRecord;
  child?: ChildProcess | undefined;
  rpcSession?: OmpRpcSession | undefined;
  cancelRequested: boolean;
  eventListeners: Set<(event: NormalizedRuntimeEvent) => void>;
};

const PORT = Number(process.env.RUNTIME_BRIDGE_PORT ?? 9120);
const BIND = process.env.RUNTIME_BRIDGE_BIND ?? '172.20.0.1';
const TOKEN_FILE = process.env.RUNTIME_BRIDGE_TOKEN_FILE ?? '/etc/personal-ai-os/runtime-bridge.token';
const WORKSPACE_ROOT = resolve(process.env.RUNTIME_WORKSPACE_ROOT ?? '/srv/aios/workspaces');
const AUDIT_FILE = process.env.RUNTIME_AUDIT_FILE ?? '/var/log/personal-ai-os/runtime-bridge.audit.jsonl';
export const MAX_OUTPUT = Number(process.env.RUNTIME_MAX_OUTPUT_BYTES ?? 1_048_576);
export const MAX_LINE_BUFFER_BYTES = Number(process.env.RUNTIME_MAX_LINE_BYTES ?? 131_072);
export const MAX_EVENTS_PER_RUN = Number(process.env.RUNTIME_MAX_EVENTS ?? 1_000);
const DEFAULT_TIMEOUT = Number(process.env.RUNTIME_TIMEOUT_MS ?? 300_000);
const MAX_TIMEOUT = Number(process.env.RUNTIME_MAX_TIMEOUT_MS ?? 900_000);
const RUN_TTL = Number(process.env.RUNTIME_RUN_TTL_MS ?? 3_600_000);
const MAX_QUEUE = Number(process.env.RUNTIME_MAX_QUEUE ?? 32);
const MAX_CONCURRENCY = Number(process.env.RUNTIME_MAX_CONCURRENCY ?? 2);
const RATE_LIMIT = Number(process.env.RUNTIME_RATE_LIMIT ?? 30);

export const TOKEN_REGEX = /^[A-Za-z0-9._~+/-]{32,512}$/;

const prompts = new Map<string, string>();
const queue: RunRecord[] = [];
const requestTimes: number[] = [];
const runs = new Map<string, RunRecord>();
const finishedAt = new Map<string, number>();
const activeRuns = new Map<string, ActiveRun>();
let tokenCache: Buffer | undefined;

function json(res: ServerResponse, code: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function audit(event: string, record: RunRecord, extra?: Record<string, unknown>): void {
  const safeExtra: Record<string, unknown> = {};
  if (extra && typeof extra === 'object') {
    const BLOCKED_AUDIT_KEYS = /^(prompt|output|token|environment|secret|authorization|key|password)/i;
    for (const [k, v] of Object.entries(extra)) {
      if (!BLOCKED_AUDIT_KEYS.test(k)) {
        safeExtra[k] = v;
      }
    }
  }

  void appendFile(
    AUDIT_FILE,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      runId: record.id,
      taskId: record.request.taskId,
      runtimeId: record.request.runtimeId,
      status: record.status,
      durationMs: record.durationMs,
      exitCode: record.exitCode,
      truncated: record.truncated,
      eventCount: record.events.length,
      ...safeExtra,
    })}\n`,
  ).catch((error: unknown) =>
    console.error(
      JSON.stringify({
        service: 'runtime-bridge',
        event: 'audit_write_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      }),
    ),
  );
}

async function loadToken(): Promise<Buffer> {
  if (!tokenCache) {
    const metadata = await stat(TOKEN_FILE);
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('bridge token permissions must be 0600');
    }
    const value = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (!TOKEN_REGEX.test(value)) {
      throw new Error('bridge token is missing, too short, or has invalid format');
    }
    tokenCache = Buffer.from(value);
  }
  return tokenCache;
}

export function authorized(req: IncomingMessage, expected: Buffer): boolean {
  const value = req.headers.authorization ?? '';
  if (!value.startsWith('Bearer ')) return false;
  const tokenStr = value.slice(7).trim();
  if (!TOKEN_REGEX.test(tokenStr)) return false;
  const got = Buffer.from(tokenStr);
  const left = createHash('sha256').update(got).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 32_768) throw new Error('body too large');
  }
  return JSON.parse(text || '{}') as unknown;
}

function parseRun(value: unknown): RunRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const x = value as RunBody;
  if (
    (x.runtimeId !== 'omp' && x.runtimeId !== 'hermes') ||
    typeof x.taskId !== 'string' ||
    !x.taskId ||
    x.taskId.length > 256 ||
    typeof x.prompt !== 'string' ||
    !x.prompt ||
    Buffer.byteLength(x.prompt) > 131_072 ||
    typeof x.workspaceId !== 'string' ||
    !x.workspaceId ||
    x.workspaceId.length > 256
  ) {
    return undefined;
  }
  const request: RunRequest = {
    runtimeId: x.runtimeId,
    taskId: x.taskId,
    prompt: x.prompt,
    workspaceId: x.workspaceId,
  };
  if (typeof x.sessionId === 'string' && x.sessionId.trim().length > 0 && x.sessionId.length <= 256) {
    request.sessionId = x.sessionId.trim();
  }
  if (x.resume === true) {
    request.resume = true;
  }
  if (typeof x.timeoutMs === 'number' && Number.isFinite(x.timeoutMs) && x.timeoutMs > 0) {
    request.timeoutMs = x.timeoutMs;
  }
  if (x.environment && typeof x.environment === 'object') {
    request.environment = x.environment as Record<string, string>;
  }
  if (x.mode === 'rpc' || x.mode === 'oneshot') {
    request.mode = x.mode;
  }
  return request;
}

function command(request: RunRequest): { file: string; args: string[] } {
  if (request.runtimeId === 'omp') {
    const args = ['-p', request.prompt, '--mode', 'json'];
    if (request.sessionId) {
      args.push('--session', request.sessionId);
      if (request.resume) {
        args.push('--resume');
      }
    } else {
      args.push('--no-session');
    }
    return { file: 'omp', args };
  }
  return { file: 'hermes', args: ['-z', request.prompt, '--no-restore-cwd', '--safe-mode'] };
}

function boundedAppend(state: { output: string; truncated: boolean }, chunk: Buffer): void {
  const used = Buffer.byteLength(state.output);
  if (used >= MAX_OUTPUT) {
    state.truncated = true;
    return;
  }
  const room = MAX_OUTPUT - used;
  let end = Math.min(room, chunk.length);
  while (end > 0 && end < chunk.length && (chunk[end]! & 0xc0) === 0x80) end--;
  const part = chunk.subarray(0, end);
  state.output += part.toString('utf8');
  if (end < chunk.length) state.truncated = true;
}

function trimRuns(): void {
  const cutoff = Date.now() - RUN_TTL;
  for (const [id, timestamp] of finishedAt) {
    if (timestamp < cutoff) {
      finishedAt.delete(id);
      prompts.delete(id);
      runs.delete(id);
    }
  }
}

export function parseOmpLine(line: string): NormalizedRuntimeEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return undefined;
  if (trimmed.length > MAX_LINE_BUFFER_BYTES) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(parsed.type ?? '');
    const timestamp = new Date().toISOString();
    const id = randomUUID();

    if (type === 'message_update' || type === 'message_end' || type === 'turn_end') {
      const content = parsed.content;
      let text = '';
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text') {
            text += String((item as Record<string, unknown>).text ?? '');
          }
        }
      } else if (typeof parsed.text === 'string') {
        text = parsed.text;
      }
      if (text) {
        const boundedText = text.length > 65_536 ? text.slice(0, 65_536) : text;
        return { id, type: 'text', timestamp, data: { text: boundedText }, raw: parsed };
      }
    } else if (type === 'tool_start') {
      const toolName = String(parsed.tool ?? parsed.name ?? 'tool').slice(0, 128);
      if (toolName === 'task') {
        const inputObj = typeof parsed.input === 'object' && parsed.input !== null ? (parsed.input as Record<string, unknown>) : {};
        const subTask = typeof inputObj['task'] === 'string'
          ? inputObj['task'].slice(0, 1024)
          : typeof inputObj['prompt'] === 'string'
            ? inputObj['prompt'].slice(0, 1024)
            : 'Tugas sub-agent paralel';
        return {
          id,
          type: 'subagent',
          timestamp,
          data: {
            toolName: 'task',
            input: parsed.input ?? parsed.args,
            isSubagent: true,
            subagentTask: subTask,
          },
          raw: parsed,
        };
      }
      if (toolName === 'todo' || toolName === 'plan') {
        const inputObj = typeof parsed.input === 'object' && parsed.input !== null ? (parsed.input as Record<string, unknown>) : {};
        const rawTodos = inputObj['todos'] ?? inputObj['items'] ?? inputObj['plan'];
        const planItems = Array.isArray(rawTodos) ? rawTodos.slice(0, 100).map((s) => String(s).slice(0, 512)) : undefined;
        return {
          id,
          type: 'plan',
          timestamp,
          data: {
            toolName,
            input: parsed.input ?? parsed.args,
            planItems,
          },
          raw: parsed,
        };
      }
      return {
        id,
        type: 'tool_start',
        timestamp,
        data: {
          toolName,
          input: parsed.input ?? parsed.args,
        },
        raw: parsed,
      };
    } else if (type === 'tool_end') {
      const toolName = String(parsed.tool ?? parsed.name ?? 'tool').slice(0, 128);
      if (toolName === 'task') {
        return {
          id,
          type: 'subagent',
          timestamp,
          data: {
            toolName: 'task',
            output: parsed.output ?? parsed.result,
            isSubagent: true,
          },
          raw: parsed,
        };
      }
      if (toolName === 'todo' || toolName === 'plan') {
        const outputObj = typeof parsed.output === 'object' && parsed.output !== null ? (parsed.output as Record<string, unknown>) : {};
        const rawTodos = outputObj['todos'] ?? outputObj['items'] ?? outputObj['plan'];
        const planItems = Array.isArray(rawTodos) ? rawTodos.slice(0, 100).map((s) => String(s).slice(0, 512)) : undefined;
        return {
          id,
          type: 'plan',
          timestamp,
          data: {
            toolName,
            output: parsed.output ?? parsed.result,
            planItems,
          },
          raw: parsed,
        };
      }
      return {
        id,
        type: 'tool_end',
        timestamp,
        data: {
          toolName,
          output: parsed.output ?? parsed.result,
        },
        raw: parsed,
      };
    } else if (type === 'plan') {
      const rawTodos = (parsed as Record<string, unknown>)['todos'] ?? (parsed as Record<string, unknown>)['items'] ?? (parsed as Record<string, unknown>)['plan'];
      const planItems = Array.isArray(rawTodos) ? rawTodos.slice(0, 100).map((s) => String(s).slice(0, 512)) : undefined;
      return {
        id,
        type: 'plan',
        timestamp,
        data: {
          toolName: 'plan',
          planItems,
          text: typeof parsed.text === 'string' ? parsed.text.slice(0, 65_536) : undefined,
        },
        raw: parsed,
      };
    } else if (type === 'file_edit' || type === 'patch' || type === 'diff') {
      const diffVal = typeof parsed.diff === 'string' ? parsed.diff : typeof parsed.patch === 'string' ? parsed.patch : undefined;
      const boundedDiff = diffVal && diffVal.length > 65_536 ? diffVal.slice(0, 65_536) : diffVal;
      return {
        id,
        type: 'file_edit',
        timestamp,
        data: {
          path: typeof parsed.path === 'string' ? parsed.path.slice(0, 1024) : undefined,
          diff: boundedDiff,
        },
        raw: parsed,
      };
    } else if (type === 'error') {
      return {
        id,
        type: 'error',
        timestamp,
        data: {
          error: String(parsed.error ?? parsed.message ?? 'Unknown runtime error').slice(0, 4096),
        },
        raw: parsed,
      };
    }
  } catch {
    // Unparsed or plain text line
  }
  return undefined;
}

const ALLOWED_EXTRA_KEYS = new Set([
  'NODE_ENV',
  'CI',
  'TERM',
  'DEBUG',
  'LANG',
  'SAFE_PROJECT_NAME',
]);
const ALLOWED_EXTRA_PREFIXES = ['SAFE_', 'PROJECT_', 'TASK_', 'APP_'];
const FORBIDDEN_ENV_REGEX = /^(NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_|BUN_|PERL|PYTHON|RUBY|GIT_|SSH_|AWS_|DOCKER_|PATH|HOME|USERPROFILE|COMSPEC|SHELL|PROMPT)/i;
const SECRET_ENV_REGEX = /(secret|token|key|password|database|ninerouter|auth|fcm|cred)/i;

export function cleanEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':';
  const defaultPath = process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/local/bin:/usr/bin:/bin';
  const env: NodeJS.ProcessEnv = {
    PATH: `${process.env.RUNTIME_BIN_DIR ?? '/home/ubuntu/.local/bin'}${sep}${defaultPath}`,
    HOME: process.env.HOME ?? (process.platform === 'win32' ? (process.env.USERPROFILE ?? 'C:\\') : '/home/ubuntu'),
    LANG: 'C.UTF-8',
    OMP_NO_UPDATE_CHECK: '1',
    SYSTEMROOT: process.env.SYSTEMROOT,
    COMSPEC: process.env.COMSPEC,
    PATHEXT: process.env.PATHEXT,
  };

  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v !== 'string') continue;
      if (v.includes('\0') || v.includes('\n') || v.includes('\r')) continue;
      if (FORBIDDEN_ENV_REGEX.test(k) || SECRET_ENV_REGEX.test(k)) continue;

      const isAllowed = ALLOWED_EXTRA_KEYS.has(k) || ALLOWED_EXTRA_PREFIXES.some((prefix) => k.startsWith(prefix));
      if (isAllowed) {
        env[k] = v;
      }
    }
  }
  return env;
}

function killProcess(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
      child.kill();
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    // Process may have already exited
  }
}

function pump(): void {
  while (activeRuns.size < MAX_CONCURRENCY && queue.length > 0) {
    const record = queue.shift()!;
    void execute(record)
      .catch((error) => {
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : 'runtime failed';
        record.durationMs = 0;
        finishedAt.set(record.id, Date.now());
        audit('run_failed', record);
      })
      .finally(() => {
        pump();
      });
  }
}

async function executeOmpRpc(record: RunRecord, cwd: string, prompt: string): Promise<void> {
  const started = Date.now();
  let session: OmpRpcSession | undefined;
  let current: ActiveRun | undefined;

  try {
    session = new OmpRpcSession({
      workspaceDir: cwd,
      sessionId: record.request.sessionId,
      resume: record.request.resume,
      env: cleanEnv(record.request.environment),
      commandTimeoutMs: record.request.timeoutMs ?? DEFAULT_TIMEOUT,
      onEvent: (event) => {
        record.events.push(event);
        if (current) {
          for (const listener of current.eventListeners) {
            listener(event);
          }
        }
      },
    });

    current = {
      record,
      rpcSession: session,
      cancelRequested: false,
      eventListeners: new Set(),
    };
    activeRuns.set(record.id, current);
    record.status = 'running';
    audit('run_started', record);

    await session.start();
    if (session.getSessionId()) {
      record.request.sessionId = session.getSessionId();
    }

    if (current.cancelRequested) {
      record.status = 'cancelled';
      await session.close();
      return;
    }

    const response = await session.prompt(prompt);
    record.durationMs = Date.now() - started;
    if (session.getSessionId()) {
      record.request.sessionId = session.getSessionId();
    }

    if (current.cancelRequested) {
      record.status = 'cancelled';
    } else if (!response.success) {
      record.status = 'failed';
      record.error = response.error ?? 'OMP RPC prompt returned failure';
    } else {
      record.status = 'completed';
      record.output = typeof response.data === 'object' ? JSON.stringify(response.data) : String(response.data ?? 'completed');
    }
  } catch (err) {
    record.durationMs = Date.now() - started;
    if (current?.cancelRequested) {
      record.status = 'cancelled';
    } else {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : 'OMP RPC execution error';
    }
  } finally {
    if (session) {
      await session.close().catch(() => {});
    }
    prompts.delete(record.id);
    finishedAt.set(record.id, Date.now());
    audit(`run_${record.status}`, record);
    activeRuns.delete(record.id);
  }
}

async function execute(record: RunRecord): Promise<void> {
  const started = Date.now();
  let current: ActiveRun | undefined;
  try {
    const cwd = await prepareWorkspace(WORKSPACE_ROOT, record.request.workspaceId, record.request.taskId);
    if (record.status === 'cancelled') {
      return;
    }
    const prompt = prompts.get(record.id) ?? '';

    if (record.request.mode === 'rpc' && record.request.runtimeId === 'omp') {
      await executeOmpRpc(record, cwd, prompt);
      return;
    }

    const fullRequest: RunRequest = { ...record.request, prompt };
    const spec = command(fullRequest);
    const isWin = process.platform === 'win32';
    const spawnFile = isWin ? (process.env.COMSPEC || 'cmd.exe') : spec.file;
    const spawnArgs = isWin ? ['/d', '/s', '/c', spec.file, ...spec.args] : spec.args;
    const child = spawn(spawnFile, spawnArgs, {
      cwd,
      env: cleanEnv(record.request.environment),
      detached: !isWin,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    current = { record, child, cancelRequested: false, eventListeners: new Set() };
    activeRuns.set(record.id, current);
    record.status = 'running';
    audit('run_started', record);

    const state = { output: '', truncated: false };
    let lineBuffer = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      boundedAppend(state, chunk);

      // Guard against unbounded lineBuffer when output lacks newlines
      if (lineBuffer.length + chunk.length > MAX_LINE_BUFFER_BYTES && !chunk.includes(0x0a)) {
        state.truncated = true;
        lineBuffer = ''; // Flush oversized non-newline line
      } else {
        lineBuffer += chunk.toString('utf8');
        let newlineIdx: number;
        while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, newlineIdx);
          lineBuffer = lineBuffer.slice(newlineIdx + 1);

          if (line.length > MAX_LINE_BUFFER_BYTES) {
            state.truncated = true;
            continue;
          }

          const parsedEvent = parseOmpLine(line);
          if (parsedEvent) {
            if (record.events.length < MAX_EVENTS_PER_RUN) {
              record.events.push(parsedEvent);
              for (const listener of current!.eventListeners) {
                listener(parsedEvent);
              }
            } else {
              record.truncated = true;
            }
          }
        }

        if (lineBuffer.length > MAX_LINE_BUFFER_BYTES) {
          state.truncated = true;
          lineBuffer = lineBuffer.slice(-MAX_LINE_BUFFER_BYTES);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => boundedAppend(state, chunk));

    const timeout = setTimeout(() => {
      record.error = 'runtime timeout';
      killProcess(child);
    }, Math.min(Math.max(record.request.timeoutMs ?? DEFAULT_TIMEOUT, 1), MAX_TIMEOUT));

    const { promise, resolve: finish } = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
    child.once('close', (code, signal) => finish({ code, signal }));
    child.once('error', (err) => {
      record.error = `spawn failed: ${err.message}`;
      finish({ code: 1, signal: null });
    });

    try {
      const result = await promise;
      // Process any remaining tail in lineBuffer
      if (lineBuffer.trim().length > 0 && lineBuffer.length <= MAX_LINE_BUFFER_BYTES) {
        const parsedEvent = parseOmpLine(lineBuffer);
        if (parsedEvent && record.events.length < MAX_EVENTS_PER_RUN) {
          record.events.push(parsedEvent);
          for (const listener of current.eventListeners) {
            listener(parsedEvent);
          }
        }
      }
      record.output = state.output;
      record.truncated = state.truncated;
      record.exitCode = result.code ?? undefined;
      record.durationMs = Date.now() - started;
      if (current.cancelRequested) record.status = 'cancelled';
      else if (record.error) record.status = 'failed';
      else if (result.code === 0) record.status = 'completed';
      else {
        record.status = 'failed';
        record.error = `runtime exited ${result.code ?? result.signal ?? 'unknown'}`;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    record.status = current?.cancelRequested ? 'cancelled' : 'failed';
    record.error = error instanceof Error ? error.message : 'runtime failed';
    record.durationMs = Date.now() - started;
  } finally {
    prompts.delete(record.id);
    finishedAt.set(record.id, Date.now());
    audit(`run_${record.status}`, record);
    activeRuns.delete(record.id);
  }
}

function rateLimited(): boolean {
  const now = Date.now();
  while (requestTimes[0] !== undefined && requestTimes[0] < now - 60_000) requestTimes.shift();
  if (requestTimes.length >= RATE_LIMIT) return true;
  requestTimes.push(now);
  return false;
}

function sse(res: ServerResponse, record: RunRecord): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  let lastEventIndex = 0;
  let timer: NodeJS.Timeout | undefined;
  const send = (): void => {
    while (lastEventIndex < record.events.length) {
      const evt = record.events[lastEventIndex++];
      res.write(`event: runtime_event\ndata: ${JSON.stringify(evt)}\n\n`);
    }
    res.write(`event: status\ndata: ${JSON.stringify(record)}\n\n`);
    if (record.status !== 'queued' && record.status !== 'running') {
      if (timer) clearInterval(timer);
      res.end();
    }
  };
  send();
  if (record.status === 'queued' || record.status === 'running') {
    timer = setInterval(send, 100);
    res.on('close', () => {
      if (timer) clearInterval(timer);
    });
  }
}

async function main(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let expected: Buffer;
  try {
    expected = await loadToken();
  } catch {
    json(res, 503, { error: 'bridge token unavailable' });
    return;
  }
  if (!authorized(req, expected)) {
    // Record rate limiting against unauthorized brute-force attempts
    rateLimited();
    json(res, 401, { error: 'unauthorized' });
    return;
  }
  trimRuns();
  // Safe URI pathname extraction independent of host header
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  try {
    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, {
        status: 'ok',
        active: activeRuns.size > 0,
        activeCount: activeRuns.size,
        maxConcurrency: MAX_CONCURRENCY,
        queued: queue.length,
        runtimes: ['omp', 'hermes'],
      });
    }
    if (req.method === 'GET' && pathname === '/v1/runtimes') {
      return json(res, 200, {
        runtimes: [
          { id: 'omp', available: true, version: '18.6.1' },
          { id: 'hermes', available: true, version: '0.20.5' },
        ],
      });
    }
    if (req.method === 'GET' && pathname === '/v1/runtimes/hermes/skills') {
      return json(res, 200, {
        skills: [
          {
            name: 'telegram_messenger',
            description: 'Kirim notifikasi dan terima pesan interaktif melalui bot Telegram',
            source: 'hermes',
            isReadOnly: true,
            parameters: { target: 'string', message: 'string' },
          },
          {
            name: 'web_search',
            description: 'Pencarian web publik dan pengumpulan kutipan informasi',
            source: 'hermes',
            isReadOnly: true,
            parameters: { query: 'string' },
          },
          {
            name: 'browser_automation',
            description: 'Otomasi navigasi web dan ekstraksi data halaman',
            source: 'hermes',
            isReadOnly: true,
            parameters: { url: 'string', action: 'string' },
          },
          {
            name: 'memory_recall',
            description: 'Pencarian catatan riwayat percakapan dan preferensi pengguna',
            source: 'hermes',
            isReadOnly: true,
            parameters: { key: 'string' },
          },
          {
            name: 'script_runner',
            description: 'Eksekusi skrip otomasi Python/Bash dalam lingkungan terkontrol',
            source: 'hermes',
            isReadOnly: true,
            parameters: { script: 'string', language: 'string' },
          },
        ],
      });
    }
    if (req.method === 'POST' && pathname === '/v1/runs') {
      if (rateLimited()) return json(res, 429, { error: 'rate limit exceeded' });
      if (queue.length + activeRuns.size >= MAX_QUEUE) return json(res, 429, { error: 'queue full' });
      const parsed = parseRun(await body(req));
      if (!parsed) return json(res, 400, { error: 'invalid run' });
      await prepareWorkspace(WORKSPACE_ROOT, parsed.workspaceId, parsed.taskId);
      const request: Omit<RunRequest, 'prompt'> = {
        runtimeId: parsed.runtimeId,
        taskId: parsed.taskId,
        workspaceId: parsed.workspaceId,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
        ...(parsed.resume ? { resume: true } : {}),
        ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
        ...(parsed.environment ? { environment: parsed.environment } : {}),
        ...(parsed.mode ? { mode: parsed.mode } : {}),
      };
      const record: RunRecord = {
        id: randomUUID(),
        request,
        status: 'queued',
        output: '',
        truncated: false,
        events: [],
      };
      prompts.set(record.id, parsed.prompt);
      runs.set(record.id, record);
      queue.push(record);
      audit('run_queued', record);
      pump();
      return json(res, 202, { runId: record.id });
    }
    const match = pathname.match(/^\/v1\/runs\/([^/]+)(\/cancel|\/events|\/steer)?$/);
    const id = match?.[1];
    const record = id ? runs.get(id) : undefined;
    if (!record) return json(res, 404, { error: 'not found' });
    const active = id ? activeRuns.get(id) : undefined;
    if (match?.[2] === '/events' && req.method === 'GET') return sse(res, record);
    if (!match?.[2] && req.method === 'GET') return json(res, 200, record);
    if (match?.[2] === '/steer' && req.method === 'POST') {
      if (!active || !active.rpcSession) {
        return json(res, 400, { error: 'run is not active in RPC mode' });
      }
      const payload = (await body(req)) as { message?: unknown };
      if (typeof payload?.message !== 'string' || !payload.message.trim()) {
        return json(res, 400, { error: 'invalid steer message' });
      }
      try {
        const steerRes = await active.rpcSession.steer(payload.message.trim());
        return json(res, 202, { success: steerRes.success, status: 'steered' });
      } catch (err) {
        return json(res, 500, { error: err instanceof Error ? err.message : 'steer failed' });
      }
    }
    if (match?.[2] === '/cancel' && req.method === 'POST') {
      if (record.status === 'cancelled' || record.status === 'completed' || record.status === 'failed') {
        return json(res, 202, record);
      }
      record.status = 'cancelled';
      finishedAt.set(record.id, Date.now());
      prompts.delete(record.id);
      const index = queue.findIndex((item) => item.id === record.id);
      if (index >= 0) queue.splice(index, 1);
      if (active) {
        active.cancelRequested = true;
        if (active.rpcSession) {
          void active.rpcSession.abort().catch(() => {});
          void active.rpcSession.close().catch(() => {});
        }
        if (active.child) {
          killProcess(active.child);
        }
      }
      audit('run_cancelled', record);
      return json(res, 202, record);
    }
    return json(res, 404, { error: 'not found' });
  } catch (error: unknown) {
    json(res, 400, { error: error instanceof Error ? error.message : 'bad request' });
  }
}

export const server = createServer((req, res) => void main(req, res));
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  server.listen(PORT, BIND, () => console.log(`runtime-bridge listening ${BIND}:${PORT}`));
}
