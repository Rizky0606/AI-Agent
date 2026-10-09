export type ModelCapability = 'chat' | 'streaming' | 'tool_calling' | 'vision';

export type ModelCostMetadata = {
  promptPerMillion?: number | undefined;
  completionPerMillion?: number | undefined;
};

export type ModelDescriptor = {
  provider: string;
  model: string;
  capabilities: readonly ModelCapability[];
  contextWindow?: number | undefined;
  costMetadata?: ModelCostMetadata | undefined;
  latencyMs?: number | undefined;
};

export type ChatContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; imageUrl: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | readonly ChatContentPart[];
  name?: string | undefined;
};

export type TokenUsage = {
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
};

export type ChatCompletionRequest = {
  model: string;
  messages: readonly ChatMessage[];
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
  stream?: boolean | undefined;
};

export type ChatCompletionResponse = {
  id: string;
  model: string;
  content: string;
  usage?: TokenUsage | undefined;
  cost?: number | undefined;
};

export type ChatStreamChunk = {
  id?: string | undefined;
  model?: string | undefined;
  delta: string;
  done: boolean;
  usage?: TokenUsage | undefined;
};

export interface ModelGateway {
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk>;
  listModels(): Promise<readonly ModelDescriptor[]>;
}

export type EmbeddingRequest = {
  input: readonly string[];
  model?: string | undefined;
  dimensions?: number | undefined;
  signal?: AbortSignal | undefined;
};

export type EmbeddingResponse = {
  embeddings: readonly (readonly number[])[];
  model: string;
  usage?: { promptTokens?: number; totalTokens?: number } | undefined;
};

export interface EmbeddingProvider {
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]>;
  getDimensions(): number;
}
