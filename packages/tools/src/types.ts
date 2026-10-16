import type { ActorContext, RiskLevel } from '@personal-ai-os/permissions';

export interface ToolExecutionContext {
  actor: ActorContext;
  traceId?: string | undefined;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  conversationId?: string | null | undefined;
  signal?: AbortSignal | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Arguments accepted by `ToolRegistry.executeTool`; shared with the internal limited path. */
export interface ToolExecutionOptions<TInput = unknown> {
  toolName: string;
  input: TInput;
  context: ToolExecutionContext;
  approvalId?: string | undefined;
  resource?: string | undefined;
}

export interface ToolHealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  message?: string | undefined;
  timestamp: string;
}

export type InputValidatorFn<TInput> = (
  input: unknown,
) => { valid: true; data: TInput } | { valid: false; error: string };

export type OutputValidatorFn<TOutput> = (
  output: unknown,
) => { valid: true; data: TOutput } | { valid: false; error: string };

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  capability: string;
  resourceScope: string;
  riskLevel: RiskLevel;
  action: string;
  timeoutMs: number;
  supportsCancellation: boolean;
  outputLimitBytes: number;
  inputValidator?: InputValidatorFn<TInput> | undefined;
  outputValidator?: OutputValidatorFn<TOutput> | undefined;
  healthCheck: () => Promise<ToolHealthCheckResult>;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

export interface ToolExecutionResult<TOutput = unknown> {
  toolName: string;
  status: 'success' | 'error';
  data?: TOutput | undefined;
  error?: string | undefined;
  truncated: boolean;
  outputSizeBytes: number;
  durationMs: number;
  traceId?: string | undefined;
}

export class ToolError extends Error {
  readonly toolName: string;

  constructor(message: string, toolName: string) {
    super(message);
    this.name = 'ToolError';
    this.toolName = toolName;
  }
}

export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super(`Tool '${toolName}' tidak ditemukan dalam registry.`, toolName);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolInputValidationError extends ToolError {
  constructor(toolName: string, reason: string) {
    super(`Validasi input gagal untuk tool '${toolName}': ${reason}`, toolName);
    this.name = 'ToolInputValidationError';
  }
}

export class ToolOutputValidationError extends ToolError {
  constructor(toolName: string, reason: string) {
    super(`Validasi output gagal untuk tool '${toolName}': ${reason}`, toolName);
    this.name = 'ToolOutputValidationError';
  }
}

export class ToolTimeoutError extends ToolError {
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`Eksekusi tool '${toolName}' melebihi batas waktu ${timeoutMs}ms.`, toolName);
    this.name = 'ToolTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ToolCancelledError extends ToolError {
  constructor(toolName: string) {
    super(`Eksekusi tool '${toolName}' dibatalkan oleh pengguna/sinyal pembatalan.`, toolName);
    this.name = 'ToolCancelledError';
  }
}
