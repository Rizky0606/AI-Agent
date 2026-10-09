export interface CouncilParticipant {
  id: string;
  name: string;
  perspective: 'security' | 'architecture' | 'performance' | 'general';
  systemPrompt?: string | undefined;
}

export interface CouncilLimits {
  maxParticipants?: number | undefined; // hard limit <= 3
  maxRounds?: number | undefined; // hard limit <= 2
  maxTotalTokens?: number | undefined; // default 16000
  maxCostUsd?: number | undefined; // default 0.10
  timeoutMs?: number | undefined; // default 30000
}

export interface EvidenceItem {
  id: string;
  type: 'test_output' | 'typecheck' | 'lint' | 'security_audit' | 'benchmark';
  passed: boolean;
  description: string;
  rawEvidence?: string | undefined;
  data?: unknown | undefined;
}

export interface ParticipantOpinion {
  participantId: string;
  round: number;
  stance: 'approve' | 'reject' | 'revise';
  argument: string;
  citedEvidenceIds?: string[] | undefined;
  tokenCount: number;
  costUsd: number;
}

export interface CouncilJudgeEvaluation {
  verdict: 'approved' | 'rejected' | 'needs_revision';
  rationale: string;
  evidenceWeighed: {
    totalVerifiedEvidence: number;
    verifiedPassed: number;
    verifiedFailed: number;
    unsubstantiatedClaimsCount: number;
  };
  decisionBasis: 'empirical_evidence' | 'consensus' | 'safety_override';
}

export interface CouncilDeliberationResult {
  sessionId: string;
  topic: string;
  status: 'completed' | 'budget_exhausted' | 'timeout' | 'error';
  roundsCompleted: number;
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  opinions: ParticipantOpinion[];
  judgeEvaluation: CouncilJudgeEvaluation;
}
