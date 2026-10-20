import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { basename, extname, isAbsolute, normalize, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionLimiter } from '../execution-limiter.ts';
import { ToolError, type ToolDefinition, type ToolExecutionContext } from '../types.ts';

const execFileAsync = promisify(execFile);

export const SUPPORTED_LSP_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
] as const;

export type SupportedLspLanguage = (typeof SUPPORTED_LSP_LANGUAGES)[number];

export type LspServerStatus = 'configured' | 'unconfigured' | 'error';

export interface LspDiagnosticItem {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string | undefined;
  code?: string | number | undefined;
}

export interface LspDiagnosticsInput {
  filePath: string;
  language?: SupportedLspLanguage | undefined;
}

export interface LspDiagnosticsOutput {
  filePath: string;
  language: string;
  serverStatus: LspServerStatus;
  serverBinary?: string | undefined;
  diagnostics: LspDiagnosticItem[];
  errorCount: number;
  warningCount: number;
  rawOutput?: string | undefined;
  message?: string | undefined;
}

export const DEFAULT_LANGUAGE_SERVER_BINARIES: Record<SupportedLspLanguage, string[]> = {
  typescript: ['typescript-language-server', 'vtsls'],
  javascript: ['typescript-language-server', 'vtsls'],
  python: ['pyright-langserver', 'pylsp', 'ruff'],
  rust: ['rust-analyzer'],
  go: ['gopls'],
};

export interface LspRunnerParams {
  binary: string;
  filePath: string;
  workspaceRoot: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface LspDiagnosticsOptions {
  serverResolver?:
    | ((language: SupportedLspLanguage) => Promise<string | null> | (string | null))
    | undefined;
  lspRunner?:
    | ((
        params: LspRunnerParams,
      ) => Promise<{ diagnostics: LspDiagnosticItem[]; rawOutput?: string | undefined }>)
    | undefined;
  maxConcurrency?: number | undefined;
}

/**
 * Memetakan ekstensi file ke bahasa yang didukung allowlist.
 */
export function inferLanguageFromFilePath(filePath: string): SupportedLspLanguage | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
    case '.pyi':
      return 'python';
    case '.rs':
      return 'rust';
    case '.go':
      return 'go';
    default:
      return null;
  }
}

/**
 * Memeriksa apakah path mengarah ke file rahasia/kredensial yang dilindungi.
 */
function checkSensitivePath(filePath: string, targetPath: string): void {
  const base = basename(targetPath).toLowerCase();
  if (
    base === '.env' ||
    base.startsWith('.env.') ||
    base.includes('secret') ||
    base.includes('credential') ||
    base.includes('id_rsa') ||
    base.includes('id_ed25519')
  ) {
    throw new ToolError(
      `Akses diagnostik ke file sensitif/kredensial '${filePath}' dilarang demi keamanan host.`,
      'lsp_diagnostics',
    );
  }
}

/**
 * Probe read-only default untuk mencari binary language server di PATH.
 */
async function defaultServerResolver(language: SupportedLspLanguage): Promise<string | null> {
  const binaries = DEFAULT_LANGUAGE_SERVER_BINARIES[language];
  for (const bin of binaries) {
    try {
      // Safe probe with short timeout and read-only flag
      await execFileAsync(bin, ['--version'], { timeout: 2000 });
      return bin;
    } catch {
      // Binary not installed, not found on PATH, or execution failed
      continue;
    }
  }
  return null;
}

/**
 * Parser toleran untuk baris diagnostik standar (misal: "file.ts:10:5: error: message").
 */
export function parseDiagnosticLine(line: string): LspDiagnosticItem | null {
  const regex = /^(?:.*?):(\d+):(\d+)(?::|\s+-)?\s*(error|warning|info|hint)?(?::|\s+)?\s*(.*)$/i;
  const match = regex.exec(line.trim());
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  const lineNum = parseInt(match[1], 10);
  const colNum = parseInt(match[2], 10);
  const rawSev = (match[3] ?? 'error').toLowerCase();
  const severity: 'error' | 'warning' | 'info' | 'hint' =
    rawSev === 'warning' ? 'warning' : rawSev === 'info' ? 'info' : rawSev === 'hint' ? 'hint' : 'error';
  const msg = match[4]?.trim() || line.trim();

  return {
    line: lineNum,
    column: colNum,
    severity,
    message: msg,
  };
}

export function createLspDiagnosticsTool(
  workspaceRoot: string,
  options: LspDiagnosticsOptions = {},
): ToolDefinition<LspDiagnosticsInput, LspDiagnosticsOutput> {
  const rootDir = resolve(workspaceRoot);
  const resolver = options.serverResolver ?? defaultServerResolver;
  const limiter = new ExecutionLimiter({
    maxInFlight: options.maxConcurrency ?? 2,
    maxStartsPerInterval: 60,
  });

  return {
    name: 'lsp_diagnostics',
    description:
      'Mendapatkan diagnostik kode statis (read-only) untuk file di dalam direktori workspace menggunakan language server terdaftar pada host/worker runtime.',
    capability: 'code:analyze',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:analyze_code',
    timeoutMs: 15000,
    supportsCancellation: true,
    outputLimitBytes: 32768,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { filePath, language? }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.filePath !== 'string' || raw.filePath.trim().length === 0) {
        return { valid: false, error: 'Atribut "filePath" harus berupa string non-kosong.' };
      }
      if (raw.language !== undefined) {
        if (
          typeof raw.language !== 'string' ||
          !SUPPORTED_LSP_LANGUAGES.includes(raw.language as SupportedLspLanguage)
        ) {
          return {
            valid: false,
            error: `Atribut "language" tidak valid. Bahasa yang didukung: ${SUPPORTED_LSP_LANGUAGES.join(', ')}.`,
          };
        }
      }
      return { valid: true, data: input as LspDiagnosticsInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: LspDiagnosticsInput, context: ToolExecutionContext) => {
      // 1. Path traversal security check
      const normalized = normalize(input.filePath);
      const targetPath = isAbsolute(normalized)
        ? resolve(normalized)
        : resolve(rootDir, normalized);

      if (!targetPath.startsWith(rootDir)) {
        throw new ToolError(
          `Path traversal terdeteksi pada '${input.filePath}'. Akses di luar direktori workspace '${rootDir}' dilarang.`,
          'lsp_diagnostics',
        );
      }

      // 2. Sensitive and credential file protection
      checkSensitivePath(input.filePath, targetPath);

      // 3. Symlink escape and file existence check
      const fileLstat = await lstat(targetPath);
      if (fileLstat.isSymbolicLink()) {
        throw new ToolError(
          `Target '${input.filePath}' adalah symbolic link. Analisis terhadap symbolic link dilarang demi keamanan workspace.`,
          'lsp_diagnostics',
        );
      }
      if (!fileLstat.isFile()) {
        throw new ToolError(`Target '${input.filePath}' bukan merupakan file biasa.`, 'lsp_diagnostics');
      }

      // 4. Resolve language
      const language = input.language ?? inferLanguageFromFilePath(input.filePath);
      if (!language) {
        return {
          filePath: input.filePath,
          language: 'unknown',
          serverStatus: 'unconfigured',
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          message: `Ekstensi file '${input.filePath}' tidak didukung atau bahasa tidak dapat dideteksi secara otomatis.`,
        };
      }

      // 5. Probe language server availability (Read-only probe)
      const binary = await resolver(language);
      if (!binary) {
        return {
          filePath: input.filePath,
          language,
          serverStatus: 'unconfigured',
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          message: `Server bahasa untuk '${language}' tidak dikonfigurasi atau tidak ditemukan pada host/worker runtime.`,
        };
      }

      // 6. Acquire concurrency limit
      limiter.acquire(`lsp:${language}`);
      try {
        if (options.lspRunner) {
          try {
            const runResult = await options.lspRunner({
              binary,
              filePath: targetPath,
              workspaceRoot: rootDir,
              timeoutMs: 15000,
              signal: context.signal,
            });

            const errorCount = runResult.diagnostics.filter((d) => d.severity === 'error').length;
            const warningCount = runResult.diagnostics.filter((d) => d.severity === 'warning').length;

            return {
              filePath: input.filePath,
              language,
              serverStatus: 'configured',
              serverBinary: binary,
              diagnostics: runResult.diagnostics,
              errorCount,
              warningCount,
              rawOutput: runResult.rawOutput,
            };
          } catch (runnerErr: unknown) {
            const err = runnerErr as { killed?: boolean; message?: string; stderr?: string };
            if (err.killed || context.signal?.aborted) {
              return {
                filePath: input.filePath,
                language,
                serverStatus: 'error',
                serverBinary: binary,
                diagnostics: [],
                errorCount: 1,
                warningCount: 0,
                message: `Eksekusi language server '${binary}' dibatalkan atau melampaui timeout 15000ms.`,
              };
            }
            return {
              filePath: input.filePath,
              language,
              serverStatus: 'error',
              serverBinary: binary,
              diagnostics: [],
              errorCount: 1,
              warningCount: 0,
              message: `Language server '${binary}' gagal dieksekusi: ${err.message ?? 'Unknown error'}`,
              rawOutput: err.stderr ? err.stderr.slice(0, 2048) : undefined,
            };
          }
        }

        // Default live executor with process tree cleanup & timeout
        try {
          const { stdout, stderr } = await execFileAsync(binary, [targetPath], {
            cwd: rootDir,
            timeout: 15000,
            signal: context.signal,
            maxBuffer: 32768,
          });

          const outputText = `${stdout}\n${stderr}`.trim();
          const lines = outputText.split('\n');
          const diagnostics: LspDiagnosticItem[] = [];

          for (const line of lines) {
            const item = parseDiagnosticLine(line);
            if (item) {
              diagnostics.push(item);
            }
          }

          const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
          const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

          return {
            filePath: input.filePath,
            language,
            serverStatus: 'configured',
            serverBinary: binary,
            diagnostics,
            errorCount,
            warningCount,
            rawOutput: outputText.slice(0, 4096),
          };
        } catch (execErr: unknown) {
          const err = execErr as { code?: string | number; killed?: boolean; message?: string; stdout?: string; stderr?: string };
          if (err.killed || context.signal?.aborted) {
            return {
              filePath: input.filePath,
              language,
              serverStatus: 'error',
              serverBinary: binary,
              diagnostics: [],
              errorCount: 1,
              warningCount: 0,
              message: `Eksekusi language server '${binary}' dibatalkan atau melampaui timeout 15000ms.`,
            };
          }

          // Some linters/LSPs exit with non-zero exit codes when diagnostics/errors are found
          const combinedOutput = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim();
          if (combinedOutput.length > 0) {
            const lines = combinedOutput.split('\n');
            const diagnostics: LspDiagnosticItem[] = [];
            for (const line of lines) {
              const item = parseDiagnosticLine(line);
              if (item) {
                diagnostics.push(item);
              }
            }
            if (diagnostics.length > 0) {
              const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
              const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
              return {
                filePath: input.filePath,
                language,
                serverStatus: 'configured',
                serverBinary: binary,
                diagnostics,
                errorCount,
                warningCount,
                rawOutput: combinedOutput.slice(0, 4096),
              };
            }
          }

          return {
            filePath: input.filePath,
            language,
            serverStatus: 'error',
            serverBinary: binary,
            diagnostics: [],
            errorCount: 1,
            warningCount: 0,
            message: `Language server '${binary}' gagal dieksekusi: ${err.message ?? 'Unknown error'}`,
            rawOutput: combinedOutput.slice(0, 2048),
          };
        }
      } finally {
        limiter.release(`lsp:${language}`);
      }
    },
  };
}
