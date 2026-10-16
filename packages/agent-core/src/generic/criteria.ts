import type { AcceptanceCriterion, CriterionCategory } from '@personal-ai-os/evaluator';

/**
 * Synthesizes concrete, verifiable acceptance criteria for a generic task
 * if none were provided by the caller, adhering to AGENTS.md requirements.
 */
export function synthesizeGenericCriteria(
  goal: string,
  explicitCriteria?: Array<{
    id: string;
    description: string;
    category?: string | undefined;
    required: boolean;
    expectedEvidenceType?: string | undefined;
  }> | undefined,
): AcceptanceCriterion[] {
  if (Array.isArray(explicitCriteria) && explicitCriteria.length > 0) {
    return explicitCriteria.map((c) => ({
      id: c.id,
      description: c.description,
      category: ((c.category as CriterionCategory) || 'generic') as CriterionCategory,
      required: Boolean(c.required),
      expectedEvidenceType: c.expectedEvidenceType,
    }));
  }

  const trimmedGoal = goal.trim();
  const summaryGoal = trimmedGoal.length > 80 ? `${trimmedGoal.slice(0, 77)}...` : trimmedGoal;

  return [
    {
      id: 'goal_alignment',
      description: `Menjawab dan menyelesaikan tujuan: "${summaryGoal}"`,
      category: 'generic',
      required: true,
      expectedEvidenceType: 'output',
    },
    {
      id: 'concrete_evidence',
      description: 'Menghasilkan artefak atau observasi eksekusi tool nyata yang dapat diverifikasi',
      category: 'generic',
      required: true,
      expectedEvidenceType: 'artifact',
    },
    {
      id: 'factual_verification',
      description: 'Bebas dari klaim kosong dan halusinasi tindakan yang tidak dilakukan',
      category: 'generic',
      required: true,
    },
  ];
}
