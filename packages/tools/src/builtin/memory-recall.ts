import type { ToolDefinition } from '../types.ts';

export interface MemoryRecallItem {
  id: string;
  text: string;
  category: string;
}

export interface MemoryRecallInput {
  query: string;
  maxItems?: number | undefined;
}

export interface MemoryRecallOutput {
  results: MemoryRecallItem[];
  totalFound: number;
}

const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|secret|token|password|bearer|auth[_-]?token)\s*[:=]\s*['"]?)([a-zA-Z0-9_.~+-]{8,})(['"]?)/gi,
  /(Bearer\s+)([a-zA-Z0-9_.~+-]{16,})/gi,
  /(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/gi,
  /(-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----)/gi,
];

function sanitizeMemoryText(text: string): string {
  let cleaned = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '$1[REDACTED_SECRET]$3');
  }
  return cleaned;
}

export interface MemoryRecallProvider {
  recall(query: string, maxItems: number, context?: Record<string, unknown>): Promise<MemoryRecallItem[]>;
}

export function createMemoryRecallTool(
  provider?: MemoryRecallProvider | undefined,
): ToolDefinition<MemoryRecallInput, MemoryRecallOutput> {
  return {
    name: 'memory_recall',
    description: 'Mencari memori dan konteks masa lalu yang disaring (bebas kredensial atau rahasia host).',
    capability: 'knowledge:read',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'knowledge:read',
    timeoutMs: 10_000,
    supportsCancellation: true,
    outputLimitBytes: 16_384, // 16 KB
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { query: string, maxItems?: number }.' };
      }
      const rec = input as Record<string, unknown>;
      if (typeof rec.query !== 'string' || rec.query.trim().length === 0) {
        return { valid: false, error: 'Atribut "query" harus berupa string non-kosong.' };
      }
      if (rec.query.length > 500) {
        return { valid: false, error: 'Atribut "query" tidak boleh melebihi 500 karakter.' };
      }
      if (rec.maxItems !== undefined) {
        if (typeof rec.maxItems !== 'number' || !Number.isInteger(rec.maxItems) || rec.maxItems < 1 || rec.maxItems > 50) {
          return { valid: false, error: 'Atribut "maxItems" harus berupa integer antara 1 dan 50.' };
        }
      }
      return {
        valid: true,
        data: {
          query: rec.query.trim(),
          maxItems: typeof rec.maxItems === 'number' ? rec.maxItems : 10,
        },
      };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: MemoryRecallInput) => {
      const maxItems = input.maxItems ?? 10;
      let rawItems: MemoryRecallItem[] = [];

      if (provider) {
        rawItems = await provider.recall(input.query, maxItems);
      }

      // Filter and sanitize sensitive credentials from any recalled memory item
      const results: MemoryRecallItem[] = rawItems.slice(0, maxItems).map((item) => ({
        id: item.id,
        text: sanitizeMemoryText(item.text),
        category: item.category,
      }));

      return {
        results,
        totalFound: results.length,
      };
    },
  };
}
