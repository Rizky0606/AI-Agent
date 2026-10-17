export interface CompareRunInput {
  runId: string;
  userId: string;
  projectId: string;
  prompt: string;
  models: string[];
  blindMode?: boolean | undefined;
  tokenBudget?: number | undefined;
  synthesisModel?: string | undefined;
}

export interface CompareColumnResult {
  columnIndex: number;
  modelId: string;
  modelAlias: string;
  content: string;
  status: 'completed' | 'failed';
  error?: string | undefined;
  latencyMs?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
  cost?: number | undefined;
}

export type CompareEngineEvent =
  | {
      type: 'compare.started';
      runId: string;
      modelsCount: number;
      blindMode: boolean;
      timestamp: number;
    }
  | {
      type: 'compare.chunk';
      runId: string;
      columnIndex: number;
      delta: string;
      timestamp: number;
    }
  | {
      type: 'compare.model_completed';
      runId: string;
      columnIndex: number;
      latencyMs?: number | undefined;
      promptTokens?: number | undefined;
      completionTokens?: number | undefined;
      totalTokens?: number | undefined;
      cost?: number | undefined;
      content: string;
      timestamp: number;
    }
  | {
      type: 'compare.model_failed';
      runId: string;
      columnIndex: number;
      error: string;
      timestamp: number;
    }
  | {
      type: 'compare.completed';
      runId: string;
      totalTokensUsed: number;
      timestamp: number;
    }
  | {
      type: 'compare.synthesis_chunk';
      runId: string;
      delta: string;
      timestamp: number;
    }
  | {
      type: 'compare.synthesis_completed';
      runId: string;
      content: string;
      model: string;
      usage?: {
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        totalTokens?: number | undefined;
      } | undefined;
      timestamp: number;
    }
  | {
      type: 'compare.synthesis_failed';
      runId: string;
      error: string;
      timestamp: number;
    };

export interface CompareEngineOptions {
  signal?: AbortSignal | undefined;
  onEvent?: ((event: CompareEngineEvent) => Promise<void> | void) | undefined;
}

export interface CompareExecutionResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  columns: CompareColumnResult[];
  totalTokensUsed: number;
  error?: string | undefined;
}

export interface CompareSynthesisResult {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    totalTokens?: number | undefined;
  } | undefined;
}
