export type ResearchDepth = 'quick' | 'standard' | 'deep';

export type ResearchStatus =
  | 'queued'
  | 'planning'
  | 'waiting_plan_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SubQuestionStatus =
  | 'waiting'
  | 'searching'
  | 'reading'
  | 'extracting'
  | 'completed';

export interface ResearchSubQuestionState {
  id: string;
  question: string;
  rationale?: string | undefined;
  searchQueries: string[];
  status: SubQuestionStatus;
}

export interface ResearchPlanView {
  subQuestions: ResearchSubQuestionState[];
  approved?: boolean | undefined;
}

export interface ResearchSourceItem {
  id: string;
  url: string;
  title: string;
  domain: string;
  initials: string;
  credibilityScore: number;
  snippet?: string | undefined;
  fetchStatus?: string | undefined;
}

export interface ResearchEvidenceItem {
  id: string;
  sourceId: string;
  statement: string;
  claimType: string;
  quote?: string | undefined;
  confidence: number;
}

export interface ResearchReportData {
  title: string;
  contentMarkdown: string;
  confidenceBySection: Record<string, number>;
  gaps: string[];
  limitations: string[];
  summary: string;
}

export interface ResearchBudgetConfig {
  maxSearches: number;
  maxPagesRead: number;
  maxModelTokens: number;
  maxDurationMs: number;
}

export interface ResearchBudgetUsed {
  searchesCount: number;
  pagesReadCount: number;
  modelTokensCount: number;
  durationMs: number;
}

export interface ResearchProgressState {
  runId: string;
  status: ResearchStatus;
  query: string;
  depth: ResearchDepth;
  plan?: ResearchPlanView | undefined;
  subQuestions: ResearchSubQuestionState[];
  sources: ResearchSourceItem[];
  evidence: ResearchEvidenceItem[];
  report?: ResearchReportData | undefined;
  budgetConfig: ResearchBudgetConfig;
  budgetUsed: ResearchBudgetUsed;
  error?: string | null | undefined;
  seenEventIds: string[];
  lastEventId?: string | undefined;
  updatedAt: number;
}

export interface ResearchRunSummary {
  id: string;
  userId: string;
  projectId: string;
  query: string;
  scope: string;
  depth: ResearchDepth;
  status: ResearchStatus;
  budgetConfig: ResearchBudgetConfig;
  budgetUsed: ResearchBudgetUsed;
  plan?: ResearchPlanView | undefined;
  createdAt: string;
  updatedAt: string;
}
