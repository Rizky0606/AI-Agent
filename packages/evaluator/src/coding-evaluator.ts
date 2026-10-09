import type {
  AcceptanceCriterion,
  CodingEvidence,
  EvaluatedCriterion,
  EvaluationResult,
} from './types.ts';

export const DEFAULT_CODING_CRITERIA: readonly AcceptanceCriterion[] = [
  {
    id: 'lint',
    description: 'Semua file kode lulus ESLint / linter tanpa error dan warning',
    category: 'coding',
    required: true,
  },
  {
    id: 'typecheck',
    description: 'Semua package lulus TypeScript typecheck (tsc --noEmit) tanpa error tipe',
    category: 'coding',
    required: true,
  },
  {
    id: 'tests',
    description: 'Semua unit & integration test lulus (pass 100%, 0 failed)',
    category: 'coding',
    required: true,
  },
  {
    id: 'build',
    description: 'Semua package berhasil dibuild (tsc --build / bundler) tanpa error',
    category: 'coding',
    required: true,
  },
  {
    id: 'security',
    description:
      'Pemeriksaan keamanan kode lulus (tidak ada credential bocor, path traversal, injection)',
    category: 'coding',
    required: true,
  },
  {
    id: 'requirement_coverage',
    description:
      'Semua acceptance criteria dan fungsionalitas yang diminta terpenuhi (coverage >= 80%)',
    category: 'coding',
    required: true,
  },
  {
    id: 'diff',
    description: 'Terdapat git diff / status working tree nyata yang merefleksikan pekerjaan',
    category: 'coding',
    required: true,
  },
];

export class CodingEvaluator {
  evaluate(
    evidence: CodingEvidence,
    customCriteria?: readonly AcceptanceCriterion[],
  ): EvaluationResult {
    const criteria = customCriteria ?? DEFAULT_CODING_CRITERIA;
    const evaluatedCriteria: EvaluatedCriterion[] = [];
    const remainingIssues: string[] = [];

    // 1. STRICT ANTI-SELF-CLAIM CHECK (AGENTS.md rule 7)
    // "Selesai" = bukti nyata (lint, typecheck, test, build, diff), bukan klaim agent sendiri.
    const hasAnyRealEvidence =
      evidence.lintPassed !== undefined ||
      evidence.typecheckPassed !== undefined ||
      evidence.testsPassed !== undefined ||
      evidence.buildPassed !== undefined ||
      evidence.diffAvailable !== undefined;

    if (evidence.selfClaimOnly || !hasAnyRealEvidence) {
      return {
        passed: false,
        category: 'coding',
        score: 0.0,
        confidence: 1.0,
        evaluatedCriteria: criteria.map((c) => ({
          criterionId: c.id,
          description: c.description,
          passed: false,
          reason: 'Klaim verbal agen ditolak: tidak ada bukti nyata eksekusi tooling.',
        })),
        remainingIssues: [
          'Klaim selesai ditolak oleh Evaluator: Agent tidak boleh menyatakan selesai berdasarkan klaimnya sendiri tanpa bukti nyata (lint, typecheck, test, build, diff) sesuai aturan AGENTS.md aturan 7.',
        ],
        selfClaimRejected: true,
        completionBlockedReason:
          'Self-claim completion strictly prohibited without concrete proof of lint, typecheck, test, build, diff.',
      };
    }

    let earned = 0;
    const total = criteria.length;

    // 2. EVALUATE EACH CRITERION
    for (const criterion of criteria) {
      let passed = false;
      let reason = '';
      let evidenceSummary = '';

      switch (criterion.id) {
        case 'lint':
          if (evidence.lintPassed === true) {
            passed = true;
            evidenceSummary = evidence.lintOutput ?? 'Linter passed with 0 errors/warnings.';
            reason = 'ESLint lulus verifikasi tanpa error.';
          } else {
            reason =
              evidence.lintOutput ?? 'Linter gagal atau tidak dijalankan secara terverifikasi.';
            if (criterion.required) remainingIssues.push(`Lint issue: ${reason}`);
          }
          break;

        case 'typecheck':
          if (evidence.typecheckPassed === true) {
            passed = true;
            evidenceSummary =
              evidence.typecheckOutput ?? 'TypeScript typecheck passed with 0 errors.';
            reason = 'Typecheck tsc --noEmit lulus.';
          } else {
            reason = evidence.typecheckOutput ?? 'Typecheck gagal atau memiliki kompilasi error.';
            if (criterion.required) remainingIssues.push(`Typecheck issue: ${reason}`);
          }
          break;

        case 'tests':
          if (evidence.testsPassed === true && (evidence.testsFailedCount ?? 0) === 0) {
            passed = true;
            evidenceSummary =
              evidence.testOutput ??
              `Tests passed (${evidence.testsPassedCount ?? 'all'} passed, 0 failed).`;
            reason = 'Seluruh rangkaian tes berhasil lulus.';
          } else {
            const failCount = evidence.testsFailedCount ?? 'unknown';
            reason = `Terdapat tes gagal (${failCount} failed). Detail: ${evidence.testOutput ?? 'Test suite failed'}`;
            if (criterion.required) remainingIssues.push(`Test issue: ${reason}`);
          }
          break;

        case 'build':
          if (evidence.buildPassed === true) {
            passed = true;
            evidenceSummary = evidence.buildOutput ?? 'Build bundle successfully generated.';
            reason = 'Build artefak berhasil.';
          } else {
            reason = evidence.buildOutput ?? 'Kompilasi build gagal.';
            if (criterion.required) remainingIssues.push(`Build issue: ${reason}`);
          }
          break;

        case 'security':
          if (evidence.securityCheckPassed !== false) {
            passed = true;
            evidenceSummary = evidence.securityCheckDetails ?? 'Security checks verified clean.';
            reason = 'Tidak ditemukan kerentanan keamanan, token bocor, atau eskalasi izin liar.';
          } else {
            reason =
              evidence.securityCheckDetails ??
              'Ditemukan potensi pelanggaran keamanan / credential leak.';
            if (criterion.required) remainingIssues.push(`Security issue: ${reason}`);
          }
          break;

        case 'requirement_coverage': {
          const coverage = evidence.requirementCoverage ?? (evidence.testsPassed ? 1.0 : 0.0);
          if (coverage >= 0.8) {
            passed = true;
            evidenceSummary = `Requirement coverage: ${Math.round(coverage * 100)}%`;
            reason = 'Cakupan kebutuhan memenuhi ambang batas minimal 80%.';
          } else {
            reason = `Cakupan kebutuhan (${Math.round(coverage * 100)}%) di bawah standar 80%. Issue: ${(evidence.requirementIssues ?? []).join(', ') || 'Fitur belum lengkap'}`;
            if (criterion.required) remainingIssues.push(`Coverage issue: ${reason}`);
          }
          break;
        }

        case 'diff':
          if (evidence.diffAvailable === true) {
            passed = true;
            evidenceSummary = evidence.diffSummary ?? 'Git diff verification confirmed changes.';
            reason = 'Perubahan file nyata terkonfirmasi di working tree.';
          } else {
            reason = 'Tidak ada bukti perubahan file nyata / git diff.';
            if (criterion.required) remainingIssues.push(`Diff issue: ${reason}`);
          }
          break;

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
      category: 'coding',
      score,
      confidence: 1.0,
      evaluatedCriteria,
      remainingIssues,
      selfClaimRejected: false,
      completionBlockedReason: passed
        ? undefined
        : `Coding criteria incomplete: ${remainingIssues.join('; ')}`,
    };
  }
}
