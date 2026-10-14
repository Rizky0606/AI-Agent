import { spawn, type ChildProcess } from 'node:child_process';
import { CapabilityRegistry } from './capability-registry.ts';
import { assertCommandAllowed } from './command-allowlist.ts';
import { PathValidator, SecurityError } from './path-validator.ts';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  type CommandExecutionOptions,
  type CommandExecutionResult,
  type ICommandExecutor,
} from './types.ts';

export {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  type CommandExecutionOptions,
  type CommandExecutionResult,
  type ICommandExecutor,
};

export class CommandExecutor implements ICommandExecutor {
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly pathValidator: PathValidator;
  private activeProcesses: Map<string, ChildProcess> = new Map();

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
    const capability = options.capability ?? 'powershell';
    const action = options.action ?? 'exec';

    // 1. Validate capability is enabled locally
    this.capabilityRegistry.assertCapabilityAllowed(capability, action, options.cwd);

    // 2. Validate the command text only invokes programs on the local allowlist
    assertCommandAllowed(commandText, this.capabilityRegistry.getAllowedCommands(capability));

    // 3. Validate CWD is within allowlist (and free from traversal)
    const validatedCwd = this.pathValidator.assertPathAllowed(options.cwd);

    // 4. Setup timeouts and caps
    const rawTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(1_000, rawTimeout), MAX_TIMEOUT_MS);
    const maxBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;

    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let truncated = false;
    let killedByTimeout = false;
    let killedByAbort = false;

    return new Promise<CommandExecutionResult>((resolve, reject) => {
      // Check abort signal before starting
      if (options.signal?.aborted) {
        return reject(
          new SecurityError('EXECUTION_ABORTED', 'Command was cancelled before execution started'),
        );
      }

      // Spawn powershell with least privilege (-NoProfile -NonInteractive)
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', commandText],
        {
          cwd: validatedCwd,
          env: {
            ...process.env,
            ...(options.env ?? {}),
          },
          windowsHide: true,
        },
      );

      const procId = executionId ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.activeProcesses.set(procId, child);

      let timeoutTimer: NodeJS.Timeout | null = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGTERM');
        // Force kill after 1 second if still alive
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 1_000);
      }, timeoutMs);

      // Handle abort signal
      const onAbort = () => {
        killedByAbort = true;
        child.kill('SIGKILL');
      };
      if (options.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const str = chunk.toString('utf-8');
        if (stdoutBuffer.length + str.length > maxBytes) {
          const remaining = maxBytes - stdoutBuffer.length;
          if (remaining > 0) {
            stdoutBuffer += str.slice(0, remaining);
          }
          truncated = true;
        } else {
          stdoutBuffer += str;
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const str = chunk.toString('utf-8');
        if (stderrBuffer.length + str.length > maxBytes) {
          const remaining = maxBytes - stderrBuffer.length;
          if (remaining > 0) {
            stderrBuffer += str.slice(0, remaining);
          }
          truncated = true;
        } else {
          stderrBuffer += str;
        }
      });

      child.on('error', (err) => {
        cleanup();
        reject(new SecurityError('PROCESS_SPAWN_ERROR', err.message));
      });

      child.on('close', (code) => {
        cleanup();
        const durationMs = Date.now() - startTime;

        if (killedByTimeout) {
          return reject(
            new SecurityError(
              'EXECUTION_TIMEOUT',
              `Execution timed out after ${timeoutMs}ms and was terminated`,
            ),
          );
        }

        if (killedByAbort) {
          return reject(
            new SecurityError('EXECUTION_ABORTED', 'Execution was cancelled by user request'),
          );
        }

        resolve({
          exitCode: code ?? (killedByAbort ? -1 : 0),
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          truncated,
          durationMs,
          killedByTimeout,
          killedByAbort,
        });
      });

      const cleanup = () => {
        this.activeProcesses.delete(procId);
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };
    });
  }

  cancelExecution(executionId: string): boolean {
    const child = this.activeProcesses.get(executionId);
    if (child) {
      child.kill('SIGKILL');
      this.activeProcesses.delete(executionId);
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const [id, child] of this.activeProcesses.entries()) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.activeProcesses.delete(id);
    }
  }

  getActiveExecutionCount(): number {
    return this.activeProcesses.size;
  }
}
