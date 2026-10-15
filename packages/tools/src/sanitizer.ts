/**
 * Untrusted Tool Output Sanitizer
 *
 * All external and tool outputs executed by autonomous agents MUST be treated as untrusted.
 * This sanitizer:
 * 1. Strips ANSI escape codes and unprintable control characters.
 * 2. Redacts sensitive credentials (tokens, API keys, passwords, private keys).
 * 3. Prevents prompt injection by escaping counterfeit closing boundary tags.
 * 4. Wraps output with strict boundary markers declaring is_instruction="false".
 */

const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|secret|token|password|bearer|auth[_-]?token)\s*[:=]\s*['"]?)([a-zA-Z0-9_.~+-]{8,})(['"]?)/gi,
  /(Bearer\s+)([a-zA-Z0-9_.~+-]{16,})/gi,
  /(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/gi,
  /(-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----)/gi,
];

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface SanitizedToolOutput {
  sanitized: string;
  wrappedContent: string;
  isUntrusted: true;
  isInstruction: false;
}

export function sanitizeUntrustedToolOutput(
  rawContent: unknown,
  toolName: string,
): SanitizedToolOutput {
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (rawContent !== null && rawContent !== undefined) {
    try {
      text = JSON.stringify(rawContent, null, 2);
    } catch {
      text = String(rawContent);
    }
  }

  // 1. Strip ANSI and control characters
  let cleaned = text.replace(ANSI_REGEX, '').replace(CONTROL_CHAR_REGEX, '');

  // 2. Redact sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '$1[REDACTED_SECRET]$3');
  }

  // 3. Prevent fake closing tags injection
  const escaped = cleaned.replace(/<\/untrusted_content>/gi, '&lt;/untrusted_content&gt;');

  // 4. Wrap with strict boundaries
  const wrappedContent = `<untrusted_content tool="${toolName}" is_instruction="false">\n${escaped}\n</untrusted_content>`;

  return {
    sanitized: cleaned,
    wrappedContent,
    isUntrusted: true,
    isInstruction: false,
  };
}
