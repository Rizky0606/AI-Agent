import type { RiskLevel } from '@personal-ai-os/permissions';

export interface RuntimeCapability {
  name: string; // e.g. 'coding', 'terminal', 'file_edit', 'json_rpc', 'git'
  description?: string | undefined;
  level?: 'read' | 'write' | 'execute' | undefined;
}

export type RuntimeStatus = 'uninitialized' | 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface RuntimeHealth {
  healthy: boolean;
  lastChecked: string;
  latencyMs?: number | undefined;
  details?: string | undefined;
  error?: string | undefined;
}

export interface RuntimeProposedAction {
  id: string;
  type: 'command' | 'file_write' | 'file_delete' | 'api_call';
  action: string;
  resource: string;
  payload?: unknown;
  riskLevel?: RiskLevel | undefined;
}

export interface RuntimeExecuteInput {
  taskId: string;
  prompt: string;
  workspaceRoot?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  env?: Record<string, string> | undefined;
  untrusted?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RuntimeExecuteResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'paused';
  output: string;
  rawOutput?: string | undefined;
  proposedActions?: RuntimeProposedAction[] | undefined;
  appliedActions?:
    | Array<{
        action: RuntimeProposedAction;
        permissionGranted: boolean;
        executed: boolean;
        result?: unknown;
      }>
    | undefined;
  exitCode?: number | undefined;
  durationMs: number;
  untrustedOutputWarning?: boolean | undefined;
  error?: string | undefined;
}

export interface AgentRuntime {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly RuntimeCapability[];
  getStatus(): RuntimeStatus;
  initialize(config?: Record<string, unknown> | undefined): Promise<void>;
  execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult>;
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  healthCheck(): Promise<RuntimeHealth>;
}
