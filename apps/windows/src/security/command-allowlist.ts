import { SecurityError } from './path-validator.ts';

/**
 * Why a command was refused. The wire code is always `COMMAND_NOT_ALLOWED`; the reason says which
 * rule fired, so a rejected dispatch can be told apart from a typo or a bug.
 */
export type CommandRejectionReason =
  | 'EMPTY_COMMAND'
  | 'NULL_BYTE_DETECTED'
  | 'ENCODED_COMMAND'
  | 'DYNAMIC_EXECUTION'
  | 'SUBSHELL'
  | 'CALL_OPERATOR'
  | 'SHELL_WRAPPER'
  | 'PATH_QUALIFIED_COMMAND'
  | 'COMMAND_NOT_ALLOWED';

export class CommandNotAllowedError extends SecurityError {
  readonly token: string;
  readonly reason: CommandRejectionReason;

  constructor(token: string, reason: CommandRejectionReason) {
    super(
      'COMMAND_NOT_ALLOWED',
      `Command rejected (${reason}): "${token}" is not on the local command allowlist.`,
    );
    this.name = 'CommandNotAllowedError';
    this.token = token;
    this.reason = reason;
  }
}

/**
 * Built-in allowlist, deny by default. `hostname` is required by the M4 device-dispatch smoke
 * (docs/final-audit.md); the rest are the programs this repo's own tests exercise —
 * `apps/windows/test/command-executor.test.ts` (Write-Output, Get-Date, Start-Sleep,
 * ForEach-Object) and `apps/windows/test/connection-and-offline.test.ts` (`dir`, the alias of
 * Get-ChildItem, which is listed too).
 */
export const DEFAULT_ALLOWED_COMMANDS = [
  'hostname',
  'dir',
  'Get-ChildItem',
  'Get-Date',
  'Write-Output',
  'Start-Sleep',
  'ForEach-Object',
] as const;

/**
 * Shells and script hosts. Refused even when an operator lists them, because the program that
 * would really run is hidden inside their arguments and never reaches this check.
 */
const SHELL_WRAPPERS: Record<string, true> = {
  cmd: true,
  'cmd.exe': true,
  powershell: true,
  'powershell.exe': true,
  pwsh: true,
  'pwsh.exe': true,
  wscript: true,
  'wscript.exe': true,
  cscript: true,
  'cscript.exe': true,
  mshta: true,
  'mshta.exe': true,
  rundll32: true,
  'rundll32.exe': true,
  bash: true,
  sh: true,
  wsl: true,
};

const DYNAMIC_EXECUTION_TOKENS: Record<string, true> = {
  iex: true,
  'invoke-expression': true,
};

/** `3` and `1..50` produce data; they invoke nothing. */
const DATA_EXPRESSION = /^\d+(?:\.\.\d+)?$/;

/** A program named by path or by file extension rather than by bare name. */
const PATH_LIKE = /^(?:[a-zA-Z]:[\\/]|\\\\|\.{1,2}[\\/])|\.(?:exe|cmd|bat|com|ps1|vbs|js)$/i;

const CHAIN_SEPARATOR = /(?:&&|\|\||[;|\r\n])/;

function unquote(token: string): string {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses the program(s) a PowerShell command text invokes and refuses anything that is not on
 * `allowedCommands`. Conservative by construction: strings are not parsed, so a metacharacter
 * inside a literal is treated as real syntax — that can refuse a legitimate command, never a
 * dangerous one. See `apps/windows/test/command-allowlist.test.ts`.
 */
export function assertCommandAllowed(
  commandText: string,
  allowedCommands: readonly string[],
): void {
  const text = commandText.trim();
  if (text.length === 0) {
    throw new CommandNotAllowedError('<empty>', 'EMPTY_COMMAND');
  }

  if (text.includes('\0')) {
    throw new CommandNotAllowedError('<null_byte>', 'NULL_BYTE_DETECTED');
  }

  // Forms that hide the real program from any per-segment check, so they are refused outright.
  if (text.includes('$(') || text.includes('`') || text.includes('(') || text.includes(')')) {
    throw new CommandNotAllowedError(text, 'SUBSHELL');
  }
  if (/(^|[^&])&([^&]|$)/.test(text)) {
    throw new CommandNotAllowedError(text, 'CALL_OPERATOR');
  }

  const tokens = text.split(/[\s;|&]+/).filter((token) => token.length > 0);

  // `-EncodedCommand` carries the whole script as a blob no per-segment check can read, so it is
  // refused before anything else. `-enc` and longer abbreviations are the ones PowerShell binds to
  // it; shorter ones (`-e`, `-en`) are ambiguous and PowerShell refuses them itself, while `-ea`
  // is `-ErrorAction` and must keep working.
  const encodedFlag = tokens.find((token) => {
    const lowered = unquote(token).toLowerCase();
    return lowered.startsWith('-enc') && '-encodedcommand'.startsWith(lowered);
  });
  if (encodedFlag) {
    throw new CommandNotAllowedError(encodedFlag, 'ENCODED_COMMAND');
  }

  // Anything anywhere in the text that re-enters a program.
  for (const token of tokens) {
    const unquotedToken = unquote(token);
    const lowered = unquotedToken.toLowerCase();
    if (DYNAMIC_EXECUTION_TOKENS[lowered]) {
      throw new CommandNotAllowedError(token, 'DYNAMIC_EXECUTION');
    }
    if (SHELL_WRAPPERS[lowered]) {
      throw new CommandNotAllowedError(token, 'SHELL_WRAPPER');
    }
  }

  const allowed = new Set(allowedCommands.map((name) => name.toLowerCase()));

  // Inspect scriptblock { ... } bodies for nested command execution
  const startBrace = text.indexOf('{');
  const endBrace = text.lastIndexOf('}');
  if (startBrace !== -1 && endBrace > startBrace) {
    const inner = text.slice(startBrace + 1, endBrace);
    for (const innerSeg of inner.split(CHAIN_SEPARATOR)) {
      const trimmed = innerSeg.trim();
      if (!trimmed) continue;
      const rawHead = trimmed.split(/\s+/)[0] ?? '';
      const head = unquote(rawHead);
      if (!head || head.startsWith('"') || head.startsWith("'") || head.startsWith('$') || DATA_EXPRESSION.test(head)) {
        continue;
      }
      const lowered = head.toLowerCase();
      if (PATH_LIKE.test(head)) {
        throw new CommandNotAllowedError(head, 'PATH_QUALIFIED_COMMAND');
      }
      if (SHELL_WRAPPERS[lowered]) {
        throw new CommandNotAllowedError(head, 'SHELL_WRAPPER');
      }
      if (!allowed.has(lowered)) {
        throw new CommandNotAllowedError(head, 'COMMAND_NOT_ALLOWED');
      }
    }
  }

  // A chain is only as safe as its worst segment, so every segment's program is checked.
  for (const segment of text.split(CHAIN_SEPARATOR)) {
    const rawHead = segment.trim().split(/\s+/)[0];
    if (!rawHead) continue;
    const head = unquote(rawHead);
    if (!head || DATA_EXPRESSION.test(head)) {
      continue;
    }
    const lowered = head.toLowerCase();
    if (PATH_LIKE.test(head)) {
      throw new CommandNotAllowedError(head, 'PATH_QUALIFIED_COMMAND');
    }
    if (SHELL_WRAPPERS[lowered]) {
      throw new CommandNotAllowedError(head, 'SHELL_WRAPPER');
    }
    if (!allowed.has(lowered)) {
      throw new CommandNotAllowedError(head, 'COMMAND_NOT_ALLOWED');
    }
  }
}
