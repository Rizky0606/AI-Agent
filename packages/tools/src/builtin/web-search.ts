import type { ToolDefinition } from '../types.ts';

export interface WebSearchInput {
  query: string;
  limit?: number | undefined;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  query: string;
  totalHits: number;
  results: WebSearchResultItem[];
}

export function createWebSearchTool(
  customSearchProvider?: (query: string, limit: number) => Promise<WebSearchResultItem[]>,
): ToolDefinition<WebSearchInput, WebSearchOutput> {
  return {
    name: 'web_search',
    description: 'Melakukan pencarian web untuk mengumpulkan informasi relevan dari internet.',
    capability: 'web:search',
    resourceScope: 'global',
    riskLevel: 'LOW',
    action: 'web:search',
    timeoutMs: 15000,
    supportsCancellation: true,
    outputLimitBytes: 32768,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { query: string }.' };
      }
      const q = (input as Record<string, unknown>).query;
      if (typeof q !== 'string' || q.trim().length === 0) {
        return { valid: false, error: 'Atribut "query" harus berupa string non-kosong.' };
      }
      return { valid: true, data: input as WebSearchInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: WebSearchInput) => {
      const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

      if (customSearchProvider) {
        const hits = await customSearchProvider(input.query, limit);
        return {
          query: input.query,
          totalHits: hits.length,
          results: hits,
        };
      }

      // Default mock search provider
      const hits: WebSearchResultItem[] = [
        {
          title: `Hasil pencarian relevan: ${input.query}`,
          url: `https://example.com/search?q=${encodeURIComponent(input.query)}`,
          snippet: `Ringkasan temuan web terkini terkait topik "${input.query}". Dokumentasi teknis dan referensi arsitektur.`,
        },
      ];

      return {
        query: input.query,
        totalHits: hits.length,
        results: hits,
      };
    },
  };
}
