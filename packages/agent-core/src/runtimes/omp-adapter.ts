import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import type { PermissionEngine } from '@personal-ai-os/permissions';
import { BaseAgentRuntime } from './base-adapter.ts';
import type {
  RuntimeCapability,
  RuntimeExecuteInput,
  RuntimeExecuteResult,
  RuntimeHealth,
  RuntimeProposedAction,
} from './types.ts';

function parseOmpJsonl(stdout: string): { text: string; events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  let text = stdout;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      events.push(event);
      if (event['type'] !== 'message_end') continue;
      const message = event['message'];
      if (!message || typeof message !== 'object') continue;
      const content = (message as Record<string, unknown>)['content'];
      if (!Array.isArray(content)) continue;
      const parts = content.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object')).map(part => part['text']).filter((part): part is string => typeof part === 'string');
      if (parts.length > 0) text = parts.join('');
    } catch { /* diagnostic lines are not JSON */ }
  }
  return { text, events };
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number | undefined; env?: Record<string, string> | undefined; cwd?: string | undefined },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export class OmpRuntimeAdapter extends BaseAgentRuntime {
  readonly id = 'omp';
  readonly name = 'Oh-My-Pi Coding Agent';
  readonly version = '18.6.1';
  readonly capabilities: readonly RuntimeCapability[] = [
    { name: 'coding', description: 'Code generation and repo repair', level: 'write' },
    { name: 'terminal', description: 'Non-interactive command execution', level: 'execute' },
    { name: 'file_edit', description: 'File inspection and patch creation', level: 'write' },
    { name: 'jsonl_events', description: 'Verified JSONL event output', level: 'read' },
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
    this.binaryPath = options?.binaryPath ?? 'omp';
    this.commandRunner =
      options?.commandRunner ??
      (async (cmd, args, opts) => {
        try {
          const { stdout, stderr } = await execFileAsync(cmd, args, {
            timeout: opts?.timeoutMs,
            cwd: opts?.cwd,
            env: {
              PATH: '/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin',
              HOME: '/home/ubuntu',
              LANG: 'C.UTF-8',
              OMP_NO_UPDATE_CHECK: '1',
            },
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
      if (res.exitCode === 0 || res.stdout.includes('omp') || res.stdout.includes('--mode')) {
        return {
          healthy: true,
          lastChecked: new Date().toISOString(),
          latencyMs,
          details: `OMP binary verified (${this.version})`,
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
      // Non-interactive CLI invocation per assessment.md: omp -p "<prompt>" --mode json [--max-time N]
      const args = ['-p', input.prompt, '--mode', 'json', '--no-session'];
      if (input.timeoutMs) {
        const seconds = Math.max(1, Math.floor(input.timeoutMs / 1000));
        args.push('--max-time', String(seconds));
      }

      const res = await this.commandRunner(this.binaryPath, args, {
        timeoutMs: input.timeoutMs ?? 30000,
        cwd: input.workspaceRoot,
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

      const parsed = parseOmpJsonl(res.stdout);
      const proposedActions: RuntimeProposedAction[] = [];
      for (const event of parsed.events) {
        const actions = event['proposedActions'];
        if (!Array.isArray(actions)) continue;
        for (const item of actions) {
          if (!item || typeof item !== 'object') continue;
          const obj = item as Record<string, unknown>;
          proposedActions.push({
            id: String(obj['id'] ?? `act-${proposedActions.length + 1}`),
            type: (obj['type'] as RuntimeProposedAction['type']) ?? 'command',
            action: String(obj['action'] ?? 'execute'),
            resource: String(obj['resource'] ?? 'workspace'),
            payload: obj['payload'],
            riskLevel: obj['riskLevel'] as RuntimeProposedAction['riskLevel'],
          });
        }
      }

      // Output from external runtime is ALWAYS treated as untrusted.
      // Proposed actions must pass through Permission Engine.
      const appliedActions = await this.filterUntrustedActions(proposedActions);

      const status = res.exitCode === 0 ? 'completed' : 'failed';
      this.status = 'idle';

      return {
        taskId: input.taskId,
        status,
        output: parsed.text,
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
