import type { ApprovalBinding, PermissionDecision, RiskLevel } from '@personal-ai-os/permissions';

export type HealingStage =
  | 'detect'
  | 'collect_evidence'
  | 'diagnose'
  | 'propose'
  | 'permission_check'
  | 'apply'
  | 'test'
  | 'verify'
  | 'rollback'
  | 'resolved'
  | 'escalated';

export interface HealingIncident {
  id: string;
  targetResource: string;
  environment: 'development' | 'staging' | 'production';
  errorMessage: string;
  errorStack?: string | undefined;
  detectedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface CollectedEvidence {
  incidentId: string;
  logs: string[];
  failingTestNames: string[];
  affectedFiles: string[];
  systemMetrics?: Record<string, number> | undefined;
}

export interface HealingDiagnosis {
  incidentId: string;
  category:
    'syntax' | 'type_error' | 'runtime_crash' | 'dependency' | 'config' | 'permission' | 'unknown';
  rootCause: string;
  confidence: number;
}

export interface ProposedRemediation {
  id: string;
  incidentId: string;
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  patchDescription: string;
  patchContent?: string | undefined;
  rationale: string;
}

export interface HealingAttemptRecord {
  attemptNumber: number;
  timestamp: string;
  stage: HealingStage;
  diagnosis: HealingDiagnosis;
  proposedRemediation: ProposedRemediation;
  permissionDecision: PermissionDecision;
  applied: boolean;
  testPassed: boolean;
  testOutput: string;
  rolledBack: boolean;
}

export interface SelfHealingResult {
  incidentId: string;
  status: 'resolved' | 'escalated';
  totalAttempts: number;
  attempts: HealingAttemptRecord[];
  summary: string;
  finalStage: HealingStage;
  escalationReason?: string | undefined;
  requiresApprovalBinding?: ApprovalBinding | undefined;
}
