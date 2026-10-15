export type CriterionCategory = 'generic' | 'coding' | 'research';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  category: CriterionCategory;
  required: boolean;
  expectedEvidenceType?: string | undefined;
}

export interface GenericEvidence {
  logs?: readonly string[] | undefined;
  outputs?: Record<string, unknown> | undefined;
  artifacts?: readonly { title: string; content?: string }[] | undefined;
  explanation?: string | undefined;
}

export interface CodingEvidence {
  lintPassed?: boolean | undefined;
  lintOutput?: string | undefined;
  typecheckPassed?: boolean | undefined;
  typecheckOutput?: string | undefined;
  testsPassed?: boolean | undefined;
  testsPassedCount?: number | undefined;
  testsFailedCount?: number | undefined;
  testOutput?: string | undefined;
  buildPassed?: boolean | undefined;
  buildOutput?: string | undefined;
  diffAvailable?: boolean | undefined;
  diffSummary?: string | undefined;
  modifiedFiles?: readonly string[] | undefined;
  securityCheckPassed?: boolean | undefined;
  securityCheckDetails?: string | undefined;
  requirementCoverage?: number | undefined; // 0.0 to 1.0
  requirementIssues?: readonly string[] | undefined;
  selfClaimOnly?: boolean | undefined;
}

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  author?: string | undefined;
  publishedDate?: string | undefined;
  domain: string;
  snippet: string;
  credibilityScore: number; // 0.0 to 1.0
}

export interface ResearchClaim {
  id: string;
  statement: string;
  type: 'sourced_fact' | 'inference' | 'unverified';
  sourceIds?: readonly string[] | undefined;
  confidence?: number | undefined; // 0.0 to 1.0
}

export interface ResearchContradiction {
  id: string;
  topic: string;
  claimA: string;
  claimB: string;
  sourceIdA: string;
  sourceIdB: string;
  explanation: string;
  resolution?: string | undefined;
}

export type UrlFetcher = (url: string) => Promise<string | { content: string }>;

export interface ResearchEvidence {
  sources: readonly ResearchSource[];
  claims: readonly ResearchClaim[];
  query?: string | undefined;
  contradictions?: readonly ResearchContradiction[] | undefined;
  topicsCoveredCount?: number | undefined;
  totalTopicsCount?: number | undefined;
  hasFabricatedCitations?: boolean | undefined;
  selfClaimOnly?: boolean | undefined;
}

export interface EvaluatedCriterion {
  criterionId: string;
  description: string;
  passed: boolean;
  evidenceSummary?: string | undefined;
  reason: string;
}

export interface EvaluationResult {
  passed: boolean;
  category: CriterionCategory;
  score: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  evaluatedCriteria: readonly EvaluatedCriterion[];
  remainingIssues: readonly string[];
  selfClaimRejected: boolean;
  completionBlockedReason?: string | undefined;
}
