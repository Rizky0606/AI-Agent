import type {
  EvaluationResult,
  ResearchClaim,
  ResearchContradiction,
  ResearchSource,
} from '@personal-ai-os/evaluator';
import type { RiskLevel } from '@personal-ai-os/permissions';

export type AgentMode = 'auto' | 'fast' | 'coding' | 'complex' | 'research';
export type ExecutionRuntime = 'sandbox' | 'windows_agent' | 'repo_runtime' | 'fast_model';
export type AgentTaskIntent =
  'simple_chat' | 'coding' | 'research' | 'windows_local' | 'heavy_untrusted';

export interface IntentAnalysisResult {
  intent: AgentTaskIntent;
  confidence: number;
  recommendedRuntime: ExecutionRuntime;
  reasoning: string;
  extractedEntities: {
    repoPath?: string | undefined;
    targetBranch?: string | undefined;
    topics?: string[] | undefined;
    actions?: string[] | undefined;
    isLocalRequired?: boolean | undefined;
    isUntrusted?: boolean | undefined;
  };
}

export type PlanStepActionType =
  | 'internal'
  | 'workspace_inspection'
  | 'file_operation'
  | 'verification'
  | 'repair'
  | 'external_tool'
  | 'approval'
  | 'evaluation'
  | 'reporting';

export interface StepPlan {
  id: string;
  stepNumber: number;
  name: string;
  description: string;
  actionType: PlanStepActionType;
  expectedOutput: string;
  acceptanceCriteria: string[];
}

export interface TaskPlan {
  planId: string;
  taskKind: AgentTaskIntent;
  title: string;
  objective: string;
  steps: StepPlan[];
  requiredPermissions: string[];
  estimatedRisk: RiskLevel;
}

export interface AgentRoute {
  intent: AgentTaskIntent;
  mode: AgentMode;
  runtime: ExecutionRuntime;
  modelId: string;
  requiresWindowsAgent: boolean;
  requiresSandbox: boolean;
  maxAttempts: number;
  reason: string;
  selectedRuntimeId?: string | undefined;
  fallbackUsed?: boolean | undefined;
  fallbackReason?: string | undefined;
  originalRuntimeId?: string | undefined;
}

export interface RouterContext {
  userId: string;
  projectId?: string | undefined;
  mode?: AgentMode | undefined;
  isWindowsOnline?: boolean | undefined;
  isSandboxAvailable?: boolean | undefined;
  preferredRuntimeId?: string | undefined;
  modelPreferences?:
    | {
        fastModel?: string | undefined;
        codingModel?: string | undefined;
        researchModel?: string | undefined;
      }
    | undefined;
}

// ==========================================
// CODING AGENT TYPES
// ==========================================

export type CodingWorkflowStage =
  | 'understand'
  | 'inspect'
  | 'plan'
  | 'implement'
  | 'test'
  | 'debug'
  | 'review_diff'
  | 'document'
  | 'report';

export interface CodingAgentConfig {
  maxRepairAttempts?: number | undefined; // default 3
  workspaceRoot?: string | undefined;
  targetBranch?: string | undefined;
  repoIsolationMode?: 'branch' | 'worktree' | 'temp_dir' | undefined;
}

export interface RepairAttemptProof {
  attempt: number;
  timestamp: string;
  failingStep: string;
  errorOutput: string;
  proposedFix: string;
  filesModified: string[];
  retestPassed: boolean;
}

export interface GitInspectionResult {
  branch: string;
  clean: boolean;
  uncommittedChanges: string[];
  isolatedWorkspacePrepared: boolean;
  activeWorkspacePath: string;
}

export interface CodingExecutionReport {
  taskId: string;
  status: 'completed' | 'failed' | 'waiting_approval';
  summary: string;
  workflowStage: CodingWorkflowStage;
  gitInspection: GitInspectionResult;
  modifiedFiles: string[];
  diffSummary: string;
  fullDiff?: string | undefined;
  testResults: {
    lint: boolean;
    typecheck: boolean;
    test: boolean;
    build: boolean;
    details?: string | undefined;
  };
  repairAttemptsCount: number;
  repairProofs: RepairAttemptProof[];
  evaluationResult: EvaluationResult;
  artifacts: Array<{
    id: string;
    title: string;
    content?: string | undefined;
  }>;
  limitations: readonly string[];
  nextSteps: string[];
  pendingApproval?:
    | {
        action: string;
        resource: string;
        riskLevel: RiskLevel;
        reason: string;
        fingerprint?: string | undefined;
      }
    | undefined;
}

// ==========================================
// RESEARCH AGENT TYPES
// ==========================================

export type ResearchWorkflowStage =
  | 'decompose'
  | 'search'
  | 'browse'
  | 'extract'
  | 'cross_check'
  | 'source_scoring'
  | 'synthesize'
  | 'cite'
  | 'report';

export interface ResearchAgentConfig {
  maxSources?: number | undefined;
  minCredibilityScore?: number | undefined;
}

export interface CategorizedResearchClaims {
  sourcedFacts: ResearchClaim[];
  inferences: ResearchClaim[];
  unverified: ResearchClaim[];
}

export interface ResearchExecutionReport {
  taskId: string;
  status: 'completed' | 'failed';
  summary: string;
  workflowStage: ResearchWorkflowStage;
  topics: string[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  categorizedClaims: CategorizedResearchClaims;
  contradictions: ResearchContradiction[];
  averageCredibility: number;
  evaluationResult: EvaluationResult;
  artifacts: Array<{
    id: string;
    title: string;
    content?: string | undefined;
  }>;
  limitations: readonly string[];
  nextSteps: string[];
}
