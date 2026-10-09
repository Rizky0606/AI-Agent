import type { PermissionEngine, PermissionRequest } from '@personal-ai-os/permissions';
import type {
  CollectedEvidence,
  HealingAttemptRecord,
  HealingDiagnosis,
  HealingIncident,
  ProposedRemediation,
  SelfHealingResult,
} from './types.ts';

export interface SelfHealingHandlers {
  collectEvidence?: (incident: HealingIncident) => Promise<CollectedEvidence>;
  diagnose?: (
    incident: HealingIncident,
    evidence: CollectedEvidence,
    history: HealingAttemptRecord[],
  ) => Promise<HealingDiagnosis>;
  propose?: (
    incident: HealingIncident,
    diagnosis: HealingDiagnosis,
    attempt: number,
  ) => Promise<ProposedRemediation>;
  apply?: (remediation: ProposedRemediation) => Promise<boolean>;
  test?: (incident: HealingIncident) => Promise<{ passed: boolean; output: string }>;
  rollback?: (remediation: ProposedRemediation) => Promise<boolean>;
}

export class SelfHealingEngine {
  readonly maxAttempts: number;
  private readonly permissionEngine: PermissionEngine;
  private readonly handlers: SelfHealingHandlers;

  constructor(options: {
    permissionEngine: PermissionEngine;
    maxAttempts?: number | undefined;
    handlers?: SelfHealingHandlers | undefined;
  }) {
    // Hard cap at max 5 attempts; default 3 per AGENTS.md Rule 10 (no infinite loops)
    const configuredAttempts = options.maxAttempts ?? 3;
    this.maxAttempts = Math.min(Math.max(1, configuredAttempts), 5);
    this.permissionEngine = options.permissionEngine;
    this.handlers = options.handlers ?? {};
  }

  async run(incident: HealingIncident): Promise<SelfHealingResult> {
    const attempts: HealingAttemptRecord[] = [];

    // Stage 1: Detect
    if (!incident.errorMessage) {
      return {
        incidentId: incident.id,
        status: 'resolved',
        totalAttempts: 0,
        attempts: [],
        summary: 'No active error detected to heal.',
        finalStage: 'resolved',
      };
    }

    // Bounded healing loop (Rule 10: Retry dan repair loop selalu dibatasi)
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // Stage 2: Collect Evidence
      const evidence = await this.collectEvidence(incident);

      // Stage 3: Diagnose
      const diagnosis = await this.diagnose(incident, evidence, attempts);

      // Stage 4: Propose Remediation
      const proposed = await this.propose(incident, diagnosis, attempt);

      // Stage 5: Permission Check
      // RULE: Perubahan production SELALU butuh approval (Rule 9)
      const isProduction =
        incident.environment === 'production' || proposed.resource.toLowerCase().includes('prod');

      const permRequest: PermissionRequest = {
        actor: { id: 'self-healing-agent', isAutomated: true, role: 'system' },
        action: proposed.action,
        resource: proposed.resource,
        scope: proposed.scope,
        context: {
          environment: incident.environment,
          riskLevel: proposed.riskLevel,
          isProduction,
        },
      };

      const evalResult = await this.permissionEngine.evaluate(permRequest);

      // If denied by policy: STOP and ESCALATE
      if (evalResult.decision === 'deny') {
        const attemptRecord: HealingAttemptRecord = {
          attemptNumber: attempt,
          timestamp: new Date().toISOString(),
          stage: 'permission_check',
          diagnosis,
          proposedRemediation: proposed,
          permissionDecision: 'deny',
          applied: false,
          testPassed: false,
          testOutput: `Permission denied: ${evalResult.reason}`,
          rolledBack: false,
        };
        attempts.push(attemptRecord);

        return {
          incidentId: incident.id,
          status: 'escalated',
          totalAttempts: attempts.length,
          attempts,
          summary: `Self-healing escalated: Remediation action denied by policy (${evalResult.reason}).`,
          finalStage: 'escalated',
          escalationReason: `Permission denied: ${evalResult.reason}`,
        };
      }

      // If production or high-risk or require_approval: STOP and ESCALATE for human approval
      if (
        isProduction ||
        evalResult.decision === 'require_approval' ||
        proposed.riskLevel === 'CRITICAL' ||
        proposed.riskLevel === 'HIGH'
      ) {
        const attemptRecord: HealingAttemptRecord = {
          attemptNumber: attempt,
          timestamp: new Date().toISOString(),
          stage: 'permission_check',
          diagnosis,
          proposedRemediation: proposed,
          permissionDecision: 'require_approval',
          applied: false,
          testPassed: false,
          testOutput: 'Remediation blocked: Production changes require explicit human approval.',
          rolledBack: false,
        };
        attempts.push(attemptRecord);

        return {
          incidentId: incident.id,
          status: 'escalated',
          totalAttempts: attempts.length,
          attempts,
          summary: `Self-healing escalated to operator: Production changes require explicit human approval (environment: ${incident.environment}, risk: ${proposed.riskLevel}).`,
          finalStage: 'escalated',
          escalationReason: `Approval required for ${proposed.action} on ${proposed.resource}: ${evalResult.reason}`,
          requiresApprovalBinding: evalResult.requiredApproval ?? {
            action: proposed.action,
            resource: proposed.resource,
            scope: proposed.scope,
            riskLevel: proposed.riskLevel,
            consequence: `Automated healing halted. Human approval required before altering ${incident.environment} environment.`,
            fingerprint: `heal-${incident.id}-${attempt}`,
          },
        };
      }

      // Stage 6: Apply
      let applied = false;
      try {
        applied = await this.apply(proposed);
      } catch {
        applied = false;
      }

      if (!applied) {
        attempts.push({
          attemptNumber: attempt,
          timestamp: new Date().toISOString(),
          stage: 'apply',
          diagnosis,
          proposedRemediation: proposed,
          permissionDecision: 'allow',
          applied: false,
          testPassed: false,
          testOutput: 'Failed to apply patch/remediation.',
          rolledBack: false,
        });
        continue;
      }

      // Stage 7: Test
      let testPassed = false;
      let testOutput = '';
      try {
        const testResult = await this.test(incident);
        testPassed = testResult.passed;
        testOutput = testResult.output;
      } catch (err) {
        testPassed = false;
        testOutput = err instanceof Error ? err.message : String(err);
      }

      // Stage 8: Verify
      if (testPassed) {
        // Successful recovery!
        attempts.push({
          attemptNumber: attempt,
          timestamp: new Date().toISOString(),
          stage: 'verify',
          diagnosis,
          proposedRemediation: proposed,
          permissionDecision: 'allow',
          applied: true,
          testPassed: true,
          testOutput,
          rolledBack: false,
        });

        return {
          incidentId: incident.id,
          status: 'resolved',
          totalAttempts: attempts.length,
          attempts,
          summary: `Self-healing successfully resolved incident "${incident.id}" on attempt ${attempt}.`,
          finalStage: 'resolved',
        };
      }

      // Stage 9: Rollback on verification failure
      let rolledBack = false;
      try {
        rolledBack = await this.rollback(proposed);
      } catch {
        rolledBack = false;
      }

      attempts.push({
        attemptNumber: attempt,
        timestamp: new Date().toISOString(),
        stage: 'rollback',
        diagnosis,
        proposedRemediation: proposed,
        permissionDecision: 'allow',
        applied: true,
        testPassed: false,
        testOutput,
        rolledBack,
      });

      // Check loop bound
      if (attempt >= this.maxAttempts) {
        return {
          incidentId: incident.id,
          status: 'escalated',
          totalAttempts: attempts.length,
          attempts,
          summary: `Self-healing reached maximum attempts (${this.maxAttempts}) without resolving the incident. Changes rolled back. Escalating to human operator.`,
          finalStage: 'escalated',
          escalationReason: `Max repair attempts (${this.maxAttempts}) exhausted. Verification test failed: ${testOutput}`,
        };
      }
    }

    return {
      incidentId: incident.id,
      status: 'escalated',
      totalAttempts: attempts.length,
      attempts,
      summary: 'Self-healing stopped and escalated.',
      finalStage: 'escalated',
    };
  }

  private async collectEvidence(incident: HealingIncident): Promise<CollectedEvidence> {
    if (this.handlers.collectEvidence) {
      return this.handlers.collectEvidence(incident);
    }
    return {
      incidentId: incident.id,
      logs: [incident.errorMessage, incident.errorStack ?? ''].filter(Boolean),
      failingTestNames: ['auto-detect-suite'],
      affectedFiles: [incident.targetResource],
    };
  }

  private async diagnose(
    incident: HealingIncident,
    evidence: CollectedEvidence,
    history: HealingAttemptRecord[],
  ): Promise<HealingDiagnosis> {
    if (this.handlers.diagnose) {
      return this.handlers.diagnose(incident, evidence, history);
    }
    return {
      incidentId: incident.id,
      category: 'runtime_crash',
      rootCause: `Automated diagnosis based on: ${incident.errorMessage}`,
      confidence: 0.85,
    };
  }

  private async propose(
    incident: HealingIncident,
    diagnosis: HealingDiagnosis,
    attempt: number,
  ): Promise<ProposedRemediation> {
    if (this.handlers.propose) {
      return this.handlers.propose(incident, diagnosis, attempt);
    }
    return {
      id: `fix-${incident.id}-${attempt}`,
      incidentId: incident.id,
      action: 'remediate_resource',
      resource: incident.targetResource,
      scope: 'healing:repair',
      riskLevel: 'LOW',
      patchDescription: `Automatic remediation proposal for ${diagnosis.rootCause}`,
      rationale: `Fixes diagnosed root cause (${diagnosis.category})`,
    };
  }

  private async apply(remediation: ProposedRemediation): Promise<boolean> {
    if (this.handlers.apply) {
      return this.handlers.apply(remediation);
    }
    return true;
  }

  private async test(incident: HealingIncident): Promise<{ passed: boolean; output: string }> {
    if (this.handlers.test) {
      return this.handlers.test(incident);
    }
    return { passed: true, output: 'Default verification test passed.' };
  }

  private async rollback(remediation: ProposedRemediation): Promise<boolean> {
    if (this.handlers.rollback) {
      return this.handlers.rollback(remediation);
    }
    return true;
  }
}
