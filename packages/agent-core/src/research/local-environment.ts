import { htmlTitle, htmlToText } from '@personal-ai-os/tools';
import type {
  ToolExecutionContext,
  ToolRegistry,
  WebFetchOutput,
  WebSearchOutput,
} from '@personal-ai-os/tools';
import type { ResearchEnvironment, SearchResultItem } from './research-agent.ts';

export interface LocalResearchEnvironmentOptions {
  /** Guarded registry. Search and browse go through the permission engine, never raw fetch. */
  registry: ToolRegistry;
  context: ToolExecutionContext;
  searchLimit?: number | undefined;
  /** Pages whose extracted text is shorter than this are treated as unreadable. */
  minContentChars?: number | undefined;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Production research backend: `web_search` for discovery, `web_fetch` for browse. Both
 * run through the same guarded `ToolRegistry` as every other tool call, so `web:search`
 * and `web:fetch` are permission-checked instead of bypassed by a private HTTP client.
 */
export class LocalResearchEnvironment implements ResearchEnvironment {
  private readonly registry: ToolRegistry;
  private readonly context: ToolExecutionContext;
  private readonly searchLimit: number;
  private readonly minContentChars: number;

  constructor(options: LocalResearchEnvironmentOptions) {
    this.registry = options.registry;
    this.context = options.context;
    this.searchLimit = options.searchLimit ?? 5;
    this.minContentChars = options.minContentChars ?? 200;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const result = await this.registry.executeTool<{ query: string; limit: number }, WebSearchOutput>({
      toolName: 'web_search',
      input: { query, limit: this.searchLimit },
      context: this.context,
    });
    if (result.status !== 'success' || !result.data) {
      throw new Error(`web_search gagal untuk "${query}": ${result.error ?? 'tanpa data'}.`);
    }
    return result.data.results.map((item) => ({ ...item, domain: hostnameOf(item.url) }));
  }

  async fetchContent(url: string): Promise<{ url: string; title: string; content: string }> {
    const result = await this.registry.executeTool<{ url: string }, WebFetchOutput>({
      toolName: 'web_fetch',
      input: { url },
      context: this.context,
    });
    if (result.status !== 'success' || !result.data) {
      throw new Error(`web_fetch gagal untuk ${url}: ${result.error ?? 'tanpa data'}.`);
    }
    // A page larger than the tool output limit comes back as the registry's truncation
    // envelope, which is a partial JSON string rather than a document. Drop it instead of
    // citing a fragment.
    if (truncationEnvelope(result.data)) {
      throw new Error(`Konten ${url} melebihi batas output web_fetch sehingga dipotong.`);
    }
    const page = result.data;
    if (page.status < 200 || page.status > 299) {
      throw new Error(`Pengambilan ${url} gagal: HTTP ${page.status}.`);
    }

    const text = htmlToText(page.content);
    if (text.length < this.minContentChars) {
      throw new Error(
        `Konten ${url} terlalu pendek untuk dijadikan sumber (${text.length} karakter).`,
      );
    }
    return { url: page.url || url, title: htmlTitle(page.content), content: text };
  }
}

/** True for the `{_truncated, snippet, …}` object the tool registry substitutes for oversized output. */
function truncationEnvelope(data: unknown): boolean {
  return typeof data === 'object' && data !== null && '_truncated' in data;
}
