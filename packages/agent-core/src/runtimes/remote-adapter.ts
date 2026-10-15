import { BaseAgentRuntime } from './base-adapter.ts';
import type { RuntimeCapability, RuntimeExecuteInput, RuntimeExecuteResult, RuntimeHealth, RuntimeProposedAction } from './types.ts';

type BridgeRun = { runId: string };
type BridgeRecord = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  output?: string | undefined;
  exitCode?: number | undefined;
  durationMs?: number | undefined;
  error?: string | undefined;
  events?: Array<Record<string, unknown>> | undefined;
};


export class RemoteRuntimeAdapter extends BaseAgentRuntime {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly RuntimeCapability[] = [
    { name: 'coding', description: 'Host runtime coding', level: 'write' },
    { name: 'terminal', description: 'Host runtime execution', level: 'execute' },
  ];
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly taskRuns = new Map<string, string>();

  constructor(options: { id: string; name: string; version: string; baseUrl: string; token: string; fetcher?: typeof fetch }) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.version = options.version;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit, retries = 1): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
          ...init,
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...init?.headers },
        });
        if (!response.ok) throw new Error(`runtime bridge HTTP ${response.status}`);
        return await response.json() as T;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise<void>((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('runtime bridge request failed');
  }

  private parseActions(output: string, events?: Array<Record<string, unknown>>): RuntimeProposedAction[] {
    const actions: RuntimeProposedAction[] = [];
    for (const line of output.split('\n')) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        const candidate = value['proposedActions'];
        if (!Array.isArray(candidate)) continue;
        for (const item of candidate) {
          if (!item || typeof item !== 'object') continue;
          const action = item as Record<string, unknown>;
          actions.push({
            id: String(action['id'] ?? `action-${actions.length + 1}`),
            type: (action['type'] as RuntimeProposedAction['type']) ?? 'command',
            action: String(action['action'] ?? 'execute'),
            resource: String(action['resource'] ?? 'workspace'),
            payload: action['payload'],
            riskLevel: action['riskLevel'] as RuntimeProposedAction['riskLevel'],
          });
        }
      } catch { /* runtime logs are untrusted and may not be JSON */ }
    }
    if (Array.isArray(events)) {
      for (const evt of events) {
        if (evt.type === 'file_edit' && evt.data && typeof evt.data === 'object') {
          const d = evt.data as Record<string, unknown>;
          if (typeof d.path === 'string') {
            actions.push({
              id: String(evt.id ?? `action-${actions.length + 1}`),
              type: 'file_write',
              action: 'file_edit',
              resource: d.path,
              payload: { path: d.path, diff: d.diff },
              riskLevel: 'MEDIUM',
            });
          }
        }
      }
    }
    return actions;
  }

  override async initialize(): Promise<void> {
    const health = await this.healthCheck();
    this.status = health.healthy ? 'idle' : 'error';
  }

  async execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult> {
    const started = Date.now();
    this.status = 'running';
    try {
      const workspaceId = typeof input.metadata?.['workspaceId'] === 'string' ? input.metadata['workspaceId'] : input.taskId;
      const requestBody: Record<string, unknown> = {
        runtimeId: this.id,
        taskId: input.taskId,
        prompt: input.prompt,
        workspaceId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.resume ? { resume: true } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.env ? { environment: input.env } : {}),
      };
      const created = await this.request<BridgeRun>('/v1/runs', { method: 'POST', body: JSON.stringify(requestBody) });
      this.taskRuns.set(input.taskId, created.runId);
      let lastEventCount = 0;

      for (;;) {
        if (this.cancelledTasks.has(input.taskId)) await this.cancel(input.taskId);
        const record = await this.request<BridgeRecord>(`/v1/runs/${created.runId}`);
        if (Array.isArray(record.events) && input.onEvent) {
          while (lastEventCount < record.events.length) {
            const evt = record.events[lastEventCount++];
            if (evt) input.onEvent(evt);
          }
        }
        if (record.status === 'queued' || record.status === 'running') {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const output = record.output ?? '';
        const proposedActions = this.parseActions(output, record.events);
        const appliedActions = await this.filterUntrustedActions(proposedActions);
        this.status = 'idle';
        return {
          taskId: input.taskId,
          status: record.status,
          output,
          rawOutput: output,
          events: record.events,
          proposedActions,
          appliedActions,
          durationMs: record.durationMs ?? Date.now() - started,
          exitCode: record.exitCode,
          error: record.error,
          untrustedOutputWarning: true,
        };
      }
    } catch (error) {
      this.status = 'error';
      return { taskId: input.taskId, status: 'failed', output: '', durationMs: Date.now() - started, error: error instanceof Error ? error.message : 'remote runtime failed', untrustedOutputWarning: true };
    }
  }

  override async cancel(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId);
    const runId = this.taskRuns.get(taskId);
    if (runId) await this.request(`/v1/runs/${runId}/cancel`, { method: 'POST' }, 0);
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const started = Date.now();
    try { await this.request('/health', undefined, 0); return { healthy: true, lastChecked: new Date().toISOString(), latencyMs: Date.now() - started, details: `${this.name} bridge available` }; }
    catch (error) { return { healthy: false, lastChecked: new Date().toISOString(), latencyMs: Date.now() - started, error: error instanceof Error ? error.message : 'bridge unavailable' }; }
  }
}
