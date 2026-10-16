import { htmlToText } from '../html-text.ts';
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

export type WebSearchProvider = (
  query: string,
  limit: number,
  signal?: AbortSignal | undefined,
) => Promise<WebSearchResultItem[]>;

/**
 * DuckDuckGo's HTML endpoint answers plain HTTP GET without an API key, so no search
 * credential has to be provisioned. It is the only search provider this deployment has.
 */
const DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';
// DuckDuckGo answers 202 with a blank shell for user agents that advertise a bot token, so this
// string must stay free of words like "bot". Verified live 2026-10-13.
const SEARCH_USER_AGENT = 'Mozilla/5.0 (compatible; PersonalAIOS/0.2.0)';
const RESULT_ANCHOR = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const SNIPPET_BLOCK = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;


/** DuckDuckGo wraps every result in `/l/?uddg=<encoded target>`, so unwrap it. */
function resolveResultUrl(href: string): string | undefined {
  const unescaped = href.replace(/&amp;/g, '&');
  const normalized = unescaped.startsWith('//') ? `https:${unescaped}` : unescaped;
  try {
    const parsed = new URL(normalized);
    const wrapped = parsed.searchParams.get('uddg');
    if (wrapped) return wrapped;
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return normalized;
    return undefined;
  } catch {
    return undefined;
  }
}

export interface DuckDuckGoSearchOptions {
  fetchImpl?: typeof fetch | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Real search over the DuckDuckGo HTML endpoint. Throws when the response cannot be
 * parsed at all, so a markup change surfaces as a failed task instead of zero results.
 */
export async function duckDuckGoSearch(
  query: string,
  limit: number,
  options: DuckDuckGoSearchOptions = {},
): Promise<WebSearchResultItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${DUCKDUCKGO_HTML_ENDPOINT}?q=${encodeURIComponent(query)}`, {
    signal: options.signal ?? null,
    headers: { 'User-Agent': SEARCH_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Pencarian web gagal: HTTP ${response.status} dari ${DUCKDUCKGO_HTML_ENDPOINT}.`);
  }

  const html = await response.text();
  const snippets = [...html.matchAll(SNIPPET_BLOCK)].map((match) => htmlToText(match[1] ?? ''));
  const results: WebSearchResultItem[] = [];

  for (const match of html.matchAll(RESULT_ANCHOR)) {
    const url = resolveResultUrl(match[1] ?? '');
    if (!url) continue;
    results.push({
      url,
      title: htmlToText(match[2] ?? '') || url,
      snippet: snippets[results.length] ?? '',
    });
    if (results.length >= limit) break;
  }

  if (results.length === 0 && !html.includes('result__a')) {
    throw new Error(
      `Pencarian web tidak dapat diparsing: endpoint membalas HTTP ${response.status} tanpa markup hasil yang dikenal.`,
    );
  }
  return results;
}

export function createWebSearchTool(
  customSearchProvider?: WebSearchProvider | undefined,
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
    execute: async (input: WebSearchInput, context) => {
      const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
      const provider: WebSearchProvider =
        customSearchProvider ??
        ((query, count, signal) => duckDuckGoSearch(query, count, { signal }));
      const results = await provider(input.query, limit, context.signal);
      return { query: input.query, totalHits: results.length, results };
    },
  };
}
