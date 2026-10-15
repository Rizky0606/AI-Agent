import type { SkillHandler, SkillManifest } from '../types.ts';

export interface PlanBeforeActInput {
  goal: string;
  proposedAction: string;
  plan?: {
    steps?: string[] | undefined;
    acceptanceCriteria?: string[] | undefined;
  } | undefined;
}

export interface PlanBeforeActOutput {
  allowed: boolean;
  reason: string;
  missingElements: string[];
  validatedPlan?: {
    steps: string[];
    acceptanceCriteria: string[];
  } | undefined;
}

export const PLAN_BEFORE_ACT_MANIFEST: SkillManifest = {
  name: 'plan-before-act',
  version: '1.0.0',
  description:
    'Memvalidasi bahwa setiap tugas memiliki rencana terstruktur dan kriteria penerimaan (acceptance criteria) konkret sebelum aksi dijalankan.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      proposedAction: { type: 'string' },
      plan: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' } },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['goal', 'proposedAction'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      allowed: { type: 'boolean' },
      reason: { type: 'string' },
      missingElements: { type: 'array', items: { type: 'string' } },
      validatedPlan: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' } },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['allowed', 'reason', 'missingElements'],
  },
  toolRequirements: [],
  permissions: [
    {
      action: 'query:plan_validation',
      resource: 'task://plan',
      scope: 'workspace',
      riskLevel: 'LOW',
      reason: 'Validasi rencana kerja dan acceptance criteria sebelum aksi dieksekusi.',
    },
  ],
  compatibility: {
    agentCoreVersion: '>=0.2.0',
    platforms: ['node', 'linux', 'windows'],
  },
  metadata: {
    category: 'governance',
    author: 'personal-ai-os',
    risk: 'LOW',
  },
};

const PLACEHOLDER_KEYWORDS = [
  'tbd',
  'todo',
  'placeholder',
  'nanti diatur',
  'do task',
  'selesaikan tugas',
  'selesaikan',
  'action',
  'step 1',
];

export const planBeforeActHandler: SkillHandler<
  PlanBeforeActInput,
  PlanBeforeActOutput
> = async (input) => {
  const missingElements: string[] = [];

  if (!input.goal || input.goal.trim().length === 0) {
    missingElements.push('goal');
  }

  if (!input.proposedAction || input.proposedAction.trim().length === 0) {
    missingElements.push('proposedAction');
  }

  const rawSteps = input.plan?.steps ?? [];
  const rawCriteria = input.plan?.acceptanceCriteria ?? [];

  const validSteps = rawSteps
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !PLACEHOLDER_KEYWORDS.includes(s.toLowerCase()));

  const validCriteria = rawCriteria
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !PLACEHOLDER_KEYWORDS.includes(c.toLowerCase()));

  if (validSteps.length === 0) {
    missingElements.push('steps');
  }

  if (validCriteria.length === 0) {
    missingElements.push('acceptanceCriteria');
  }

  if (missingElements.length > 0) {
    return {
      allowed: false,
      reason: `Tindakan ditolak karena elemen penting berikut belum disediakan atau hanya placeholder: ${missingElements.join(', ')}.`,
      missingElements,
    };
  }

  return {
    allowed: true,
    reason: 'Rencana kerja dan kriteria penerimaan telah lengkap dan tervalidasi.',
    missingElements: [],
    validatedPlan: {
      steps: validSteps,
      acceptanceCriteria: validCriteria,
    },
  };
};
