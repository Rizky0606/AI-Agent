import { ModelGatewayError } from './errors.ts';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  EmbeddingProvider,
  ModelDescriptor,
  ModelGateway,
} from './types.ts';

export type MockGatewayOptions = {
  models?: ModelDescriptor[];
  chatResponse?: string;
  streamChunks?: string[];
  streamDelayMs?: number;
  throwOnChat?: Error;
  throwOnStream?: Error;
  failAttemptsBeforeSuccess?: number;
};

export class MockModelGateway implements ModelGateway {
  public callCount = 0;
  public options: MockGatewayOptions;
  public remainingFailures = 0;

  constructor(options: MockGatewayOptions = {}) {
    this.options = options;
    this.remainingFailures = options.failAttemptsBeforeSuccess ?? 0;
  }

  setFailures(count: number): void {
    this.remainingFailures = count;
  }

  async listModels(): Promise<readonly ModelDescriptor[]> {
    return (
      this.options.models ?? [
        {
          provider: '9router',
          model: 'anthropic/claude-3-5-sonnet',
          capabilities: ['chat', 'streaming', 'tool_calling'],
          contextWindow: 200_000,
        },
        {
          provider: '9router',
          model: 'openai/gpt-4o-mini',
          capabilities: ['chat', 'streaming'],
          contextWindow: 128_000,
        },
      ]
    );
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.callCount++;

    if (request.signal?.aborted) {
      throw new ModelGatewayError('STREAM_ABORTED', 'Request aborted by client');
    }

    if (this.remainingFailures > 0) {
      this.remainingFailures--;
      throw (
        this.options.throwOnChat ??
        new ModelGatewayError('PROVIDER_UNAVAILABLE', 'Simulated transient failure', {
          statusCode: 503,
          retryable: true,
        })
      );
    }

    if (this.options.throwOnChat) {
      throw this.options.throwOnChat;
    }

    const content =
      this.options.chatResponse ??
      `Mock response to: ${typeof request.messages.at(-1)?.content === 'string' ? (request.messages.at(-1)?.content as string) : 'structured content'}`;

    return {
      id: `mock-${Date.now()}`,
      model: request.model,
      content,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    };
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    this.callCount++;

    if (this.remainingFailures > 0) {
      this.remainingFailures--;
      throw (
        this.options.throwOnStream ??
        new ModelGatewayError('PROVIDER_UNAVAILABLE', 'Simulated stream failure', {
          statusCode: 503,
          retryable: true,
        })
      );
    }

    if (this.options.throwOnStream) {
      throw this.options.throwOnStream;
    }

    const chunks = this.options.streamChunks ?? [
      'Halo! ',
      'Ini ',
      'adalah ',
      'respons ',
      'streaming.',
    ];
    const delay = this.options.streamDelayMs ?? 10;

    for (let i = 0; i < chunks.length; i++) {
      if (request.signal?.aborted) {
        throw new ModelGatewayError('STREAM_ABORTED', 'Stream cancelled by client');
      }

      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new ModelGatewayError('STREAM_ABORTED', 'Stream cancelled by client'));
          };
          request.signal?.addEventListener('abort', onAbort, { once: true });
        });
      }

      const isLast = i === chunks.length - 1;
      yield {
        id: `chunk-${i}`,
        model: request.model,
        delta: chunks[i] ?? '',
        done: isLast,
        usage: isLast
          ? {
              promptTokens: 10,
              completionTokens: chunks.length * 2,
              totalTokens: 10 + chunks.length * 2,
            }
          : undefined,
      };
    }
  }
}

function generateDeterministicVector(text: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    vec[0] = 1;
    return vec;
  }
  for (const word of words) {
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = (hash * 31 + word.charCodeAt(j)) >>> 0;
    }
    const idx = hash % dimensions;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) {
    sumSq += (vec[i] ?? 0) * (vec[i] ?? 0);
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Number(((vec[i] ?? 0) / norm).toFixed(6));
  }
  return vec;
}

export type MockEmbeddingOptions = {
  dimensions?: number;
  failAttemptsBeforeSuccess?: number;
  throwOnEmbed?: Error;
};

export class MockEmbeddingProvider implements EmbeddingProvider {
  private readonly dimensions: number;
  public remainingFailures: number;
  public embedCalls = 0;
  private readonly throwOnEmbed?: Error | undefined;

  constructor(options: MockEmbeddingOptions = {}) {
    this.dimensions = options.dimensions ?? 1536;
    this.remainingFailures = options.failAttemptsBeforeSuccess ?? 0;
    this.throwOnEmbed = options.throwOnEmbed;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    this.embedCalls++;
    if (signal?.aborted) {
      throw new ModelGatewayError('STREAM_ABORTED', 'Embedding operation aborted');
    }

    if (this.remainingFailures > 0) {
      this.remainingFailures--;
      throw (
        this.throwOnEmbed ??
        new ModelGatewayError('PROVIDER_UNAVAILABLE', 'Simulated transient embedding failure', {
          statusCode: 503,
          retryable: true,
        })
      );
    }

    if (this.throwOnEmbed) {
      throw this.throwOnEmbed;
    }

    return texts.map((t) => generateDeterministicVector(t, this.dimensions));
  }
}
