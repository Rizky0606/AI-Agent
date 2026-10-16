import { validateRemoteMcpUrl } from '../security/egress-guard.ts';
import { type McpServerAdapter, type McpToolDescriptor, McpError } from '../types.ts';

export interface SseMcpServerOptions {
  serverId: string;
  url: string;
  capability: string;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  allowedHosts?: string[] | undefined;
  fetchFn?: typeof fetch | undefined;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id?: unknown;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface RawMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export class SseMcpServerAdapter implements McpServerAdapter {
  private readonly options: SseMcpServerOptions;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private requestId = 1;

  constructor(options: SseMcpServerOptions) {
    this.options = options;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 25_000;

    // Validate URL upfront against SSRF / egress restrictions
    const validation = validateRemoteMcpUrl(options.url, {
      allowedHosts: options.allowedHosts,
    });
    if (!validation.allowed) {
      throw new McpError(
        `Egress remote MCP diblokir: ${validation.reason}`,
        options.serverId,
      );
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const res = await this.sendJsonRpc<{ tools: RawMcpTool[] }>('tools/list', {});
    const rawTools = res.tools ?? [];

    return rawTools.map((t) => ({
      name: t.name,
      description: t.description ?? `Remote MCP tool ${t.name}`,
      capability: this.options.capability,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal | undefined,
  ): Promise<{ content: string; error?: string }> {
    try {
      const res = await this.sendJsonRpc<{
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      }>(
        'tools/call',
        {
          name,
          arguments: args,
        },
        signal,
      );

      const textParts = (res.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text);

      const content = textParts.length > 0 ? textParts.join('\n') : JSON.stringify(res);

      if (res.isError) {
        return {
          content,
          error: `Tool '${name}' mengembalikan status error.`,
        };
      }

      return { content };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: `Error: ${msg}`,
        error: msg,
      };
    }
  }

  async close(): Promise<void> {
    // Stateless HTTP/SSE adapter does not hold persistent child processes
  }

  private async sendJsonRpc<T>(
    method: string,
    params: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const id = this.requestId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const onAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort);
    }

    try {
      const response = await this.fetchFn(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.options.headers ?? {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new McpError(
          `Permintaan ke remote MCP gagal dengan status HTTP ${response.status} ${response.statusText}`,
          this.options.serverId,
        );
      }

      const payload = (await response.json()) as JsonRpcResponse<T>;

      if (payload.error) {
        throw new McpError(
          `Remote MCP error [${payload.error.code}]: ${payload.error.message}`,
          this.options.serverId,
        );
      }

      if (payload.result === undefined) {
        throw new McpError(
          `Remote MCP response tidak memuat field result.`,
          this.options.serverId,
        );
      }

      return payload.result;
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    }
  }
}
