import { PermissionEngine } from './engine.ts';
import type { ApprovalBinding, AuditLogEntry, PermissionRequest, RiskLevel } from './types.ts';

export class PermissionDeniedError extends Error {
  readonly riskLevel: RiskLevel;

  constructor(message: string, riskLevel: RiskLevel) {
    super(message);
    this.name = 'PermissionDeniedError';
    this.riskLevel = riskLevel;
  }
}

export class ApprovalRequiredError extends Error {
  readonly riskLevel: RiskLevel;
  readonly requiredApproval: ApprovalBinding;

  constructor(message: string, riskLevel: RiskLevel, requiredApproval: ApprovalBinding) {
    super(message);
    this.name = 'ApprovalRequiredError';
    this.riskLevel = riskLevel;
    this.requiredApproval = requiredApproval;
  }
}

export class InvalidApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApprovalError';
  }
}

export interface ApprovalValidator {
  validateAndConsume(
    approvalId: string,
    expectedFingerprint: string,
    actorId: string,
  ): Promise<{ valid: boolean; reason?: string }>;
}

export interface AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
}

export class SecuredCapabilityGuard {
  private readonly engine: PermissionEngine;
  private readonly approvalValidator?: ApprovalValidator | undefined;
  private readonly auditLogger?: AuditLogger | undefined;

  constructor(
    engine: PermissionEngine,
    options?: {
      approvalValidator?: ApprovalValidator | undefined;
      auditLogger?: AuditLogger | undefined;
    },
  ) {
    this.engine = engine;
    this.approvalValidator = options?.approvalValidator;
    this.auditLogger = options?.auditLogger;
  }

  async executeProtected<T>(
    request: PermissionRequest,
    actionFn: () => Promise<T>,
    options?: { approvalId?: string | undefined },
  ): Promise<T> {
    const evaluation = this.engine.evaluate(request);

    // Audit trail logging
    if (this.auditLogger) {
      await this.auditLogger.log({
        userId: request.actor.id,
        action: request.action,
        resourceType: request.scope,
        resourceId: request.resource,
        decision: evaluation.decision,
        traceId: request.traceId,
        metadata: {
          riskLevel: evaluation.riskLevel,
          reason: evaluation.reason,
          evaluationId: evaluation.evaluationId,
          ...request.context,
        },
      });
    }

    if (evaluation.decision === 'deny') {
      throw new PermissionDeniedError(evaluation.reason, evaluation.riskLevel);
    }

    if (evaluation.decision === 'require_approval') {
      if (!options?.approvalId) {
        throw new ApprovalRequiredError(
          evaluation.reason,
          evaluation.riskLevel,
          evaluation.requiredApproval!,
        );
      }

      if (!this.approvalValidator) {
        throw new InvalidApprovalError(
          'ApprovalValidator tidak tersedia untuk memvalidasi persetujuan.',
        );
      }

      const validation = await this.approvalValidator.validateAndConsume(
        options.approvalId,
        evaluation.requiredApproval!.fingerprint,
        request.actor.id,
      );

      if (!validation.valid) {
        throw new InvalidApprovalError(
          validation.reason ??
            'Approval tidak valid, kedaluwarsa, sudah digunakan, atau fingerprint tidak cocok.',
        );
      }
    }

    // Permission passed: execute capability
    return await actionFn();
  }
}
