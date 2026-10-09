export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PermissionDecision = 'allow' | 'deny' | 'require_approval';

export interface ActorContext {
  id: string; // User ID, Worker ID, or System Agent ID
  role?: 'admin' | 'user' | 'system' | 'guest' | undefined;
  deviceId?: string | undefined;
  isAutomated?: boolean | undefined;
}

export interface PermissionRequest {
  actor: ActorContext;
  action: string;
  resource: string;
  scope: string;
  context?: Record<string, unknown> | undefined;
  traceId?: string | undefined;
}

export interface ApprovalBinding {
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  consequence: string;
  fingerprint: string;
}

export interface EvaluationResult {
  decision: PermissionDecision;
  reason: string;
  riskLevel: RiskLevel;
  evaluationId: string;
  requiredApproval?: ApprovalBinding | undefined;
}

export interface ApprovalRecord {
  id: string;
  userId: string;
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  consequence: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decisionReason?: string | null | undefined;
  approverId?: string | null | undefined;
  fingerprint: string;
  usedAt?: Date | null | undefined;
  expiresAt: Date;
  decidedAt?: Date | null | undefined;
  createdAt: Date;
}

export interface AuditLogEntry {
  id?: string | undefined;
  userId?: string | null | undefined;
  projectId?: string | null | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
  decision: PermissionDecision;
  traceId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt?: Date | undefined;
}
