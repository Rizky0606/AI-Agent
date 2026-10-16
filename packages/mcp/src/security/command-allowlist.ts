import { basename } from 'node:path';

export const DEFAULT_ALLOWED_MCP_COMMANDS = [
  'npx',
  'node',
  'docker',
  'uvx',
  'python3',
  'python',
];

const DISALLOWED_SHELL_COMMANDS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'csh',
  'tcsh',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'wscript',
  'cscript',
  'sudo',
  'su',
]);

const DANGEROUS_CHAINING_PATTERNS = [
  /;\s*/,
  /&&\s*/,
  /\|\|\s*/,
  /\|\s*/,
  /`[^`]*`/,
  /\$\([^)]*\)/,
  />\s*/,
  /<\s*/,
];

export interface CommandValidationResult {
  allowed: boolean;
  normalizedCommand: string;
  reason?: string | undefined;
}

/**
 * Validates a stdio command against the deployment allowlist.
 * Prevents arbitrary command execution, shell injections, and command chaining.
 */
export function validateMcpCommand(
  rawCommand: string,
  args?: readonly string[] | undefined,
  customAllowlist?: string[] | undefined,
): CommandValidationResult {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return {
      allowed: false,
      normalizedCommand: '',
      reason: 'Perintah tidak boleh kosong.',
    };
  }

  // 1. Check for shell chaining or dangerous tokens in command or args
  for (const pattern of DANGEROUS_CHAINING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        normalizedCommand: trimmed,
        reason: 'Terdeteksi karakter command chaining atau operator shell berbahaya dalam perintah.',
      };
    }
    if (args) {
      for (const arg of args) {
        if (pattern.test(arg)) {
          return {
            allowed: false,
            normalizedCommand: trimmed,
            reason: `Terdeteksi operator shell berbahaya dalam argumen: "${arg}".`,
          };
        }
      }
    }
  }

  // 2. Extract binary base name
  const rawBase = basename(trimmed).toLowerCase();
  const binaryName = rawBase.replace(/\.(exe|cmd|bat)$/i, '');

  // 3. Reject shell wrappers
  if (DISALLOWED_SHELL_COMMANDS.has(binaryName) || DISALLOWED_SHELL_COMMANDS.has(rawBase)) {
    return {
      allowed: false,
      normalizedCommand: trimmed,
      reason: `Penggunaan shell wrapper '${rawBase}' dilarang demi keamanan proses.`,
    };
  }

  // 4. Check against allowlist
  const allowlist = (
    customAllowlist ??
    process.env['MCP_COMMAND_ALLOWLIST']?.split(',').map((c) => c.trim().toLowerCase()) ??
    DEFAULT_ALLOWED_MCP_COMMANDS
  ).map((c) => c.toLowerCase());

  if (!allowlist.includes(binaryName) && !allowlist.includes(rawBase)) {
    return {
      allowed: false,
      normalizedCommand: trimmed,
      reason: `Perintah '${binaryName}' tidak terdaftar dalam allowlist perintah deploy (${allowlist.join(', ')}).`,
    };
  }

  return {
    allowed: true,
    normalizedCommand: trimmed,
  };
}
