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

  getEngine(): PermissionEngine {
    return this.engine;
  }

  /**
   * Records one audit row per guarded call, written once the outcome is known.
   *
   * A failing audit sink never changes what the caller sees: for an executed action the side
   * effect already happened, so turning the call into an error would invite a retry that runs
   * it twice. The audit failure is reported to stderr instead.
   */
  private async writeAudit(
    request: PermissionRequest,
    decision: AuditLogEntry['decision'],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogger) return;
    try {
      await this.auditLogger.log({
        userId: request.actor.id,
        action: request.action,
        resourceType: request.scope,
        resourceId: request.resource,
        decision,
        traceId: request.traceId,
        metadata,
      });
    } catch (err: unknown) {
      console.error(
        JSON.stringify({
          service: 'permissions',
          event: 'audit_write_failed',
          action: request.action,
          resource: request.resource,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async executeProtected<T>(
    request: PermissionRequest,
    actionFn: () => Promise<T>,
    options?: { approvalId?: string | undefined },
  ): Promise<T> {
    const evaluation = this.engine.evaluate(request);

    const baseMetadata: Record<string, unknown> = {
      riskLevel: evaluation.riskLevel,
      reason: evaluation.reason,
      evaluationId: evaluation.evaluationId,
      ...request.context,
    };

    if (evaluation.decision === 'deny') {
      await this.writeAudit(request, evaluation.decision, {
        ...baseMetadata,
        outcome: 'failure',
        error: evaluation.reason,
      });
      throw new PermissionDeniedError(evaluation.reason, evaluation.riskLevel);
    }

    if (evaluation.decision === 'require_approval') {
      if (!options?.approvalId) {
        await this.writeAudit(request, evaluation.decision, {
          ...baseMetadata,
          outcome: 'failure',
          error: 'approval_required',
        });
        throw new ApprovalRequiredError(
          evaluation.reason,
          evaluation.riskLevel,
          evaluation.requiredApproval!,
        );
      }

      if (!this.approvalValidator) {
        await this.writeAudit(request, evaluation.decision, {
          ...baseMetadata,
          outcome: 'failure',
          error: 'approval_validator_unavailable',
        });
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
        await this.writeAudit(request, evaluation.decision, {
          ...baseMetadata,
          outcome: 'failure',
          approvalId: options.approvalId,
          error:
            validation.reason ??
            'Approval tidak valid, kedaluwarsa, sudah digunakan, atau fingerprint tidak cocok.',
        });
        throw new InvalidApprovalError(
          validation.reason ??
            'Approval tidak valid, kedaluwarsa, sudah digunakan, atau fingerprint tidak cocok.',
        );
      }
    }

    // Permission passed: execute capability, then record what actually happened.
    const startedAt = Date.now();
    try {
      const result = await actionFn();
      await this.writeAudit(request, evaluation.decision, {
        ...baseMetadata,
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err: unknown) {
      await this.writeAudit(request, evaluation.decision, {
        ...baseMetadata,
        outcome: 'failure',
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
