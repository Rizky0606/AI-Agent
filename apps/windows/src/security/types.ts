import type { CapabilityName, CapabilityRegistry } from './capability-registry.ts';
import type { PathValidator } from './path-validator.ts';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB buffer limit

export interface CommandExecutionOptions {
  capability?: CapabilityName | undefined;
  action?: string | undefined;
  cwd: string;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  signal?: AbortSignal | undefined;
  env?: Record<string, string> | undefined;
}

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  killedByTimeout: boolean;
  killedByAbort: boolean;
}

export interface ICommandExecutor {
  getCapabilityRegistry(): CapabilityRegistry;
  getPathValidator(): PathValidator;
  executePowershell(
    commandText: string,
    options: CommandExecutionOptions,
    executionId?: string | undefined,
  ): Promise<CommandExecutionResult>;
  cancelExecution(executionId: string): void;
  cancelAll(): void;
}
