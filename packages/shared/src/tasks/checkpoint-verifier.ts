import { createHash } from 'node:crypto';
import type { CheckpointActionType, TaskCheckpoint } from './types.ts';

export function computeCheckpointChecksum(params: {
  version: number;
  stepIndex: number;
  totalSteps: number;
  lastExecutedAction: string;
  actionType?: CheckpointActionType | undefined;
  actionState?: Record<string, unknown> | undefined;
}): string {
  const payload = [
    params.version,
    params.stepIndex,
    params.totalSteps,
    params.lastExecutedAction,
    params.actionType ?? 'internal',
    JSON.stringify(params.actionState ?? {}),
  ].join(':');

  return createHash('sha256').update(payload).digest('hex');
}

export function createVersionedCheckpoint(params: {
  version: number;
  stepIndex: number;
  totalSteps: number;
  lastExecutedAction: string;
  actionType?: CheckpointActionType | undefined;
  actionState?: Record<string, unknown> | undefined;
  verified?: boolean | undefined;
  verificationNotes?: string | undefined;
  timestamp?: string | undefined;
  acceptanceCriteria?: import('./types.ts').CheckpointAcceptanceCriterion[] | undefined;
}): TaskCheckpoint {
  const checksum = computeCheckpointChecksum({
    version: params.version,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
    lastExecutedAction: params.lastExecutedAction,
    actionType: params.actionType,
    actionState: params.actionState,
  });

  return {
    version: params.version,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
    lastExecutedAction: params.lastExecutedAction,
    actionType: params.actionType ?? 'internal',
    actionState: params.actionState,
    timestamp: params.timestamp ?? new Date().toISOString(),
    checksum,
    verified: params.verified ?? true,
    verificationNotes: params.verificationNotes,
    acceptanceCriteria: params.acceptanceCriteria,
  };
}

export function verifyCheckpointIntegrity(checkpoint: TaskCheckpoint): boolean {
  if (!checkpoint.checksum) return false;
  const expected = computeCheckpointChecksum({
    version: checkpoint.version,
    stepIndex: checkpoint.stepIndex,
    totalSteps: checkpoint.totalSteps,
    lastExecutedAction: checkpoint.lastExecutedAction,
    actionType: checkpoint.actionType,
    actionState: checkpoint.actionState,
  });
  return checkpoint.checksum === expected;
}

export interface VerificationResult {
  canProceed: boolean;
  reason: string;
  requiresVerification: boolean;
}

export function verifyStepBeforeExternalAction(
  lastCheckpoint: TaskCheckpoint | null | undefined,
  nextAction: { name: string; isExternal: boolean },
): VerificationResult {
  if (!lastCheckpoint) {
    return {
      canProceed: true,
      reason: 'No prior checkpoint; starting from initial state.',
      requiresVerification: false,
    };
  }

  if (!verifyCheckpointIntegrity(lastCheckpoint)) {
    return {
      canProceed: false,
      reason:
        'Checkpoint integrity check failed (checksum mismatch). Possible tampering or corrupted state.',
      requiresVerification: true,
    };
  }

  if (nextAction.isExternal) {
    if (lastCheckpoint.actionType === 'external_tool' && lastCheckpoint.verified === false) {
      return {
        canProceed: false,
        reason: `Last external step '${lastCheckpoint.lastExecutedAction}' has not been verified after restart. Verify outcome before dispatching '${nextAction.name}'.`,
        requiresVerification: true,
      };
    }
  }

  return {
    canProceed: true,
    reason: 'Last step verified and valid to proceed.',
    requiresVerification: false,
  };
}
