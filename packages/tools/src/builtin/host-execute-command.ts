import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../types.ts';

const execFileAsync = promisify(execFile);

export interface HostExecuteCommandInput {
  command: string;
  args?: string[] | undefined;
}

export interface HostExecuteCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function createHostExecuteCommandTool(): ToolDefinition<
  HostExecuteCommandInput,
  HostExecuteCommandOutput
> {
  return {
    name: 'host_execute_command',
    description: 'Menjalankan perintah berisiko tinggi pada host (Wajib persetujuan eksplisit pengguna).',
    capability: 'system:command',
    resourceScope: 'system',
    riskLevel: 'HIGH',
    action: 'deploy:trigger', // Triggers require_approval in DEFAULT_ACTION_RULES
    timeoutMs: 15_000,
    supportsCancellation: true,
    outputLimitBytes: 32_768, // 32 KB
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { command: string, args?: string[] }.' };
      }
      const rec = input as Record<string, unknown>;
      if (typeof rec.command !== 'string' || rec.command.trim().length === 0) {
        return { valid: false, error: 'Atribut "command" harus berupa string non-kosong.' };
      }
      if (rec.command.length > 256) {
        return { valid: false, error: 'Atribut "command" tidak boleh melebihi 256 karakter.' };
      }
      if (rec.args !== undefined) {
        if (!Array.isArray(rec.args)) {
          return { valid: false, error: 'Atribut "args" harus berupa array string.' };
        }
        if (rec.args.length > 20) {
          return { valid: false, error: 'Jumlah "args" tidak boleh melebihi 20 argumen.' };
        }
        for (const arg of rec.args) {
          if (typeof arg !== 'string' || arg.length > 256) {
            return { valid: false, error: 'Setiap argumen harus berupa string maksimal 256 karakter.' };
          }
        }
      }
      return {
        valid: true,
        data: {
          command: rec.command.trim(),
          args: Array.isArray(rec.args) ? (rec.args as string[]) : undefined,
        },
      };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: HostExecuteCommandInput) => {
      // Only executes if permission passed (which requires approval for HIGH risk)
      const { stdout, stderr } = await execFileAsync(input.command, input.args ?? [], {
        timeout: 10_000,
        windowsHide: true,
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
      };
    },
  };
}
