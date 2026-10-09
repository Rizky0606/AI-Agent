import { createHash } from 'node:crypto';
import type { RiskLevel } from './types.ts';

export const computeApprovalFingerprint = (
  action: string,
  resource: string,
  scope: string,
  riskLevel: RiskLevel,
  context?: Record<string, unknown>,
): string => {
  const normalizedAction = action.trim().toLowerCase();
  const normalizedResource = resource.trim();
  const normalizedScope = scope.trim().toLowerCase();

  // Pick stable deterministic context keys if provided
  const contextDigest = context
    ? Object.keys(context)
        .sort()
        .map((k) => `${k}=${JSON.stringify(context[k])}`)
        .join(';')
    : '';

  const raw = `${normalizedAction}|${normalizedResource}|${normalizedScope}|${riskLevel}|${contextDigest}`;
  return createHash('sha256').update(raw).digest('hex');
};
