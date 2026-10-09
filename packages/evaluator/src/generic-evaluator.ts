import type {
  AcceptanceCriterion,
  EvaluatedCriterion,
  EvaluationResult,
  GenericEvidence,
} from './types.ts';

export class GenericEvaluator {
  evaluate(criteria: readonly AcceptanceCriterion[], evidence: GenericEvidence): EvaluationResult {
    const evaluatedCriteria: EvaluatedCriterion[] = [];
    const remainingIssues: string[] = [];

    let totalWeight = 0;
    let earnedWeight = 0;

    const hasAnyConcreteEvidence =
      Boolean(evidence.artifacts && evidence.artifacts.length > 0) ||
      Boolean(evidence.outputs && Object.keys(evidence.outputs).length > 0) ||
      Boolean(evidence.logs && evidence.logs.length > 0);

    // If no criteria provided, default to failure because criteria must be determined before execution
    if (criteria.length === 0) {
      return {
        passed: false,
        category: 'generic',
        score: 0,
        confidence: 1.0,
        evaluatedCriteria: [],
        remainingIssues: [
          'Acceptance criteria wajib ditentukan sebelum eksekusi (AGENTS.md). Evaluasi tidak dapat dilakukan tanpa kriteria.',
        ],
        selfClaimRejected: false,
        completionBlockedReason: 'No criteria provided',
      };
    }

    // Check if agent provides claim only without concrete evidence
    if (!hasAnyConcreteEvidence) {
      return {
        passed: false,
        category: 'generic',
        score: 0,
        confidence: 0.95,
        evaluatedCriteria: criteria.map((c) => ({
          criterionId: c.id,
          description: c.description,
          passed: false,
          reason: 'Tidak ada bukti nyata (artifacts/outputs/logs) yang menyertai klaim selesai.',
        })),
        remainingIssues: [
          'Klaim selesai ditolak: agen tidak melampirkan artefak, log, atau output terverifikasi.',
        ],
        selfClaimRejected: true,
        completionBlockedReason: 'Agent claim rejected: Missing verification evidence.',
      };
    }

    for (const criterion of criteria) {
      const weight = criterion.required ? 2 : 1;
      totalWeight += weight;

      // Check if evidence matches expected evidence type or description keywords
      let criterionPassed = false;
      let evidenceSummary = '';
      let failureReason = '';

      if (criterion.expectedEvidenceType === 'artifact') {
        const found = evidence.artifacts?.find(
          (a) =>
            a.title.toLowerCase().includes(criterion.id.toLowerCase()) ||
            a.content?.toLowerCase().includes(criterion.description.toLowerCase()),
        );
        if (found) {
          criterionPassed = true;
          evidenceSummary = `Artifact ditemukan: '${found.title}'`;
        } else if (evidence.artifacts && evidence.artifacts.length > 0) {
          criterionPassed = true;
          evidenceSummary = `Artifact umum tersedia (${evidence.artifacts.length} file)`;
        } else {
          failureReason = 'Artifact bukti yang diharapkan tidak ditemukan.';
        }
      } else if (criterion.expectedEvidenceType === 'output') {
        if (evidence.outputs && Object.keys(evidence.outputs).length > 0) {
          criterionPassed = true;
          evidenceSummary = `Output payload valid dengan ${Object.keys(evidence.outputs).length} field.`;
        } else {
          failureReason = 'Output data yang diharapkan kosong.';
        }
      } else {
        // Generic check across outputs, logs, explanation
        const keywords = criterion.description
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3);
        const corpus = [
          JSON.stringify(evidence.outputs ?? {}),
          ...(evidence.logs ?? []),
          evidence.explanation ?? '',
          ...(evidence.artifacts?.map((a) => a.title + ' ' + (a.content ?? '')) ?? []),
        ]
          .join(' ')
          .toLowerCase();

        const matchCount = keywords.filter((k) => corpus.includes(k)).length;
        if (keywords.length === 0 || matchCount / keywords.length >= 0.4) {
          criterionPassed = true;
          evidenceSummary = `Bukti kontekstual mencocokkan kriteria (${matchCount}/${keywords.length} kata kunci).`;
        } else {
          failureReason = `Bukti tidak mencukupi untuk memenuhi: '${criterion.description}'.`;
        }
      }

      if (criterionPassed) {
        earnedWeight += weight;
        evaluatedCriteria.push({
          criterionId: criterion.id,
          description: criterion.description,
          passed: true,
          evidenceSummary,
          reason: 'Kriteria terpenuhi oleh bukti terverifikasi.',
        });
      } else {
        evaluatedCriteria.push({
          criterionId: criterion.id,
          description: criterion.description,
          passed: false,
          reason: failureReason,
        });
        if (criterion.required) {
          remainingIssues.push(
            `Kriteria wajib '${criterion.id}' belum terpenuhi: ${failureReason}`,
          );
        }
      }
    }

    const score = totalWeight > 0 ? earnedWeight / totalWeight : 0;
    const passed = remainingIssues.length === 0 && score >= 0.7;

    return {
      passed,
      category: 'generic',
      score: Number(score.toFixed(2)),
      confidence: 0.9,
      evaluatedCriteria,
      remainingIssues,
      selfClaimRejected: false,
      completionBlockedReason: passed
        ? undefined
        : `Evaluasi generik belum lulus: ${remainingIssues.length} isu tersisa.`,
    };
  }
}
