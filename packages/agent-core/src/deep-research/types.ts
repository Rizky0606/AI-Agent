import type { EvaluationResult, ResearchSource } from '@personal-ai-os/evaluator';

export type ResearchDepth = 'quick' | 'standard' | 'deep';

export interface BudgetConfig {
  maxSearches: number;
  maxPagesRead: number;
  maxModelTokens: number;
  maxDurationMs: number;
}

export interface BudgetUsed {
  searchesCount: number;
  pagesReadCount: number;
  modelTokensCount: number;
  durationMs: number;
}

export const DEFAULT_BUDGET_BY_DEPTH: Record<ResearchDepth, BudgetConfig> = {
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
    maxModelTokens: 100000,
    maxDurationMs: 600000,
  },
};

export interface SubQuestion {
  id: string;
  question: string;
  rationale: string;
  searchQueries: string[];
}

export interface ResearchPlan {
  subQuestions: SubQuestion[];
  approved: boolean;
}

export interface ExtractedEvidenceItem {
  id: string;
  sourceId: string;
  statement: string;
  claimType: 'sourced_fact' | 'inference' | 'unverified';
  quote?: string | undefined;
  confidence: number;
}

export type DeepResearchEventType =
  | 'research.plan'
  | 'research.search'
  | 'research.source'
  | 'research.evidence'
  | 'research.draft'
  | 'research.verify'
  | 'research.done';

export interface DeepResearchEvent {
  type: DeepResearchEventType;
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface DeepResearchRunInput {
  runId: string;
  userId: string;
  projectId: string;
  query: string;
  scope?: string | undefined;
  language?: string | undefined;
  depth?: ResearchDepth | undefined;
  customBudget?: Partial<BudgetConfig> | undefined;
  requirePlanApproval?: boolean | undefined;
  initialPlan?: ResearchPlan | undefined;
  checkpoint?: DeepResearchCheckpoint | undefined;
}

export interface DeepResearchCheckpoint {
  stage: 'brief' | 'plan' | 'collect' | 'read' | 'extract' | 'synthesize' | 'verify' | 'completed';
  stepIndex: number;
  plan?: ResearchPlan | undefined;
  sources?: ResearchSource[] | undefined;
  evidence?: ExtractedEvidenceItem[] | undefined;
  budgetUsed?: BudgetUsed | undefined;
}

export interface DeepResearchRunOutput {
  runId: string;
  status: 'completed' | 'waiting_plan_approval' | 'failed' | 'cancelled';
  plan?: ResearchPlan | undefined;
  sources: ResearchSource[];
  evidence: ExtractedEvidenceItem[];
  report?:
    | {
        title: string;
        contentMarkdown: string;
        confidenceBySection: Record<string, number>;
        gaps: string[];
        limitations: string[];
        summary: string;
      }
    | undefined;
  budgetUsed: BudgetUsed;
  evaluationResult?: EvaluationResult | undefined;
  error?: string | undefined;
}
