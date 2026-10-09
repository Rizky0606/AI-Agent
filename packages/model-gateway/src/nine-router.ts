import { ModelGatewayError, sanitizeMessage } from './errors.ts';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  EmbeddingProvider,
  ModelDescriptor,
  ModelGateway,
} from './types.ts';

export type NineRouterConfig = {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  fetchFn?: typeof fetch;
};

export class NineRouterGateway implements ModelGateway {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: NineRouterConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('NineRouterGateway requires a non-empty apiKey');
    }
    this.baseUrl = (config.baseUrl ?? 'https://9router.ojixx.my.id/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.initialBackoffMs = config.initialBackoffMs ?? 300;
    this.maxBackoffMs = config.maxBackoffMs ?? 3_000;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted)
      throw new ModelGatewayError('STREAM_ABORTED', 'Operation was aborted by client');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new ModelGatewayError('STREAM_ABORTED', 'Operation was aborted by client'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private normalizeError(status: number, rawBody: string): ModelGatewayError {
    const cleanMessage = sanitizeMessage(rawBody, this.apiKey);
    let parsedMessage = cleanMessage;
    try {
      const parsed = JSON.parse(cleanMessage) as { error?: { message?: string; code?: string } };
      if (parsed.error?.message) {
        parsedMessage = parsed.error.message;
      }
    } catch {
      // Raw string is used if not JSON
    }

    if (status === 401 || status === 403) {
      return new ModelGatewayError(
        'AUTHENTICATION_ERROR',
        `9Router authentication failed (HTTP ${status}): ${parsedMessage}`,
        { statusCode: status, retryable: false },
      );
    }
    if (status === 404) {
      return new ModelGatewayError(
        'MODEL_NOT_FOUND',
        `9Router model or endpoint not found (HTTP 404): ${parsedMessage}`,
        { statusCode: status, retryable: false },
      );
    }
    if (status === 429) {
      return new ModelGatewayError(
        'RATE_LIMITED',
        `9Router rate limit exceeded (HTTP 429): ${parsedMessage}`,
        { statusCode: status, retryable: true },
      );
    }
    if (status === 400 || status === 422) {
      return new ModelGatewayError(
        'INVALID_REQUEST',
        `9Router rejected request (HTTP ${status}): ${parsedMessage}`,
        { statusCode: status, retryable: false },
      );
    }
    if (status >= 500) {
      return new ModelGatewayError(
        'PROVIDER_UNAVAILABLE',
        `9Router upstream service error (HTTP ${status}): ${parsedMessage}`,
        { statusCode: status, retryable: true },
      );
    }
    return new ModelGatewayError(
      'UNKNOWN',
      `9Router unexpected error (HTTP ${status}): ${parsedMessage}`,
      { statusCode: status, retryable: false },
    );
  }

  private async fetchWithRetry(
    path: string,
    init: RequestInit,
    parentSignal?: AbortSignal,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (parentSignal?.aborted) {
        throw new ModelGatewayError('STREAM_ABORTED', 'Operation was aborted by client');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('TIMEOUT')), this.timeoutMs);

      const abortHandler = () => controller.abort();
      parentSignal?.addEventListener('abort', abortHandler, { once: true });

      try {
        const response = await this.fetchFn(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
            ...init.headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        parentSignal?.removeEventListener('abort', abortHandler);

        if (!response.ok) {
          const rawText = await response.text();
          const error = this.normalizeError(response.status, rawText);
          if (error.retryable && attempt < this.maxRetries) {
            lastError = error;
            const delay = Math.min(
              this.maxBackoffMs,
              this.initialBackoffMs * 2 ** attempt + Math.floor(Math.random() * 50),
            );
            await this.sleep(delay, parentSignal);
            continue;
          }
          throw error;
        }

        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        parentSignal?.removeEventListener('abort', abortHandler);

        if (parentSignal?.aborted) {
          throw new ModelGatewayError('STREAM_ABORTED', 'Operation was aborted by client', {
            cause: err,
          });
        }

        const isTimeout =
          (err instanceof Error && err.message === 'TIMEOUT') ||
          (err instanceof DOMException && err.name === 'TimeoutError');

        if (isTimeout) {
          const timeoutError = new ModelGatewayError(
            'TIMEOUT',
            `9Router request timed out after ${this.timeoutMs}ms`,
            { statusCode: 504, retryable: true, cause: err },
          );
          if (attempt < this.maxRetries) {
            lastError = timeoutError;
            const delay = Math.min(
              this.maxBackoffMs,
              this.initialBackoffMs * 2 ** attempt + Math.floor(Math.random() * 50),
            );
            await this.sleep(delay, parentSignal);
            continue;
          }
          throw timeoutError;
        }

        if (err instanceof ModelGatewayError) {
          throw err;
        }

        const networkError = new ModelGatewayError(
          'PROVIDER_UNAVAILABLE',
          `9Router network connection failed: ${err instanceof Error ? err.message : String(err)}`,
          { statusCode: 503, retryable: true, cause: err },
        );

        if (attempt < this.maxRetries) {
          lastError = networkError;
          const delay = Math.min(
            this.maxBackoffMs,
            this.initialBackoffMs * 2 ** attempt + Math.floor(Math.random() * 50),
          );
          await this.sleep(delay, parentSignal);
          continue;
        }
        throw networkError;
      }
    }

    throw (
      lastError ??
      new ModelGatewayError('UNKNOWN', 'Operation failed after retries exhausted', {
        retryable: false,
      })
    );
  }

  async listModels(): Promise<readonly ModelDescriptor[]> {
    const response = await this.fetchWithRetry('/models', { method: 'GET' });
    const text = await response.text();
    const data = JSON.parse(text) as {
      data?: Array<{ id: string; context_length?: number; context_window?: number }>;
    };

    if (!Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((item) => ({
      provider: '9router',
      model: item.id,
      capabilities: ['chat', 'streaming'],
      contextWindow: item.context_window ?? item.context_length ?? 4096,
    }));
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await this.fetchWithRetry(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false,
        }),
      },
      request.signal,
    );

    const bodyText = await response.text();
    const parsed = JSON.parse(bodyText) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      cost?: number;
    };

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content ?? '';

    return {
      id: parsed.id ?? `chat-${Date.now()}`,
      model: parsed.model ?? request.model,
      content,
      usage: parsed.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
            totalTokens: parsed.usage.total_tokens,
          }
        : undefined,
      cost: parsed.cost,
    };
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    const response = await this.fetchWithRetry(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true,
        }),
      },
      request.signal,
    );

    if (!response.body) {
      throw new ModelGatewayError(
        'PROVIDER_UNAVAILABLE',
        '9Router stream response has no readable body',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (request.signal?.aborted) {
          throw new ModelGatewayError('STREAM_ABORTED', 'Stream was aborted by client');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') {
              yield { delta: '', done: true };
              return;
            }

            try {
              const chunk = JSON.parse(dataStr) as {
                id?: string;
                model?: string;
                choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                  total_tokens?: number;
                };
              };

              const deltaContent = chunk.choices?.[0]?.delta?.content ?? '';
              const finishReason = chunk.choices?.[0]?.finish_reason;

              if (deltaContent.length > 0 || finishReason) {
                yield {
                  id: chunk.id,
                  model: chunk.model ?? request.model,
                  delta: deltaContent,
                  done: Boolean(finishReason),
                  usage: chunk.usage
                    ? {
                        promptTokens: chunk.usage.prompt_tokens,
                        completionTokens: chunk.usage.completion_tokens,
                        totalTokens: chunk.usage.total_tokens,
                      }
                    : undefined,
                };
              }
            } catch {
              // Ignore malformed partial chunks
            }
          }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:') && trimmed.slice(5).trim() === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
      }

      yield { delta: '', done: true };
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

export type NineRouterEmbeddingConfig = {
  baseUrl?: string;
  apiKey: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  fetchFn?: typeof fetch;
};

export class NineRouterEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: NineRouterEmbeddingConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('NineRouterEmbeddingProvider requires a non-empty apiKey');
    }
    this.baseUrl = (config.baseUrl ?? 'https://9router.ojixx.my.id/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
    this.model = config.model ?? 'text-embedding-3-small';
    this.dimensions = config.dimensions ?? 1536;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.initialBackoffMs = config.initialBackoffMs ?? 300;
    this.maxBackoffMs = config.maxBackoffMs ?? 3_000;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];

    let attempt = 0;
    while (true) {
      if (signal?.aborted) {
        throw new ModelGatewayError('STREAM_ABORTED', 'Embedding request aborted');
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
            dimensions: this.dimensions,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);

        if (!response.ok) {
          const raw = await response.text();
          const cleanMessage = sanitizeMessage(raw, this.apiKey);
          const err = new ModelGatewayError(
            response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
            `9Router embedding failed (HTTP ${response.status}): ${cleanMessage}`,
            {
              statusCode: response.status,
              retryable: response.status === 429 || response.status >= 500,
            },
          );
          if (err.retryable && attempt < this.maxRetries) {
            attempt++;
            const backoff = Math.min(
              this.initialBackoffMs * Math.pow(2, attempt - 1),
              this.maxBackoffMs,
            );
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          throw err;
        }

        const data = (await response.json()) as {
          data?: Array<{ embedding: number[]; index?: number }>;
        };

        if (!Array.isArray(data.data)) {
          throw new ModelGatewayError(
            'INVALID_RESPONSE',
            'Malformed embedding response from 9Router',
          );
        }

        const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        return sorted.map((d) => d.embedding);
      } catch (err) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);

        if (err instanceof ModelGatewayError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRetries) {
          attempt++;
          const backoff = Math.min(
            this.initialBackoffMs * Math.pow(2, attempt - 1),
            this.maxBackoffMs,
          );
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new ModelGatewayError(
          'PROVIDER_UNAVAILABLE',
          `Embedding error: ${sanitizeMessage(msg, this.apiKey)}`,
          {
            retryable: false,
          },
        );
      }
    }
  }
}
