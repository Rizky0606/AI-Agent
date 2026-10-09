import { defaultSsrfGuard, SsrfGuard } from '../ssrf/ssrf-guard.ts';
import type { ToolDefinition } from '../types.ts';

export interface WebFetchInput {
  url: string;
}

export interface WebFetchOutput {
  url: string;
  status: number;
  contentType: string;
  content: string;
}

export function createWebFetchTool(
  ssrfGuard: SsrfGuard = defaultSsrfGuard,
  customFetch: typeof fetch = fetch,
): ToolDefinition<WebFetchInput, WebFetchOutput> {
  return {
    name: 'web_fetch',
    description: 'Mengambil konten halaman web publik via HTTP GET dengan proteksi SSRF ketat.',
    capability: 'web:fetch',
    resourceScope: 'global',
    riskLevel: 'LOW',
    action: 'web:fetch',
    timeoutMs: 15000,
    supportsCancellation: true,
    outputLimitBytes: 65536, // 64KB
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { url: string }.' };
      }
      const u = (input as Record<string, unknown>).url;
      if (typeof u !== 'string' || u.trim().length === 0) {
        return { valid: false, error: 'Atribut "url" harus berupa string non-kosong.' };
      }
      return { valid: true, data: input as WebFetchInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: WebFetchInput, context) => {
      // 1. Enforce strict SSRF protection before initiating network connection
      await ssrfGuard.assertSafeUrl(input.url);

      // 2. Fetch page with context cancellation signal
      const response = await customFetch(input.url, {
        signal: context.signal ?? null,
        headers: {
          'User-Agent': 'PersonalAIOS/0.2.0 (WebFetch; +https://example.com/bot)',
        },
      });

      // 3. Follow redirect safety check (if redirected)
      if (response.url && response.url !== input.url) {
        await ssrfGuard.assertSafeUrl(response.url);
      }

      const contentType = response.headers.get('content-type') ?? 'text/plain';
      const text = await response.text();

      return {
        url: response.url || input.url,
        status: response.status,
        contentType,
        content: text,
      };
    },
  };
}
