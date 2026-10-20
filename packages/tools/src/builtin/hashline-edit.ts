import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, normalize, resolve } from 'node:path';
import { ToolError, type ToolDefinition } from '../types.ts';

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_EDITS_PER_BATCH = 100;
export const MAX_REPLACEMENT_BYTES = 64 * 1024; // 64 KB

export interface HashlineEditItem {
  lineAnchor: string; // e.g. "42#a1f"
  replacement: string;
}

export interface HashlineEditInput {
  filePath: string;
  edits: HashlineEditItem[];
}

export interface HashlineEditOutput {
  filePath: string;
  linesModified: number;
  totalLines: number;
  sizeBytes: number;
  diff: string;
  fileVersionHash: string;
}

export class HashlineCollisionError extends ToolError {
  readonly status = 'stale_anchor';
  readonly line: number;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly currentLineContent?: string | undefined;

  constructor(
    line: number,
    expectedHash: string,
    actualHash: string,
    currentLineContent?: string | undefined,
  ) {
    super(
      `Stale anchor terdeteksi pada baris ${line}: hash yang diharapkan "${expectedHash}" tetapi hash aktual "${actualHash}". File telah dimodifikasi sejak dibaca. Edit dibatalkan secara atomik tanpa modifikasi disk.`,
      'hashline_edit',
    );
    this.name = 'HashlineCollisionError';
    this.line = line;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
    this.currentLineContent = currentLineContent;
  }
}

/**
 * Menghitung hash pendek deterministik dari konten baris teks (case-insensitive hex).
 * Default panjang hash adalah 3 karakter, atau sesuai panjang expectedHash yang diminta.
 */
export function computeLineHash(line: string, length = 3): string {
  return createHash('sha256')
    .update(line)
    .digest('hex')
    .slice(0, Math.max(1, length))
    .toLowerCase();
}

/**
 * Mem-parse string anchor 'line#hash' menjadi lineNumber (1-indexed) dan expectedHash.
 */
export function parseLineAnchor(anchor: string): { lineNumber: number; expectedHash: string } {
  const match = /^(\d+)#([a-fA-F0-9]+)$/.exec(anchor.trim());
  if (!match || !match[1] || !match[2]) {
    throw new ToolError(
      `Format lineAnchor tidak valid: "${anchor}". Format wajib berupa "<nomor_baris>#<hash>" (contoh: "42#a1f").`,
      'hashline_edit',
    );
  }
  const lineNumber = parseInt(match[1], 10);
  if (lineNumber <= 0) {
    throw new ToolError(
      `Nomor baris pada anchor "${anchor}" harus lebih besar dari 0 (1-indexed).`,
      'hashline_edit',
    );
  }
  return {
    lineNumber,
    expectedHash: match[2].toLowerCase(),
  };
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
      `Akses/modifikasi ke file sensitif/kredensial '${filePath}' dilarang demi keamanan host.`,
      'hashline_edit',
    );
  }
}

/**
 * Menghasilkan diff unifikasi terstruktur untuk perubahan yang diajukan.
 */
export function generateUnifiedDiff(
  filePath: string,
  originalLines: string[],
  appliedEdits: Array<{ lineNumber: number; replacement: string }>,
): string {
  const sorted = [...appliedEdits].sort((a, b) => a.lineNumber - b.lineNumber);
  const diffChunks: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const edit of sorted) {
    const origLine = originalLines[edit.lineNumber - 1] ?? '';
    const repLines = edit.replacement.split(/\r?\n/);
    diffChunks.push(`@@ -${edit.lineNumber},1 +${edit.lineNumber},${repLines.length} @@`);
    diffChunks.push(`-${origLine}`);
    for (const r of repLines) {
      diffChunks.push(`+${r}`);
    }
  }

  return diffChunks.join('\n');
}

export interface HashlineEditFsHooks {
  lstat?: ((path: string) => Promise<{ isSymbolicLink: () => boolean; isFile: () => boolean; size: number }>) | undefined;
  readFile?: ((path: string) => Promise<Buffer>) | undefined;
  writeFile?: ((path: string, data: string, encoding: 'utf-8') => Promise<void>) | undefined;
}

export interface HashlineEditOptions {
  fs?: HashlineEditFsHooks | undefined;
  maxFileSize?: number | undefined;
  maxEditsPerBatch?: number | undefined;
}

export function createHashlineEditTool(
  workspaceRoot: string,
  options: HashlineEditOptions = {},
): ToolDefinition<HashlineEditInput, HashlineEditOutput> {
  const rootDir = resolve(workspaceRoot);
  const fsLstat = options.fs?.lstat ?? lstat;
  const fsReadFile = options.fs?.readFile ?? readFile;
  const fsWriteFile = options.fs?.writeFile ?? writeFile;
  const maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE_BYTES;

  return {
    name: 'hashline_edit',
    description:
      'Mengedit baris file di dalam direktori workspace menggunakan anchor nomor baris dan hash konten (line#hash) untuk mencegah benturan dan drift baris.',
    capability: 'filesystem:write',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'fs:edit_file',
    timeoutMs: 10000,
    supportsCancellation: true,
    outputLimitBytes: 32768,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { filePath, edits }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.filePath !== 'string' || raw.filePath.trim().length === 0) {
        return { valid: false, error: 'Atribut "filePath" harus berupa string non-kosong.' };
      }
      if (!Array.isArray(raw.edits) || raw.edits.length === 0) {
        return { valid: false, error: 'Atribut "edits" harus berupa array berisi minimal 1 edit.' };
      }
      if (raw.edits.length > MAX_EDITS_PER_BATCH) {
        return {
          valid: false,
          error: `Jumlah edit dalam satu batch (${raw.edits.length}) melebihi batas maksimum ${MAX_EDITS_PER_BATCH}.`,
        };
      }
      for (let i = 0; i < raw.edits.length; i++) {
        const item = raw.edits[i] as unknown;
        if (typeof item !== 'object' || item === null) {
          return { valid: false, error: `Elemen edits[${i}] harus berupa objek { lineAnchor, replacement }.` };
        }
        const rec = item as Record<string, unknown>;
        if (typeof rec.lineAnchor !== 'string' || rec.lineAnchor.trim().length === 0) {
          return { valid: false, error: `Atribut "lineAnchor" pada edits[${i}] harus berupa string non-kosong.` };
        }
        if (typeof rec.replacement !== 'string') {
          return { valid: false, error: `Atribut "replacement" pada edits[${i}] harus berupa string.` };
        }
        if (Buffer.byteLength(rec.replacement, 'utf-8') > MAX_REPLACEMENT_BYTES) {
          return {
            valid: false,
            error: `Ukuran replacement pada edits[${i}] melebihi batas maksimum ${MAX_REPLACEMENT_BYTES} bytes (64 KB).`,
          };
        }
      }
      return { valid: true, data: input as HashlineEditInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: HashlineEditInput) => {
      // 1. Path traversal security check
      const normalized = normalize(input.filePath);
      const targetPath = isAbsolute(normalized)
        ? resolve(normalized)
        : resolve(rootDir, normalized);

      if (!targetPath.startsWith(rootDir)) {
        throw new ToolError(
          `Path traversal terdeteksi pada '${input.filePath}'. Akses di luar direktori workspace '${rootDir}' dilarang.`,
          'hashline_edit',
        );
      }

      // 2. Sensitive and credential file protection
      checkSensitivePath(input.filePath, targetPath);

      // 3. Check file existence, symlink escape, and type
      const fileLstat = await fsLstat(targetPath);
      if (fileLstat.isSymbolicLink()) {
        throw new ToolError(
          `Target '${input.filePath}' adalah symbolic link. Penulisan ke symbolic link dilarang demi keamanan workspace.`,
          'hashline_edit',
        );
      }
      if (!fileLstat.isFile()) {
        throw new ToolError(`Target '${input.filePath}' bukan merupakan file biasa.`, 'hashline_edit');
      }
      if (fileLstat.size > maxFileSize) {
        throw new ToolError(
          `Ukuran file '${input.filePath}' (${fileLstat.size} bytes) melebihi batas maksimum ${maxFileSize} bytes (5 MB).`,
          'hashline_edit',
        );
      }

      // 4. Read raw file buffer and verify encoding / binary
      const rawBuffer = await fsReadFile(targetPath);
      if (rawBuffer.includes(0)) {
        throw new ToolError(
          `File '${input.filePath}' terdeteksi sebagai file biner atau mengandung null bytes. hashline_edit hanya mendukung teks UTF-8.`,
          'hashline_edit',
        );
      }

      // 5. Decode UTF-8 & detect newline convention
      const rawText = rawBuffer.toString('utf-8');
      const isCrlf = rawText.includes('\r\n');
      const newline = isCrlf ? '\r\n' : '\n';
      const lines = rawText.split(/\r?\n/);

      // 6. Parse & validate all anchors first (optimistic concurrency check)
      const parsedEdits: Array<{
        lineNumber: number;
        expectedHash: string;
        replacement: string;
      }> = [];
      const seenLines = new Set<number>();

      for (const edit of input.edits) {
        const { lineNumber, expectedHash } = parseLineAnchor(edit.lineAnchor);

        if (seenLines.has(lineNumber)) {
          throw new ToolError(
            `Duplikasi edit terdeteksi untuk baris ${lineNumber} dalam satu batch eksekusi.`,
            'hashline_edit',
          );
        }
        seenLines.add(lineNumber);

        if (lineNumber > lines.length) {
          throw new ToolError(
            `Nomor baris ${lineNumber} melebihi jumlah baris file (${lines.length} baris).`,
            'hashline_edit',
          );
        }

        const currentLineContent = lines[lineNumber - 1] ?? '';
        const actualHash = computeLineHash(currentLineContent, expectedHash.length);

        if (actualHash !== expectedHash) {
          throw new HashlineCollisionError(lineNumber, expectedHash, actualHash, currentLineContent);
        }

        parsedEdits.push({
          lineNumber,
          expectedHash,
          replacement: edit.replacement,
        });
      }

      // 7. Generate diff before modifying lines
      const diff = generateUnifiedDiff(input.filePath, lines, parsedEdits);

      // 8. Apply edits in descending order of line numbers to preserve line indexing
      const editsDescending = [...parsedEdits].sort((a, b) => b.lineNumber - a.lineNumber);

      const modifiedLines = [...lines];
      for (const edit of editsDescending) {
        const targetIndex = edit.lineNumber - 1;
        // Replacement can be multi-line: split by \r?\n and splice into lines array
        const replacementLines = edit.replacement.split(/\r?\n/);
        modifiedLines.splice(targetIndex, 1, ...replacementLines);
      }

      // 9. Write atomically / replace file content
      const finalContent = modifiedLines.join(newline);
      await fsWriteFile(targetPath, finalContent, 'utf-8');

      const fileVersionHash = createHash('sha256').update(finalContent).digest('hex').slice(0, 12);

      return {
        filePath: input.filePath,
        linesModified: parsedEdits.length,
        totalLines: modifiedLines.length,
        sizeBytes: Buffer.byteLength(finalContent, 'utf-8'),
        diff,
        fileVersionHash,
      };
    },
  };
}
