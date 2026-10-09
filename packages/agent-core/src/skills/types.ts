import type { RiskLevel } from '@personal-ai-os/permissions';

export interface SkillPermission {
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  reason: string;
}

export interface SkillCompatibility {
  agentCoreVersion?: string | undefined; // semver range, e.g. ">=0.2.0"
  platforms?: readonly string[] | undefined; // e.g. ['node', 'linux', 'windows']
  minMemoryMb?: number | undefined;
}

export interface SkillModelRequirements {
  minContextTokens?: number | undefined;
  requiresStreaming?: boolean | undefined;
  recommendedModel?: string | undefined;
}

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  toolRequirements: readonly string[];
  modelRequirements?: SkillModelRequirements | undefined;
  permissions: readonly SkillPermission[];
  compatibility: SkillCompatibility;
  metadata?: Record<string, unknown> | undefined;
}

export interface SkillRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  manifest: SkillManifest;
  isEnabled: boolean;
  isDefault: boolean;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillRevisionRecord {
  id: string;
  skillName: string;
  version: string;
  manifest: SkillManifest;
  createdAt: Date;
}

export interface SkillExecutionContext {
  userId: string;
  taskId?: string | undefined;
  projectId?: string | undefined;
  approvalId?: string | undefined;
}

export type SkillHandler<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> = (
  input: TInput,
  context: SkillExecutionContext,
) => Promise<TOutput>;

export class SkillValidationError extends Error {
  readonly errors: readonly string[];

  constructor(message: string, errors: readonly string[] = []) {
    super(message);
    this.name = 'SkillValidationError';
    this.errors = errors;
  }
}

export class SkillIncompatibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillIncompatibleError';
  }
}

export class SkillPermissionViolationError extends Error {
  readonly requestedAction: string;

  constructor(message: string, requestedAction: string) {
    super(message);
    this.name = 'SkillPermissionViolationError';
    this.requestedAction = requestedAction;
  }
}

export class SkillNotFoundError extends Error {
  constructor(skillName: string) {
    super(`Skill '${skillName}' tidak ditemukan dalam registry.`);
    this.name = 'SkillNotFoundError';
  }
}

export class SkillDisabledError extends Error {
  constructor(skillName: string) {
    super(`Skill '${skillName}' sedang dinonaktifkan.`);
    this.name = 'SkillDisabledError';
  }
}
