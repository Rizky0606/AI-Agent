import { extractDomainInitials } from './citations.ts';
import type {
  ResearchBudgetConfig,
  ResearchDepth,
  ResearchProgressState,
  ResearchSourceItem,
  ResearchSubQuestionState,
} from './types.ts';

export const DEFAULT_BUDGET_ESTIMATES: Record<ResearchDepth, ResearchBudgetConfig> = {
  quick: {
    maxSearches: 2,
    maxPagesRead: 3,
    maxModelTokens: 15000,
    maxDurationMs: 60000,
  },
  standard: {
    maxSearches: 5,
    maxPagesRead: 8,
    maxModelTokens: 40000,
    maxDurationMs: 180000,
  },
  deep: {
    maxSearches: 12,
    maxPagesRead: 20,
    maxModelTokens: 120000,
    maxDurationMs: 600000,
  },
};

export interface GenericResearchEvent {
  id?: string | undefined;
  taskId?: string | undefined;
  runId?: string | undefined;
  eventType?: string | undefined;
  type?: string | undefined;
  payload?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
  createdAt?: string | undefined;
  timestamp?: string | undefined;
}

export function createInitialResearchProgressState(params: {
  runId: string;
  query: string;
  depth?: ResearchDepth | undefined;
  budgetConfig?: Partial<ResearchBudgetConfig> | undefined;
}): ResearchProgressState {
  const depth = params.depth ?? 'standard';
  const baseBudget = DEFAULT_BUDGET_ESTIMATES[depth];

  return {
    runId: params.runId,
    status: 'queued',
    query: params.query,
    depth,
    subQuestions: [],
    sources: [],
    evidence: [],
    budgetConfig: {
      maxSearches: params.budgetConfig?.maxSearches ?? baseBudget.maxSearches,
      maxPagesRead: params.budgetConfig?.maxPagesRead ?? baseBudget.maxPagesRead,
      maxModelTokens: params.budgetConfig?.maxModelTokens ?? baseBudget.maxModelTokens,
      maxDurationMs: params.budgetConfig?.maxDurationMs ?? baseBudget.maxDurationMs,
    },
    budgetUsed: {
      searchesCount: 0,
      pagesReadCount: 0,
      modelTokensCount: 0,
      durationMs: 0,
    },
    seenEventIds: [],
    updatedAt: Date.now(),
  };
}

/**
 * Pure reducer untuk event riset dengan proteksi:
 * 1. Supresi event duplikat (idempotensi).
 * 2. Ketahanan terhadap urutan terbalik (out-of-order) — terminal status tidak bisa diregresi.
 * 3. Replay safety saat reconnect WebSocket (Sesi 18/20).
 */
export function reduceResearchProgress(
  state: ResearchProgressState,
  event: GenericResearchEvent,
): ResearchProgressState {
  const eventId = event.id ?? `${event.eventType ?? event.type}-${event.createdAt ?? event.timestamp ?? Date.now()}`;
  const eventType = event.eventType ?? event.type ?? '';
  const payload = event.payload ?? event.data ?? {};

  // 1. Deduplikasi: jika event ID sudah pernah diproses, abaikan
  if (state.seenEventIds.includes(eventId)) {
    return state;
  }

  const seenEventIds = [...state.seenEventIds, eventId];
  const newState: ResearchProgressState = {
    ...state,
    seenEventIds,
    lastEventId: eventId,
    updatedAt: Date.now(),
  };

  // 2. Proteksi Out-of-Order Terminal State: jika sudah selesai/batal/gagal, tidak boleh regresi ke running
  const isTerminal = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';

  // 3. Update budget terpakai jika ada pada payload
  if (payload['budgetUsed'] && typeof payload['budgetUsed'] === 'object') {
    const bu = payload['budgetUsed'] as Record<string, unknown>;
    newState.budgetUsed = {
      searchesCount: typeof bu['searchesCount'] === 'number' ? bu['searchesCount'] : newState.budgetUsed.searchesCount,
      pagesReadCount: typeof bu['pagesReadCount'] === 'number' ? bu['pagesReadCount'] : newState.budgetUsed.pagesReadCount,
      modelTokensCount: typeof bu['modelTokensCount'] === 'number' ? bu['modelTokensCount'] : newState.budgetUsed.modelTokensCount,
      durationMs: typeof bu['durationMs'] === 'number' ? bu['durationMs'] : newState.budgetUsed.durationMs,
    };
  }

  switch (eventType) {
    case 'research.started': {
      if (!isTerminal && newState.status === 'queued') {
        newState.status = 'running';
      }
      break;
    }

    case 'research.plan':
    case 'research.plan_generated': {
      const plan = payload['plan'] as { subQuestions?: Array<{ id: string; question: string; rationale?: string; searchQueries?: string[] }>; approved?: boolean } | undefined;
      if (plan?.subQuestions && Array.isArray(plan.subQuestions)) {
        const subQuestions: ResearchSubQuestionState[] = plan.subQuestions.map((sq) => {
          const existing = state.subQuestions.find((s) => s.id === sq.id);
          return {
            id: sq.id,
            question: sq.question,
            rationale: sq.rationale,
            searchQueries: sq.searchQueries ?? [],
            status: existing ? existing.status : 'waiting',
          };
        });

        const isDeepAndNotApproved = (newState.depth === 'deep' || payload['requirePlanApproval']) && !plan.approved;
        if (!isTerminal) {
          newState.status = isDeepAndNotApproved ? 'waiting_plan_approval' : 'running';
        }
        newState.plan = {
          subQuestions,
          approved: plan.approved,
        };
        newState.subQuestions = subQuestions;
      }
      break;
    }

    case 'research.search': {
      if (!isTerminal && newState.status !== 'waiting_plan_approval') {
        newState.status = 'running';
      }
      const query = typeof payload['query'] === 'string' ? payload['query'] : '';
      if (typeof payload['searchesExecuted'] === 'number') {
        newState.budgetUsed.searchesCount = payload['searchesExecuted'];
      } else {
        newState.budgetUsed.searchesCount = Math.max(newState.budgetUsed.searchesCount, 1);
      }

      // Tandai sub-pertanyaan pertama yang berstatus waiting/searching sebagai searching
      let marked = false;
      newState.subQuestions = newState.subQuestions.map((sq) => {
        if (!marked && (sq.searchQueries.includes(query) || sq.status === 'waiting')) {
          marked = true;
          return { ...sq, status: 'searching' };
        }
        return sq;
      });
      break;
    }

    case 'research.source':
    case 'research.source_discovered': {
      const source = payload['source'] as {
        id?: string;
        url?: string;
        title?: string;
        domain?: string;
        credibilityScore?: number;
        snippet?: string;
        fetchStatus?: string;
      } | undefined;

      if (source?.url) {
        const sourceId = source.id ?? `src-${newState.sources.length + 1}`;
        const domain = source.domain ?? new URL(source.url).hostname;
        const exists = newState.sources.some((s) => s.id === sourceId || s.url === source.url);

        if (!exists) {
          const newSource: ResearchSourceItem = {
            id: sourceId,
            url: source.url,
            title: source.title ?? domain,
            domain,
            initials: extractDomainInitials(domain),
            credibilityScore: source.credibilityScore ?? 0.7,
            snippet: source.snippet,
            fetchStatus: source.fetchStatus ?? 'fetched',
          };
          newState.sources = [...newState.sources, newSource];
        }

        // Tandai sub-pertanyaan yang aktif sebagai reading
        let marked = false;
        newState.subQuestions = newState.subQuestions.map((sq) => {
          if (!marked && sq.status === 'searching') {
            marked = true;
            return { ...sq, status: 'reading' };
          }
          return sq;
        });
      }
      break;
    }

    case 'research.evidence':
    case 'research.evidence_extracted': {
      const ev = payload['evidence'] as {
        id?: string;
        sourceId?: string;
        statement?: string;
        claimType?: string;
        quote?: string;
        confidence?: number;
      } | undefined;

      if (ev?.statement) {
        const evId = ev.id ?? `ev-${newState.evidence.length + 1}`;
        const exists = newState.evidence.some((e) => e.id === evId);
        if (!exists) {
          newState.evidence = [
            ...newState.evidence,
            {
              id: evId,
              sourceId: ev.sourceId ?? 'src-1',
              statement: ev.statement,
              claimType: ev.claimType ?? 'sourced_fact',
              quote: ev.quote ? ev.quote.slice(0, 200) : undefined,
              confidence: ev.confidence ?? 0.8,
            },
          ];
        }

        // Tandai sub-pertanyaan aktif sebagai extracting
        let marked = false;
        newState.subQuestions = newState.subQuestions.map((sq) => {
          if (!marked && (sq.status === 'reading' || sq.status === 'searching')) {
            marked = true;
            return { ...sq, status: 'extracting' };
          }
          return sq;
        });
      }
      break;
    }

    case 'research.draft':
    case 'research.verify': {
      // Menjelang sintesis atau verifikasi, tandai seluruh sub-pertanyaan selesai
      newState.subQuestions = newState.subQuestions.map((sq) => ({
        ...sq,
        status: 'completed',
      }));
      break;
    }

    case 'research.plan_approved': {
      if (!isTerminal) {
        newState.status = 'running';
      }
      if (newState.plan) {
        newState.plan.approved = true;
      }
      break;
    }

    case 'research.cancelled': {
      newState.status = 'cancelled';
      break;
    }

    case 'research.completed':
    case 'research.done': {
      const passed = payload['passed'] !== false;
      newState.status = passed ? 'completed' : 'failed';
      newState.subQuestions = newState.subQuestions.map((sq) => ({ ...sq, status: 'completed' }));

      if (payload['report'] && typeof payload['report'] === 'object') {
        const rep = payload['report'] as Record<string, unknown>;
        newState.report = {
          title: (typeof rep['title'] === 'string' ? rep['title'] : undefined) ?? `Laporan Riset: ${newState.query}`,
          contentMarkdown: typeof rep['contentMarkdown'] === 'string' ? rep['contentMarkdown'] : '',
          confidenceBySection: (rep['confidenceBySection'] && typeof rep['confidenceBySection'] === 'object'
            ? (rep['confidenceBySection'] as Record<string, number>)
            : {}),
          gaps: Array.isArray(rep['gaps']) ? (rep['gaps'] as string[]) : [],
          limitations: Array.isArray(rep['limitations']) ? (rep['limitations'] as string[]) : [],
          summary: typeof rep['summary'] === 'string' ? rep['summary'] : '',
        };
      }
      break;
    }

    case 'research.error': {
      newState.status = 'failed';
      newState.error = typeof payload['error'] === 'string' ? payload['error'] : 'Terjadi kesalahan pada riset.';
      break;
    }
  }

  return newState;
}
