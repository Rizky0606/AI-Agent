export type ModelCapability = 'chat' | 'streaming' | 'tool_calling' | 'vision';

export type CapabilityProvenance = 'probed' | 'declared' | 'unknown';

export type CapabilityDetail = {
  capability: ModelCapability;
  status: CapabilityProvenance;
  verifiedAt?: string | undefined;
  latencyMs?: number | undefined;
  error?: string | undefined;
};

export type CapabilityProbeResult = {
  model: string;
  capabilities: ModelCapability[];
  capabilityDetails: Record<ModelCapability, CapabilityDetail>;
  latencyMs?: number | undefined;
  availabilityStatus: 'available' | 'degraded' | 'unavailable';
  probedAt: string;
};

export type ModelCostMetadata = {
  promptPerMillion?: number | undefined;
  completionPerMillion?: number | undefined;
};

export type ModelDescriptor = {
  provider: string;
  model: string;
  capabilities: readonly ModelCapability[];
  capabilityDetails?: Record<string, CapabilityDetail> | undefined;
  contextWindow?: number | undefined;
  costMetadata?: ModelCostMetadata | undefined;
  latencyMs?: number | undefined;
  isRecommended?: boolean | undefined;
  isDefault?: boolean | undefined;
  availabilityStatus?: 'available' | 'degraded' | 'unavailable' | undefined;
  lastVerifiedAt?: string | undefined;
};

export type ChatContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; imageUrl: { url: string } };

export type ToolCallDefinition = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type ModelToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string | undefined;
    parameters?: Record<string, unknown> | undefined;
  };
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | readonly ChatContentPart[];
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: readonly ToolCallDefinition[] | undefined;
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
  tools?: readonly ModelToolDefinition[] | undefined;
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } } | undefined;
};

export type ChatCompletionResponse = {
  id: string;
  model: string;
  content: string;
  toolCalls?: readonly ToolCallDefinition[] | undefined;
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
  probeModel?(
    model: string,
    options?: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } | undefined,
  ): Promise<CapabilityProbeResult>;
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
