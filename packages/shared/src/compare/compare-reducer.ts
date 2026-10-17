import type { TaskEventEnvelope } from '../tasks/types.ts';
import type { CompareAction, CompareRunData, CompareRunDetail, CompareResultItem, CompareColumnResult } from './types.ts';

type ItemLike = CompareResultItem | CompareColumnResult;

function findMatchingResultIndex(results: ItemLike[], identifier: {
  columnIndex?: number | undefined;
  modelId?: string | undefined;
  columnLabel?: string | undefined;
}): number {
  if (identifier.columnIndex !== undefined) {
    const idx = results.findIndex((r) => r.columnIndex === identifier.columnIndex);
    if (idx !== -1) return idx;
  }
  if (identifier.columnLabel !== undefined) {
    const idx = results.findIndex((r) => {
      const label = ('columnLabel' in r && r.columnLabel) ? r.columnLabel : ('modelAlias' in r ? r.modelAlias : undefined);
      return label === identifier.columnLabel;
    });
    if (idx !== -1) return idx;
  }
  if (identifier.modelId !== undefined && identifier.modelId !== '') {
    const idx = results.findIndex((r) => r.modelId === identifier.modelId);
    if (idx !== -1) return idx;
  }
  if (identifier.columnIndex !== undefined && identifier.columnIndex < results.length) {
    return identifier.columnIndex;
  }
  return -1;
}

export interface GenericEventLike {
  eventType?: string | undefined;
  type?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}

export const compareReducer = <T extends CompareRunData | CompareRunDetail | null>(
  state: T,
  actionOrEvent: CompareAction | TaskEventEnvelope | GenericEventLike,
): T => {
  if (!state) {
    if (actionOrEvent && ('type' in actionOrEvent) && actionOrEvent.type === 'SET_RUN') {
      return (actionOrEvent as { type: 'SET_RUN'; payload: T }).payload;
    }
    return null as T;
  }

  // Handle TaskEventEnvelope (WSS events like compare.chunk, compare.model_failed, etc.)
  const eventLike = actionOrEvent as GenericEventLike;
  const eventType = eventLike.eventType ?? eventLike.type;
  const payload = eventLike.payload ?? {};

  if (eventType && typeof eventType === 'string' && eventType.startsWith('compare.')) {
    switch (eventType) {
      case 'compare.started': {
        return {
          ...state,
          status: 'running',
          updatedAt: new Date().toISOString(),
        };
      }

      case 'compare.chunk': {
        const columnIndex = typeof payload['columnIndex'] === 'number' ? payload['columnIndex'] : undefined;
        const modelId = typeof payload['modelId'] === 'string' ? payload['modelId'] : undefined;
        const columnLabel = typeof payload['columnLabel'] === 'string' ? payload['columnLabel'] : undefined;
        const delta = typeof payload['delta'] === 'string' ? payload['delta'] : '';

        const targetIdx = findMatchingResultIndex(state.results as ItemLike[], { columnIndex, modelId, columnLabel });
        if (targetIdx === -1) return state;

        const updatedResults = (state.results as ItemLike[]).map((res, idx) => {
          if (idx === targetIdx) {
            return {
              ...res,
              content: (res.content ?? '') + delta,
              status: res.status === 'completed' ? res.status : 'streaming',
            };
          }
          return res;
        });

        return {
          ...state,
          results: updatedResults,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.model_completed': {
        const columnIndex = typeof payload['columnIndex'] === 'number' ? payload['columnIndex'] : undefined;
        const modelId = typeof payload['modelId'] === 'string' ? payload['modelId'] : undefined;
        const columnLabel = typeof payload['columnLabel'] === 'string' ? payload['columnLabel'] : undefined;
        const latencyMs = typeof payload['latencyMs'] === 'number' ? payload['latencyMs'] : undefined;
        const promptTokens = typeof payload['promptTokens'] === 'number' ? payload['promptTokens'] : undefined;
        const completionTokens = typeof payload['completionTokens'] === 'number' ? payload['completionTokens'] : undefined;
        const totalTokens = typeof payload['totalTokens'] === 'number' ? payload['totalTokens'] : undefined;
        const cost = typeof payload['cost'] === 'number' ? payload['cost'] : undefined;
        const estimatedCostUsd = typeof payload['estimatedCostUsd'] === 'number' ? payload['estimatedCostUsd'] : cost;
        const content = typeof payload['content'] === 'string' ? payload['content'] : undefined;

        const targetIdx = findMatchingResultIndex(state.results as ItemLike[], { columnIndex, modelId, columnLabel });
        if (targetIdx === -1) return state;

        const updatedResults = (state.results as ItemLike[]).map((res, idx) => {
          if (idx === targetIdx) {
            return {
              ...res,
              content: content !== undefined ? content : res.content,
              status: 'completed' as const,
              latencyMs: latencyMs ?? res.latencyMs,
              promptTokens: promptTokens ?? res.promptTokens,
              completionTokens: completionTokens ?? res.completionTokens,
              totalTokens: totalTokens ?? res.totalTokens,
              cost: cost ?? ('cost' in res ? res.cost : undefined),
              estimatedCostUsd: estimatedCostUsd ?? ('estimatedCostUsd' in res ? res.estimatedCostUsd : cost),
            };
          }
          return res;
        });

        const allFinished = updatedResults.every(
          (r) => r.status === 'completed' || r.status === 'failed',
        );

        return {
          ...state,
          status: allFinished ? 'completed' : state.status,
          results: updatedResults,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.model_failed': {
        const columnIndex = typeof payload['columnIndex'] === 'number' ? payload['columnIndex'] : undefined;
        const modelId = typeof payload['modelId'] === 'string' ? payload['modelId'] : undefined;
        const columnLabel = typeof payload['columnLabel'] === 'string' ? payload['columnLabel'] : undefined;
        const error = typeof payload['error'] === 'string' ? payload['error'] : 'Model gagal merespons.';

        const targetIdx = findMatchingResultIndex(state.results as ItemLike[], { columnIndex, modelId, columnLabel });
        if (targetIdx === -1) return state;

        const updatedResults = (state.results as ItemLike[]).map((res, idx) => {
          if (idx === targetIdx) {
            return {
              ...res,
              status: 'failed' as const,
              error,
            };
          }
          return res;
        });

        const allFinished = updatedResults.every(
          (r) => r.status === 'completed' || r.status === 'failed',
        );

        return {
          ...state,
          status: allFinished ? 'completed' : state.status,
          results: updatedResults,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.revealed': {
        const isRevealed = typeof payload['isRevealed'] === 'boolean' ? payload['isRevealed'] : true;
        const results = Array.isArray(payload['results']) ? (payload['results'] as ItemLike[]) : undefined;
        const mapping = (payload['mapping'] && typeof payload['mapping'] === 'object')
          ? (payload['mapping'] as Record<number, string>)
          : undefined;

        let updatedResults = state.results as ItemLike[];

        if (results && results.length > 0) {
          updatedResults = results;
        } else if (mapping) {
          updatedResults = (state.results as ItemLike[]).map((res, idx) => {
            const mapped = mapping[idx] ?? (res.columnIndex !== undefined ? mapping[res.columnIndex] : undefined);
            if (mapped !== undefined) {
              return { ...res, modelId: mapped };
            }
            return res;
          });
        }

        return {
          ...state,
          isRevealed,
          revealed: true,
          results: updatedResults,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.winner_selected': {
        const winnerModelId = typeof payload['winnerModelId'] === 'string' ? payload['winnerModelId'] : undefined;
        const isRevealed = typeof payload['isRevealed'] === 'boolean' ? payload['isRevealed'] : true;
        const results = Array.isArray(payload['results']) ? (payload['results'] as ItemLike[]) : undefined;
        const mapping = (payload['mapping'] && typeof payload['mapping'] === 'object')
          ? (payload['mapping'] as Record<number, string>)
          : undefined;

        let updatedResults = state.results as ItemLike[];

        if (results && results.length > 0) {
          updatedResults = results;
        } else {
          updatedResults = (state.results as ItemLike[]).map((res: ItemLike, idx: number): ItemLike => {
            const mapped = mapping ? (mapping[idx] ?? (res.columnIndex !== undefined ? mapping[res.columnIndex] : undefined)) : undefined;
            const modelId = mapped !== undefined ? mapped : res.modelId;
            return {
              ...res,
              modelId,
              isWinner: modelId === winnerModelId,
            };
          });
        }

        return {
          ...state,
          winnerModelId: winnerModelId ?? state.winnerModelId,
          isRevealed,
          revealed: true,
          results: updatedResults,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.synthesis': {
        const synthesis = typeof payload['synthesis'] === 'string' ? payload['synthesis'] : undefined;
        const synthesisModelId = typeof payload['synthesisModelId'] === 'string' ? payload['synthesisModelId'] : undefined;

        return {
          ...state,
          synthesis: synthesis ?? (('synthesis' in state && typeof state.synthesis === 'string') ? state.synthesis : null),
          synthesisModelId: synthesisModelId ?? (('synthesisModelId' in state) ? state.synthesisModelId : null),
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.completed': {
        const completedAt = typeof payload['completedAt'] === 'string' ? payload['completedAt'] : new Date().toISOString();
        return {
          ...state,
          status: 'completed',
          completedAt,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      case 'compare.failed': {
        const error = typeof payload['error'] === 'string' ? payload['error'] : undefined;
        return {
          ...state,
          status: 'failed',
          error,
          updatedAt: new Date().toISOString(),
        } as T;
      }

      default:
        return state;
    }
  }

  // Handle standard CompareAction objects
  const action = actionOrEvent as CompareAction;
  switch (action.type) {
    case 'SET_RUN': {
      return action.payload as T;
    }

    case 'STREAM_CHUNK': {
      const { columnIndex, delta, modelId, columnLabel } = action.payload;
      const targetIdx = findMatchingResultIndex(state.results as ItemLike[], { columnIndex, modelId, columnLabel });
      if (targetIdx === -1) return state;

      const updatedResults = (state.results as ItemLike[]).map((res, idx) => {
        if (idx === targetIdx) {
          return {
            ...res,
            content: (res.content ?? '') + delta,
            status: 'streaming' as const,
          };
        }
        return res;
      });
      return {
        ...state,
        results: updatedResults,
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'MODEL_COMPLETED': {
      const { columnIndex, modelId, columnLabel, latencyMs, promptTokens, completionTokens, totalTokens, cost, content } =
        action.payload;
      const targetIdx = findMatchingResultIndex(state.results as ItemLike[], { columnIndex, modelId, columnLabel });
      if (targetIdx === -1) return state;

      const updatedResults = (state.results as ItemLike[]).map((res, idx) => {
        if (idx === targetIdx) {
          return {
            ...res,
            content: content !== undefined ? content : res.content,
            status: 'completed' as const,
            latencyMs: latencyMs ?? res.latencyMs,
            promptTokens: promptTokens ?? res.promptTokens,
            completionTokens: completionTokens ?? res.completionTokens,
            totalTokens: totalTokens ?? res.totalTokens,
            cost: cost ?? ('cost' in res ? res.cost : undefined),
          };
        }
        return res;
      });

      const allFinished = updatedResults.every(
        (r) => r.status === 'completed' || r.status === 'failed',
      );

      const tokensSum = updatedResults.reduce(
        (acc: number, curr) => acc + (curr.totalTokens ?? 0),
        0,
      );

      return {
        ...state,
        status: allFinished ? 'completed' : state.status,
        results: updatedResults,
        totalTokensUsed: tokensSum > 0 ? tokensSum : ('totalTokensUsed' in state ? state.totalTokensUsed : 0),
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'MODEL_FAILED': {
      const { columnIndex, modelId, columnLabel, error } = action.payload;
      const targetIdx = findMatchingResultIndex(state.results as ItemLike[], { columnIndex, modelId, columnLabel });
      if (targetIdx === -1) return state;

      const updatedResults = (state.results as ItemLike[]).map((res, idx) => {
        if (idx === targetIdx) {
          return {
            ...res,
            status: 'failed' as const,
            error,
          };
        }
        return res;
      });

      const allFinished = updatedResults.every(
        (r) => r.status === 'completed' || r.status === 'failed',
      );

      return {
        ...state,
        status: allFinished ? 'completed' : state.status,
        results: updatedResults,
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'RUN_COMPLETED': {
      return {
        ...state,
        status: 'completed',
        totalTokensUsed: action.payload.totalTokensUsed ?? ('totalTokensUsed' in state ? state.totalTokensUsed : 0),
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'RUN_FAILED': {
      return {
        ...state,
        status: 'failed',
        error: action.payload.error,
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'REVEAL': {
      const { mapping, results } = action.payload;
      let updatedResults = state.results as ItemLike[];

      if (Array.isArray(results) && results.length > 0) {
        updatedResults = results as ItemLike[];
      } else if (mapping) {
        updatedResults = (state.results as ItemLike[]).map((res, idx) => {
          const mapped = mapping[idx] ?? (res.columnIndex !== undefined ? mapping[res.columnIndex] : undefined);
          if (mapped !== undefined) {
            return { ...res, modelId: mapped };
          }
          return res;
        });
      }

      return {
        ...state,
        isRevealed: true,
        revealed: true,
        results: updatedResults,
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'SET_WINNER': {
      const { winnerModelId, winnerResultId, mapping, results } = action.payload;
      let updatedResults = state.results as ItemLike[];

      if (Array.isArray(results) && results.length > 0) {
        updatedResults = results as ItemLike[];
      } else {
        updatedResults = (state.results as ItemLike[]).map((res: ItemLike, idx: number): ItemLike => {
          const matchesId = winnerResultId ? ('id' in res && res.id === winnerResultId) : false;
          const mapped = mapping ? (mapping[idx] ?? (res.columnIndex !== undefined ? mapping[res.columnIndex] : undefined)) : undefined;
          const modelId = mapped !== undefined ? mapped : res.modelId;
          const matchesModel = modelId === winnerModelId;
          const isWinner = matchesId || matchesModel;

          return {
            ...res,
            isWinner,
            modelId,
          };
        });
      }

      return {
        ...state,
        winnerModelId,
        isRevealed: true,
        revealed: true,
        results: updatedResults,
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'SYNTHESIS_START': {
      if ('synthesis' in state && typeof state.synthesis === 'string') {
        return state;
      }
      return {
        ...state,
        synthesis: {
          status: 'running' as const,
          model: action.payload.model,
          content: '',
        },
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'SYNTHESIS_CHUNK': {
      if ('synthesis' in state && typeof state.synthesis === 'string') {
        return {
          ...state,
          synthesis: state.synthesis + action.payload.delta,
          updatedAt: new Date().toISOString(),
        } as T;
      }
      const existing = ('synthesis' in state && state.synthesis && typeof state.synthesis === 'object')
        ? state.synthesis
        : { status: 'running' as const, content: '' };

      return {
        ...state,
        synthesis: {
          ...existing,
          status: 'running' as const,
          content: (existing.content ?? '') + action.payload.delta,
        },
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'SYNTHESIS_COMPLETED': {
      if ('synthesis' in state && (typeof state.synthesis === 'string' || state.synthesis === null)) {
        return {
          ...state,
          synthesis: action.payload.content,
          synthesisModelId: action.payload.model ?? (('synthesisModelId' in state) ? state.synthesisModelId : null),
          updatedAt: new Date().toISOString(),
        } as T;
      }
      return {
        ...state,
        synthesis: {
          status: 'completed' as const,
          model: action.payload.model,
          content: action.payload.content,
          usage: action.payload.usage,
        },
        updatedAt: new Date().toISOString(),
      } as T;
    }

    case 'SYNTHESIS_FAILED': {
      if ('synthesis' in state && (typeof state.synthesis === 'string' || state.synthesis === null)) {
        return {
          ...state,
          error: action.payload.error,
          updatedAt: new Date().toISOString(),
        } as T;
      }
      return {
        ...state,
        synthesis: {
          status: 'failed' as const,
          error: action.payload.error,
        },
        updatedAt: new Date().toISOString(),
      } as T;
    }

    default:
      return state;
  }
};
