import type {
  AcceptanceCriterion,
  EvaluatedCriterion,
  EvaluationResult,
  ResearchEvidence,
} from './types.ts';

export const DEFAULT_RESEARCH_CRITERIA: readonly AcceptanceCriterion[] = [
  {
    id: 'source_quality',
    description:
      'Sumber informasi valid, memiliki metadata jelas, dan skor kredibilitas memadai (>= 0.6)',
    category: 'research',
    required: true,
  },
  {
    id: 'citation_mapping',
    description: 'Setiap klaim fakta tertaut ke sumber nyata, tidak ada sitasi fiktif / halusinasi',
    category: 'research',
    required: true,
  },
  {
    id: 'cross_check',
    description: 'Temuan utama dikonfirmasi silang antar sumber independen',
    category: 'research',
    required: true,
  },
  {
    id: 'contradictions',
    description:
      'Kontradiksi atau disparitas informasi antar sumber dideteksi dan dicatat secara transparan',
    category: 'research',
    required: true,
  },
  {
    id: 'completeness',
    description:
      'Cakupan topik memadai dengan pemisahan tegas antara fakta bersumber, inferensi, dan unverified',
    category: 'research',
    required: true,
  },
];

export class ResearchEvaluator {
  evaluate(
    evidence: ResearchEvidence,
    customCriteria?: readonly AcceptanceCriterion[],
  ): EvaluationResult {
    const criteria = customCriteria ?? DEFAULT_RESEARCH_CRITERIA;
    const evaluatedCriteria: EvaluatedCriterion[] = [];
    const remainingIssues: string[] = [];

    // 1. STRICT ANTI-SELF-CLAIM AND ANTI-FABRICATION CHECK
    if (evidence.selfClaimOnly || !evidence.sources || evidence.sources.length === 0) {
      return {
        passed: false,
        category: 'research',
        score: 0.0,
        confidence: 1.0,
        evaluatedCriteria: criteria.map((c) => ({
          criterionId: c.id,
          description: c.description,
          passed: false,
          reason: 'Klaim riset ditolak: tidak ada sumber data rujukan nyata.',
        })),
        remainingIssues: [
          'Klaim riset ditolak: riset memerlukan metadata sumber nyata, bukan klaim verbal tanpa rujukan.',
        ],
        selfClaimRejected: true,
        completionBlockedReason: 'Research completion blocked: No valid sources provided.',
      };
    }

    if (evidence.hasFabricatedCitations === true) {
      return {
        passed: false,
        category: 'research',
        score: 0.0,
        confidence: 1.0,
        evaluatedCriteria: criteria.map((c) => ({
          criterionId: c.id,
          description: c.description,
          passed: false,
          reason: 'Ditemukan indikasi sitasi palsu / halusinasi.',
        })),
        remainingIssues: [
          'Pelanggaran integritas riset: Terdeteksi sitasi yang dibuat-buat (fabricated citation). Seluruh klaim wajib bersumber nyata.',
        ],
        selfClaimRejected: false,
        completionBlockedReason: 'Research completion blocked: Fabricated citations detected.',
      };
    }

    const sourceMap = new Map(evidence.sources.map((s) => [s.id, s]));
    let earned = 0;
    const total = criteria.length;

    // 2. EVALUATE EACH CRITERION
    for (const criterion of criteria) {
      let passed = false;
      let reason = '';
      let evidenceSummary = '';

      switch (criterion.id) {
        case 'source_quality': {
          const avgScore =
            evidence.sources.reduce((sum, s) => sum + s.credibilityScore, 0) /
            evidence.sources.length;

          const hasMetadata = evidence.sources.every((s) => s.url && s.title && s.domain);

          if (avgScore >= 0.6 && hasMetadata) {
            passed = true;
            evidenceSummary = `${evidence.sources.length} sources analyzed. Average credibility score: ${avgScore.toFixed(2)}.`;
            reason =
              'Kualitas sumber terverifikasi dengan metadata domain dan skor kredibilitas memadai.';
          } else {
            reason = `Kualitas sumber tidak memadai (skor rata-rata: ${avgScore.toFixed(2)}, butuh >= 0.6 atau ada metadata kosong).`;
            if (criterion.required) remainingIssues.push(`Source quality: ${reason}`);
          }
          break;
        }

        case 'citation_mapping': {
          const sourcedFacts = evidence.claims.filter((c) => c.type === 'sourced_fact');
          let missingCitations = 0;
          let invalidSourceRefs = 0;

          for (const claim of sourcedFacts) {
            if (!claim.sourceIds || claim.sourceIds.length === 0) {
              missingCitations++;
            } else {
              for (const sId of claim.sourceIds) {
                if (!sourceMap.has(sId)) {
                  invalidSourceRefs++;
                }
              }
            }
          }

          if (missingCitations === 0 && invalidSourceRefs === 0 && sourcedFacts.length > 0) {
            passed = true;
            evidenceSummary = `${sourcedFacts.length} factual claims mapped to ${evidence.sources.length} sources without unlinked claims.`;
            reason = 'Semua klaim fakta tertaut secara valid ke sumber nyata terdaftar.';
          } else {
            reason = `Terdapat ${missingCitations} fakta tanpa sitasi dan ${invalidSourceRefs} rujukan sumber tidak dikenal.`;
            if (criterion.required) remainingIssues.push(`Citation mapping: ${reason}`);
          }
          break;
        }

        case 'cross_check': {
          // Check that multi-source verification exists
          const multiSourcedCount = evidence.claims.filter(
            (c) => c.sourceIds && c.sourceIds.length >= 2,
          ).length;

          if (multiSourcedCount > 0 || evidence.sources.length >= 2) {
            passed = true;
            evidenceSummary = `Cross-check performed across ${evidence.sources.length} independent sources.`;
            reason = 'Pemeriksaan silang antar sumber berhasil dilakukan.';
          } else {
            reason = 'Kurang verifikasi silang: hanya ada 1 sumber tunggal untuk seluruh klaim.';
            if (criterion.required) remainingIssues.push(`Cross-check: ${reason}`);
          }
          break;
        }

        case 'contradictions': {
          // Contradiction detection is active: if contradictions exist, verify they have source evidence
          const contradictions = evidence.contradictions ?? [];
          let validContradictions = true;

          for (const c of contradictions) {
            if (!sourceMap.has(c.sourceIdA) || !sourceMap.has(c.sourceIdB)) {
              validContradictions = false;
            }
          }

          if (validContradictions) {
            passed = true;
            evidenceSummary =
              contradictions.length > 0
                ? `${contradictions.length} contradiction(s) identified and documented with source citations.`
                : 'No conflicting claims found across sources.';
            reason = 'Penanganan kontradiksi transparan dan terdokumentasi.';
          } else {
            reason = 'Terdapat kontradiksi dengan referensi sumber yang tidak valid.';
            if (criterion.required) remainingIssues.push(`Contradictions: ${reason}`);
          }
          break;
        }

        case 'completeness': {
          const totalTopics = evidence.totalTopicsCount ?? 1;
          const coveredTopics = evidence.topicsCoveredCount ?? 1;
          const coverage = coveredTopics / totalTopics;

          const hasSourcedFacts = evidence.claims.some((c) => c.type === 'sourced_fact');
          const hasCategorization = evidence.claims.every((c) =>
            ['sourced_fact', 'inference', 'unverified'].includes(c.type),
          );

          if (coverage >= 0.8 && hasSourcedFacts && hasCategorization) {
            passed = true;
            evidenceSummary = `Topics coverage: ${Math.round(coverage * 100)}%. Claims categorized by facts, inference, and unverified.`;
            reason = 'Kelengkapan riset memadai dan memenuhi klasifikasi epistemik.';
          } else {
            reason = `Kelengkapan tidak memadai (coverage: ${Math.round(coverage * 100)}% atau klasifikasi klaim tidak lengkap).`;
            if (criterion.required) remainingIssues.push(`Completeness: ${reason}`);
          }
          break;
        }

        default:
          reason = `Kriteria khusus '${criterion.id}' tidak memiliki handler bukti.`;
          if (criterion.required) remainingIssues.push(reason);
      }

      if (passed) {
        earned++;
      }

      evaluatedCriteria.push({
        criterionId: criterion.id,
        description: criterion.description,
        passed,
        evidenceSummary: passed ? evidenceSummary : undefined,
        reason,
      });
    }

    const score = total > 0 ? Number((earned / total).toFixed(2)) : 0;
    const passed = remainingIssues.length === 0 && score === 1.0;

    return {
      passed,
      category: 'research',
      score,
      confidence: 1.0,
      evaluatedCriteria,
      remainingIssues,
      selfClaimRejected: false,
      completionBlockedReason: passed
        ? undefined
        : `Research criteria incomplete: ${remainingIssues.join('; ')}`,
    };
  }
}
