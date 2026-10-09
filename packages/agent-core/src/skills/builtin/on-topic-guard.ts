import type { SkillHandler, SkillManifest } from '../types.ts';

export interface OnTopicInput {
  goal: string;
  acceptanceCriteria: string[];
  proposedActionOrOutput: string;
}

export interface OnTopicOutput {
  isOnTopic: boolean;
  alignmentScore: number;
  deviationReason?: string | undefined;
  suggestions?: string[] | undefined;
}

export const ON_TOPIC_GUARD_MANIFEST: SkillManifest = {
  name: 'on-topic-guard',
  version: '1.0.0',
  description:
    'Memvalidasi keselarasan tindakan atau luaran agen dengan tujuan (goal) dan acceptance criteria pengguna untuk mencegah halusinasi dan deviasi konteks.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
      proposedActionOrOutput: { type: 'string' },
    },
    required: ['goal', 'acceptanceCriteria', 'proposedActionOrOutput'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      isOnTopic: { type: 'boolean' },
      alignmentScore: { type: 'number' },
      deviationReason: { type: 'string' },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['isOnTopic', 'alignmentScore'],
  },
  toolRequirements: [],
  permissions: [
    {
      action: 'query:on_topic_check',
      resource: 'task://intent',
      scope: 'workspace',
      riskLevel: 'LOW',
      reason: 'Pemeriksaan konsistensi semantik tugas terhadap tujuan utama.',
    },
  ],
  compatibility: {
    agentCoreVersion: '>=0.2.0',
    platforms: ['node', 'linux', 'windows'],
  },
  metadata: {
    category: 'governance',
    author: 'personal-ai-os',
  },
};

export const onTopicGuardHandler: SkillHandler<OnTopicInput, OnTopicOutput> = async (input) => {
  const actionLower = input.proposedActionOrOutput.toLowerCase();

  // Check for severe topic deviation triggers
  const offTopicTriggers = [
    'crypto giveaway',
    'buy bitcoin',
    'transfer funds',
    'transfer dana',
    'voucher game',
    'delete whole database',
    'drop table',
  ];

  const hasOffTopicTrigger = offTopicTriggers.some((t) => actionLower.includes(t));
  if (hasOffTopicTrigger) {
    return {
      isOnTopic: false,
      alignmentScore: 0,
      deviationReason: 'Terdeteksi konten mencurigakan atau di luar domain tugas.',
      suggestions: [
        `Fokus kembali pada tujuan utama: "${input.goal}"`,
        `Pastikan tindakan memenuhi acceptance criteria: ${input.acceptanceCriteria.join(', ')}`,
      ],
    };
  }

  const stopWords = new Set(['untuk', 'dengan', 'yang', 'pada', 'atau', 'dari', 'dan', 'file']);
  const tokenize = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

  const goalWords = tokenize(input.goal);
  const criteriaWords = input.acceptanceCriteria.flatMap((c) => tokenize(c));
  const actionWords = tokenize(input.proposedActionOrOutput);

  if (goalWords.length === 0 && criteriaWords.length === 0) {
    return {
      isOnTopic: true,
      alignmentScore: 1.0,
    };
  }

  // Substring or prefix match (e.g. test in tests, auth in auth.test.ts)
  const matchesKeyword = (vocabWord: string) => {
    return actionWords.some((aw) => {
      if (aw === vocabWord) return true;
      if (aw.includes(vocabWord) || vocabWord.includes(aw)) return true;
      if (aw.length >= 4 && vocabWord.length >= 4 && aw.slice(0, 4) === vocabWord.slice(0, 4))
        return true;
      return false;
    });
  };

  const matchedGoalWords = goalWords.filter(matchesKeyword);
  const matchedCriteriaWords = criteriaWords.filter(matchesKeyword);

  const goalRatio = goalWords.length > 0 ? matchedGoalWords.length / goalWords.length : 1.0;
  const criteriaRatio =
    criteriaWords.length > 0 ? matchedCriteriaWords.length / criteriaWords.length : 0.5;

  const blendedScore = Number(Math.min(1.0, goalRatio * 0.7 + criteriaRatio * 0.3).toFixed(2));
  const hasSubstantialMatch =
    matchedGoalWords.length >= 1 || (goalWords.length === 0 && matchedCriteriaWords.length >= 1);

  if (!hasSubstantialMatch || blendedScore < 0.15) {
    return {
      isOnTopic: false,
      alignmentScore: blendedScore,
      deviationReason: `Tindakan/luaran memiliki keselarasan kata kunci sangat rendah (${Math.round(blendedScore * 100)}%) terhadap tujuan task.`,
      suggestions: [
        `Fokus kembali pada tujuan utama: "${input.goal}"`,
        `Pastikan tindakan memenuhi acceptance criteria: ${input.acceptanceCriteria.join(', ')}`,
      ],
    };
  }

  return {
    isOnTopic: true,
    alignmentScore: Math.max(blendedScore, 0.75),
  };
};
