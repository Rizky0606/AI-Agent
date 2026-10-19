export type CompareRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CompareResultStatus = 'pending' | 'running' | 'streaming' | 'completed' | 'failed';

export type CompareSynthesisStatus = 'none' | 'running' | 'completed' | 'failed';

export interface CompareResultItem {
  id: string;
  columnIndex: number;
  modelAlias: string;
  modelId?: string | undefined;
  content: string;
  status: CompareResultStatus;
  error?: string | null | undefined;
  latencyMs?: number | null | undefined;
  promptTokens?: number | null | undefined;
  completionTokens?: number | null | undefined;
  totalTokens?: number | null | undefined;
  cost?: number | null | undefined;
  isWinner: boolean;
}

export interface CompareSynthesis {
  status: CompareSynthesisStatus;
  model?: string | undefined;
  content?: string | undefined;
  usage?: {
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    totalTokens?: number | undefined;
  } | undefined;
  error?: string | undefined;
}

export interface CompareRunData {
  id: string;
  userId: string;
  projectId: string;
  prompt: string;
  blindMode: boolean;
  revealed: boolean;
  status: CompareRunStatus;
  winnerModelId?: string | null | undefined;
  synthesis?: CompareSynthesis | undefined;
  tokenBudget: number;
  totalTokensUsed: number;
  results: CompareResultItem[];
  createdAt: string;
  updatedAt: string;
  error?: string | null | undefined;
}

export interface CompareColumnResult {
  id?: string | undefined;
  columnIndex?: number | undefined;
  modelId?: string | undefined;
  columnLabel: string;
  provider?: string | undefined;
  content: string;
  status: CompareResultStatus;
  error?: string | null | undefined;
  latencyMs?: number | null | undefined;
  promptTokens?: number | null | undefined;
  completionTokens?: number | null | undefined;
  totalTokens?: number | null | undefined;
  cost?: number | null | undefined;
  estimatedCostUsd?: number | null | undefined;
  isWinner?: boolean | undefined;
}

export interface CompareRunDetail {
  id: string;
  userId: string;
  projectId?: string | undefined;
  prompt: string;
  blindMode: boolean;
  isRevealed: boolean;
  revealed?: boolean | undefined;
  status: CompareRunStatus;
  winnerModelId: string | null;
  synthesis: string | null;
  synthesisModelId: string | null;
  results: CompareColumnResult[];
  createdAt: string;
  completedAt: string | null;
  error?: string | null | undefined;
  totalTokensUsed?: number | undefined;
}

export interface CompareRunSummary {
  id: string;
  userId?: string | undefined;
  projectId?: string | undefined;
  prompt: string;
  modelIds: string[];
  blindMode: boolean;
  revealed?: boolean | undefined;
  isRevealed?: boolean | undefined;
  status: CompareRunStatus;
  winnerModelId?: string | null | undefined;
  modelsCount?: number | undefined;
  tokenBudget?: number | undefined;
  totalTokensUsed?: number | undefined;
  createdAt: string;
  completedAt?: string | null | undefined;
}

export interface CreateCompareRequest {
  projectId?: string | undefined;
  prompt: string;
  modelIds: string[];
  blindMode?: boolean | undefined;
  requestSynthesis?: boolean | undefined;
  tokenBudget?: number | undefined;
}

export interface PromoteCompareResponse {
  conversationId: string;
  messageId: string;
  modelId: string;
}

export type CompareAction =
  | { type: 'SET_RUN'; payload: CompareRunData | CompareRunDetail }
  | { type: 'STREAM_CHUNK'; payload: { columnIndex?: number; modelId?: string; columnLabel?: string; delta: string } }
  | {
      type: 'MODEL_COMPLETED';
      payload: {
        columnIndex?: number;
        modelId?: string;
        columnLabel?: string;
        latencyMs?: number | undefined;
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        totalTokens?: number | undefined;
        cost?: number | undefined;
        estimatedCostUsd?: number | undefined;
        content?: string | undefined;
      };
    }
  | { type: 'MODEL_FAILED'; payload: { columnIndex?: number; modelId?: string; columnLabel?: string; error: string } }
  | { type: 'RUN_COMPLETED'; payload: { totalTokensUsed?: number | undefined } }
  | { type: 'RUN_FAILED'; payload: { error: string } }
  | { type: 'REVEAL'; payload: { mapping?: Record<number, string>; results?: CompareColumnResult[] | CompareResultItem[] } }
  | {
      type: 'SET_WINNER';
      payload: {
        winnerModelId: string;
        winnerResultId?: string | undefined;
        mapping?: Record<number, string> | undefined;
        results?: CompareColumnResult[] | CompareResultItem[];
      };
    }
  | { type: 'SYNTHESIS_START'; payload: { model: string } }
  | { type: 'SYNTHESIS_CHUNK'; payload: { delta: string } }
  | {
      type: 'SYNTHESIS_COMPLETED';
      payload: {
        content: string;
        model?: string | undefined;
        usage?: {
          promptTokens?: number | undefined;
          completionTokens?: number | undefined;
          totalTokens?: number | undefined;
        } | undefined;
      };
    }
  | { type: 'SYNTHESIS_FAILED'; payload: { error: string } };
