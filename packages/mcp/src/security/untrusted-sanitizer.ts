const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|secret|token|password|bearer|auth[_-]?token)\s*[:=]\s*['"]?)([a-zA-Z0-9_.~+-]{8,})(['"]?)/gi,
  /(Bearer\s+)([a-zA-Z0-9_.~+-]{16,})/gi,
  /(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/gi,
  /(-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----)/gi,
];

// ANSI escape sequences
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;
// Control characters (except newline, tab, carriage return)
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface SanitizedMcpOutput {
  sanitized: string;
  wrappedContent: string;
  isUntrusted: true;
  isInstruction: false;
}

export function sanitizeMcpOutput(
  rawContent: string,
  serverId: string,
  toolName: string,
): SanitizedMcpOutput {
  if (typeof rawContent !== 'string') {
    rawContent = String(rawContent ?? '');
  }

  // 1. Strip ANSI escape sequences and non-printable control characters
  let cleaned = rawContent.replace(ANSI_REGEX, '').replace(CONTROL_CHAR_REGEX, '');

  // 2. Redact secrets
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '$1[REDACTED_SECRET]$3');
  }

  // 3. Prevent fake closing tags injection
  const escapedContent = cleaned.replace(/<\/untrusted_content>/gi, '&lt;/untrusted_content&gt;');

  // 4. Wrap with untrusted content boundaries
  const wrappedContent = `<untrusted_content source="mcp:${serverId}/${toolName}" is_instruction="false">\n${escapedContent}\n</untrusted_content>`;

  return {
    sanitized: cleaned,
    wrappedContent,
    isUntrusted: true,
    isInstruction: false,
  };
}
