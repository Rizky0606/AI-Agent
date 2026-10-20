import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, normalize, resolve, basename } from 'node:path';
import type { ToolDefinition } from '../types.ts';

export interface WorkspaceReadFileInput {
  path: string;
  maxLines?: number | undefined;
}

export interface WorkspaceReadFileOutput {
  path: string;
  content: string;
  lineCount: number;
  sizeBytes: number;
}

export function createWorkspaceReadFileTool(
  workspaceRoot: string,
): ToolDefinition<WorkspaceReadFileInput, WorkspaceReadFileOutput> {
  const rootDir = resolve(workspaceRoot);

  return {
    name: 'workspace_read_file',
    description: 'Membaca konten file teks di dalam direktori workspace yang diizinkan.',
    capability: 'filesystem:read',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'fs:read_file',
    timeoutMs: 10000,
    supportsCancellation: true,
    outputLimitBytes: 32768, // 32KB
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { path: string }.' };
      }
      const p = (input as Record<string, unknown>).path;
      if (typeof p !== 'string' || p.trim().length === 0) {
        return { valid: false, error: 'Atribut "path" harus berupa string non-kosong.' };
      }
      return { valid: true, data: input as WorkspaceReadFileInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: WorkspaceReadFileInput) => {
      // 1. Path traversal security check
      const normalized = normalize(input.path);
      const targetPath = isAbsolute(normalized)
        ? resolve(normalized)
        : resolve(rootDir, normalized);

      if (!targetPath.startsWith(rootDir)) {
        throw new Error(
          `Path traversal terdeteksi pada '${input.path}'. Akses di luar direktori workspace '${rootDir}' dilarang.`,
        );
      }

      // 2. Sensitive and credential file protection (Rule 10 & Sesi 6 requirement)
      const base = basename(targetPath).toLowerCase();
      if (
        base === '.env' ||
        base.startsWith('.env.') ||
        base.includes('secret') ||
        base.includes('credential') ||
        base.includes('id_rsa') ||
        base.includes('id_ed25519')
      ) {
        throw new Error(
          `Akses ke file sensitif/kredensial '${input.path}' dilarang demi keamanan host.`,
        );
      }

      // 2. Check file existence and type
      const fileStat = await stat(targetPath);
      if (!fileStat.isFile()) {
        throw new Error(`Target '${input.path}' bukan merupakan file biasa.`);
      }

      // 3. Read file content
      const rawText = await readFile(targetPath, 'utf-8');
      const lines = rawText.split('\n');

      let finalContent = rawText;
      if (input.maxLines && input.maxLines > 0 && lines.length > input.maxLines) {
        finalContent = lines.slice(0, input.maxLines).join('\n') + '\n[Truncated lines...]';
      }

      return {
        path: input.path,
        content: finalContent,
        lineCount: lines.length,
        sizeBytes: Buffer.byteLength(finalContent, 'utf-8'),
      };
    },
  };
}
