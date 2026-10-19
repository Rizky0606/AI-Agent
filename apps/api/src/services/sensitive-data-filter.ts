/**
 * Service pembersih dan penyaring data sensitif untuk usulan skill dan tugas terjadwal.
 * Memastikan tidak ada token otentikasi, API keys, password, atau IP internal yang bocor
 * ke dalam manifest atau prompt instructions.
 */

const SENSITIVE_PATTERNS: Array<{ regex: RegExp; replacement: string; label: string }> = [
  // Bearer / JWT Tokens
  {
    regex: /Bearer\s+[-A-Za-z0-9._~+/]+=*/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
    label: 'Bearer Token',
  },
  // OpenAI / 9Router / General sk- keys
  {
    regex: /sk-[A-Za-z0-9_-]{20,}/gi,
    replacement: '[REDACTED_API_KEY]',
    label: 'API Key (sk-*)',
  },
  // Generic password in URLs or strings (e.g. postgresql://user:pass@host)
  {
    regex: /(password|secret|passwd|token|apikey)\s*[:=]\s*["']?([^\s"',;]+)["']?/gi,
    replacement: '$1: "[REDACTED_CREDENTIAL]"',
    label: 'Credential String',
  },
  // Database connection URLs
  {
    regex: /([a-z]+:\/\/[^:]+:)([^@]+)(@)/gi,
    replacement: '$1[REDACTED_PASSWORD]$3',
    label: 'Database Connection String',
  },
  // Private IPv4 addresses (10.x.x.x, 192.168.x.x, 172.16-31.x.x, 127.0.0.1)
  {
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|127\.0\.0\.1)\b/g,
    replacement: '[REDACTED_INTERNAL_IP]',
    label: 'Internal IP',
  },
];

export interface SanitizationResult {
  cleanText: string;
  hasSensitiveData: boolean;
  redactedPatterns: string[];
}

/**
 * Memindai dan menyaring teks dari data sensitif.
 */
export function sanitizeSensitiveText(text: string): SanitizationResult {
  if (!text) {
    return { cleanText: '', hasSensitiveData: false, redactedPatterns: [] };
  }

  let sanitized = text;
  const detected: string[] = [];

  for (const item of SENSITIVE_PATTERNS) {
    if (item.regex.test(sanitized)) {
      detected.push(item.label);
      sanitized = sanitized.replace(item.regex, item.replacement);
    }
  }

  return {
    cleanText: sanitized,
    hasSensitiveData: detected.length > 0,
    redactedPatterns: Array.from(new Set(detected)),
  };
}

/**
 * Menyaring objek secara rekursif (misal manifest JSON).
 */
export function sanitizeSensitiveJson<T>(data: T): { cleanData: T; hasSensitiveData: boolean } {
  let foundSensitive = false;

  const traverse = (val: unknown): unknown => {
    if (typeof val === 'string') {
      const res = sanitizeSensitiveText(val);
      if (res.hasSensitiveData) foundSensitive = true;
      return res.cleanText;
    }
    if (Array.isArray(val)) {
      return val.map(traverse);
    }
    if (val !== null && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = traverse(v);
      }
      return out;
    }
    return val;
  };

  const cleanData = traverse(data) as T;
  return { cleanData, hasSensitiveData: foundSensitive };
}
