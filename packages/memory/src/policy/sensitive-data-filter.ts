export interface SensitiveDetectionResult {
  found: boolean;
  categories: string[];
}

export interface SensitiveRedactionResult {
  sanitized: string;
  categories: string[];
}

const SENSITIVE_PATTERNS: Array<{
  category: string;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    category: 'api_key',
    pattern: /\b(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    category: 'bearer_token',
    pattern: /\bBearer\s+[a-zA-Z0-9_.-]{20,}\b/g,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    category: 'jwt',
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    category: 'private_key',
    pattern: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[^-]*-----END[ A-Z0-9_-]*PRIVATE KEY-----/gs,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    category: 'connection_string',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+\b/g,
    replacement: '[REDACTED_CONNECTION_STRING]',
  },
  {
    category: 'identity_number',
    pattern: /\b[1-9]\d{15}\b/g,
    replacement: '[REDACTED_IDENTITY_NUMBER]',
  },
  {
    category: 'credit_card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|(?:[0-9]{4}[ -]?){3}[0-9]{4})\b/g,
    replacement: '[REDACTED_CREDIT_CARD]',
  },
  {
    category: 'password_assignment',
    pattern: /(?:password|passwd|kata[_\s-]?sandi|api[_\s-]?key|apikey|secret|token)\s*[:=]\s*(?:["']([^"']{3,})["']|([^\s,;]{3,}))/gi,
    replacement: 'secret: "[REDACTED_SECRET]"',
  },
];

export function detectSensitiveData(text: string): SensitiveDetectionResult {
  const foundCategories = new Set<string>();

  for (const { category, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      foundCategories.add(category);
    }
  }

  return {
    found: foundCategories.size > 0,
    categories: Array.from(foundCategories),
  };
}

export function redactSensitiveData(text: string): SensitiveRedactionResult {
  let sanitized = text;
  const redactedCategories = new Set<string>();

  for (const { category, pattern, replacement } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      redactedCategories.add(category);
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, replacement);
    }
  }

  return {
    sanitized,
    categories: Array.from(redactedCategories),
  };
}
