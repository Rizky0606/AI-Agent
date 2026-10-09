import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PermissionEngine } from '@personal-ai-os/permissions';
import { BaseAgentRuntime } from './base-adapter.ts';
import type { CommandRunner } from './omp-adapter.ts';
import type {
  RuntimeCapability,
  RuntimeExecuteInput,
  RuntimeExecuteResult,
  RuntimeHealth,
  RuntimeProposedAction,
} from './types.ts';

const execFileAsync = promisify(execFile);

export class PiRuntimeAdapter extends BaseAgentRuntime {
  readonly id = 'pi';
  readonly name = 'Pi Coding Agent';
  readonly version = '1.1.0';
  readonly capabilities: readonly RuntimeCapability[] = [
    { name: 'coding', description: 'Code editing and automated refactoring', level: 'write' },
    { name: 'terminal', description: 'Command execution', level: 'execute' },
    { name: 'file_edit', description: 'File inspection and patch manipulation', level: 'write' },
    { name: 'json_rpc', description: 'Structured JSON communication mode', level: 'read' },
  ];

  private readonly binaryPath: string;
  private readonly commandRunner: CommandRunner;

  constructor(
    options?:
      | {
          binaryPath?: string | undefined;
          commandRunner?: CommandRunner | undefined;
          permissionEngine?: PermissionEngine | undefined;
        }
      | undefined,
  ) {
    super(options?.permissionEngine);
    this.binaryPath = options?.binaryPath ?? 'pi';
    this.commandRunner =
      options?.commandRunner ??
      (async (cmd, args, opts) => {
        try {
          const { stdout, stderr } = await execFileAsync(cmd, args, {
            timeout: opts?.timeoutMs,
            env: { ...process.env, ...opts?.env },
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (err: unknown) {
          const error = err as {
            stdout?: string;
            stderr?: string;
            code?: number;
            message?: string;
          };
          return {
            stdout: error.stdout ?? '',
            stderr: error.stderr ?? error.message ?? String(err),
            exitCode: typeof error.code === 'number' ? error.code : 1,
          };
        }
      });
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const startTime = Date.now();
    try {
      const res = await this.commandRunner(this.binaryPath, ['--help'], { timeoutMs: 5000 });
      const latencyMs = Date.now() - startTime;
      if (res.exitCode === 0 || res.stdout.includes('pi') || res.stdout.includes('--mode')) {
        return {
          healthy: true,
          lastChecked: new Date().toISOString(),
          latencyMs,
          details: `Pi binary verified (${this.version})`,
        };
      }
      return {
        healthy: false,
        lastChecked: new Date().toISOString(),
        latencyMs,
        error: `Unexpected exit code ${res.exitCode}: ${res.stderr}`,
      };
    } catch (err) {
      return {
        healthy: false,
        lastChecked: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult> {
    const startTime = Date.now();
    if (this.cancelledTasks.has(input.taskId)) {
      return {
        taskId: input.taskId,
        status: 'cancelled',
        output: 'Task was cancelled before execution.',
        durationMs: 0,
      };
    }

    if (this.pausedTasks.has(input.taskId)) {
      return {
        taskId: input.taskId,
        status: 'paused',
        output: 'Task is currently paused.',
        durationMs: 0,
      };
    }

    this.status = 'running';

    try {
      // Non-interactive CLI invocation per assessment.md: pi -p "<prompt>" --mode json
      const args = ['-p', input.prompt, '--mode', 'json'];

      const res = await this.commandRunner(this.binaryPath, args, {
        timeoutMs: input.timeoutMs ?? 30000,
        env: input.env,
      });

      if (this.cancelledTasks.has(input.taskId)) {
        this.status = 'idle';
        return {
          taskId: input.taskId,
          status: 'cancelled',
          output: 'Task execution cancelled.',
          exitCode: res.exitCode,
          durationMs: Date.now() - startTime,
        };
      }

      let parsedOutput: Record<string, unknown> | undefined;
      const proposedActions: RuntimeProposedAction[] = [];

      try {
        parsedOutput = JSON.parse(res.stdout) as Record<string, unknown>;
        if (Array.isArray(parsedOutput['proposedActions'])) {
          for (const item of parsedOutput['proposedActions'] as unknown[]) {
            if (item && typeof item === 'object') {
              const obj = item as Record<string, unknown>;
              proposedActions.push({
                id: String(obj['id'] ?? `act-${proposedActions.length + 1}`),
                type: (obj['type'] as RuntimeProposedAction['type']) ?? 'command',
                action: String(obj['action'] ?? 'execute'),
                resource: String(obj['resource'] ?? 'workspace'),
                payload: obj['payload'],
                riskLevel: (obj['riskLevel'] as RuntimeProposedAction['riskLevel']) ?? 'MEDIUM',
              });
            }
          }
        }
      } catch {
        // Output was plain text or streamed logs
      }

      // Output from external runtime is ALWAYS treated as untrusted.
      const appliedActions = await this.filterUntrustedActions(proposedActions);

      const status = res.exitCode === 0 ? 'completed' : 'failed';
      this.status = 'idle';

      return {
        taskId: input.taskId,
        status,
        output:
          typeof parsedOutput?.['response'] === 'string' ? parsedOutput['response'] : res.stdout,
        rawOutput: res.stdout,
        proposedActions,
        appliedActions,
        exitCode: res.exitCode,
        durationMs: Date.now() - startTime,
        untrustedOutputWarning: true,
        error: res.exitCode !== 0 ? res.stderr : undefined,
      };
    } catch (err) {
      this.status = 'error';
      return {
        taskId: input.taskId,
        status: 'failed',
        output: '',
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
