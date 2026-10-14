import { invoke } from '@tauri-apps/api/core';
import type { CapabilityRegistry } from './capability-registry.ts';
import { assertCommandAllowed } from './command-allowlist.ts';
import type { PathValidator } from './path-validator.ts';
import type { CommandExecutionOptions, CommandExecutionResult, ICommandExecutor } from './types.ts';

export class TauriCommandExecutor implements ICommandExecutor {
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly pathValidator: PathValidator;

  constructor(capabilityRegistry: CapabilityRegistry, pathValidator: PathValidator) {
    this.capabilityRegistry = capabilityRegistry;
    this.pathValidator = pathValidator;
  }

  getCapabilityRegistry(): CapabilityRegistry {
    return this.capabilityRegistry;
  }

  getPathValidator(): PathValidator {
    return this.pathValidator;
  }

  async executePowershell(
    commandText: string,
    options: CommandExecutionOptions,
    executionId?: string | undefined,
  ): Promise<CommandExecutionResult> {
    void executionId;
    const capability = options.capability ?? 'powershell';
    const action = options.action ?? 'exec';

    // 1. Validate capability is enabled locally
    this.capabilityRegistry.assertCapabilityAllowed(capability, action, options.cwd);

    // 2. Validate the command text only invokes programs on the local allowlist
    assertCommandAllowed(commandText, this.capabilityRegistry.getAllowedCommands(capability));

    // 3. Validate CWD is within allowlist
    const validatedCwd = this.pathValidator.assertPathAllowed(options.cwd);

    // 4. Delegate execution to Rust backend via Tauri command
    try {
      const output = await invoke<{
        exit_code: number;
        stdout: string;
        stderr: string;
        truncated: boolean;
        duration_ms: number;
      }>('execute_local_command', {
        capability,
        command: commandText,
        cwd: validatedCwd,
        timeoutMs: options.timeoutMs ?? 30_000,
      });

      return {
        exitCode: output.exit_code,
        stdout: output.stdout,
        stderr: output.stderr,
        truncated: output.truncated,
        durationMs: output.duration_ms,
        killedByTimeout: false,
        killedByAbort: false,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        exitCode: -1,
        stdout: '',
        stderr: errMsg,
        truncated: false,
        durationMs: 0,
        killedByTimeout: errMsg.includes('timed out') || errMsg.includes('timeout'),
        killedByAbort: false,
      };
    }
  }

  cancelExecution(executionId: string): void {
    void executionId;
    // Handled in Rust runtime
  }

  cancelAll(): void {}
}
