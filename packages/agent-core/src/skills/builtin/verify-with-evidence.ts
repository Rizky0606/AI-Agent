import type { SkillHandler, SkillManifest } from '../types.ts';

export interface EvidencePayload {
  testResults?: string | undefined;
  exitCode?: number | undefined;
  artifactPaths?: string[] | undefined;
  toolOutputs?: string[] | undefined;
  stdout?: string | undefined;
}

export interface VerifyWithEvidenceInput {
  taskGoal: string;
  claimedStatus: 'completed' | 'done' | 'failed' | 'in_progress' | string;
  summary: string;
  evidence?: EvidencePayload | undefined;
}

export interface VerifyWithEvidenceOutput {
  verified: boolean;
  confidenceScore: number;
  reason: string;
  missingEvidence: string[];
  concreteEvidenceSummary: string[];
}

export const VERIFY_WITH_EVIDENCE_MANIFEST: SkillManifest = {
  name: 'verify-with-evidence',
  version: '1.0.0',
  description:
    'Memverifikasi klaim penyelesaian tugas secara independen dengan memeriksa bukti nyata (hasil pengujian, kode keluar, artefak, luaran tool) dan menolak klaim tanpa bukti.',
  inputSchema: {
    type: 'object',
    properties: {
      taskGoal: { type: 'string' },
      claimedStatus: { type: 'string' },
      summary: { type: 'string' },
      evidence: {
        type: 'object',
        properties: {
          testResults: { type: 'string' },
          exitCode: { type: 'number' },
          artifactPaths: { type: 'array', items: { type: 'string' } },
          toolOutputs: { type: 'array', items: { type: 'string' } },
          stdout: { type: 'string' },
        },
      },
    },
    required: ['taskGoal', 'claimedStatus', 'summary'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      verified: { type: 'boolean' },
      confidenceScore: { type: 'number' },
      reason: { type: 'string' },
      missingEvidence: { type: 'array', items: { type: 'string' } },
      concreteEvidenceSummary: { type: 'array', items: { type: 'string' } },
    },
    required: ['verified', 'confidenceScore', 'reason', 'missingEvidence', 'concreteEvidenceSummary'],
  },
  toolRequirements: [],
  permissions: [
    {
      action: 'query:evidence_verification',
      resource: 'task://evidence',
      scope: 'workspace',
      riskLevel: 'LOW',
      reason: 'Audit verifikasi bukti nyata sebelum menyetujui status selesai.',
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

const COMPLETION_STATUSES = new Set(['completed', 'done', 'selesai', 'success']);

export const verifyWithEvidenceHandler: SkillHandler<
  VerifyWithEvidenceInput,
  VerifyWithEvidenceOutput
> = async (input) => {
  const isClaimingCompletion = COMPLETION_STATUSES.has(input.claimedStatus.toLowerCase());

  // Non-completion statuses (e.g. in_progress or failed) don't require completion evidence
  if (!isClaimingCompletion) {
    return {
      verified: true,
      confidenceScore: 100,
      reason: `Status '${input.claimedStatus}' dicatat tanpa memerlukan bukti penyelesaian akhir.`,
      missingEvidence: [],
      concreteEvidenceSummary: [`Status: ${input.claimedStatus}`],
    };
  }

  const evidence = input.evidence;
  const concreteEvidenceSummary: string[] = [];
  const missingEvidence: string[] = [];
  let score = 0;

  if (!evidence) {
    return {
      verified: false,
      confidenceScore: 0,
      reason: 'Klaim selesai ditolak karena tidak ada objek bukti (evidence) yang dilampirkan.',
      missingEvidence: ['testResults', 'artifactPaths', 'toolOutputs', 'stdout'],
      concreteEvidenceSummary: [],
    };
  }

  // 1. Exit code check
  if (evidence.exitCode !== undefined) {
    if (evidence.exitCode === 0) {
      score += 25;
      concreteEvidenceSummary.push('Kode keluar (exit code) bernilai 0 (sukses).');
    } else {
      return {
        verified: false,
        confidenceScore: 10,
        reason: `Klaim selesai ditolak karena proses menghasilkan exit code ${evidence.exitCode} (kegagalan).`,
        missingEvidence: [],
        concreteEvidenceSummary: [`Exit code kegagalan: ${evidence.exitCode}`],
      };
    }
  }

  // 2. Test results check
  if (evidence.testResults && evidence.testResults.trim().length > 0) {
    const text = evidence.testResults.toLowerCase();
    const indicatesPass =
      text.includes('pass') ||
      text.includes('lulus') ||
      text.includes('ok') ||
      text.includes('0 fail');
    const textWithoutZeroFails = text.replace(/0\s*(?:fail|failed|failures|errors|gagal)/gi, '');
    const indicatesFail =
      textWithoutZeroFails.includes('fail') ||
      textWithoutZeroFails.includes('error') ||
      textWithoutZeroFails.includes('gagal');

    if (indicatesPass && !indicatesFail) {
      score += 35;
      concreteEvidenceSummary.push(`Hasil tes lulus: "${evidence.testResults.slice(0, 100)}..."`);
    } else if (indicatesFail) {
      return {
        verified: false,
        confidenceScore: 15,
        reason: 'Klaim selesai ditolak karena hasil pengujian mengindikasikan kegagalan (failure).',
        missingEvidence: [],
        concreteEvidenceSummary: [`Hasil tes gagal: ${evidence.testResults.slice(0, 100)}`],
      };
    }
  } else {
    missingEvidence.push('testResults');
  }

  // 3. Artifact paths check
  if (evidence.artifactPaths && evidence.artifactPaths.length > 0) {
    score += 25;
    concreteEvidenceSummary.push(`Artefak dihasilkan (${evidence.artifactPaths.length} file): ${evidence.artifactPaths.join(', ')}`);
  } else {
    missingEvidence.push('artifactPaths');
  }

  // 4. Tool outputs / stdout check
  if (evidence.toolOutputs && evidence.toolOutputs.length > 0) {
    score += 15;
    concreteEvidenceSummary.push(`Eksekusi tool tercatat (${evidence.toolOutputs.length} pemanggilan).`);
  }

  if (evidence.stdout && evidence.stdout.trim().length > 10) {
    score += 10;
    concreteEvidenceSummary.push(`Luaran stdout non-kosong (${evidence.stdout.trim().length} karakter).`);
  }

  const normalizedScore = Math.min(100, score);

  if (normalizedScore < 25 || concreteEvidenceSummary.length === 0) {
    return {
      verified: false,
      confidenceScore: normalizedScore,
      reason: 'Klaim selesai ditolak karena bukti nyata tidak mencukupi (skor bukti di bawah ambang batas minimal 25).',
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : ['concrete_output'],
      concreteEvidenceSummary,
    };
  }

  return {
    verified: true,
    confidenceScore: normalizedScore,
    reason: `Klaim selesai berhasil diverifikasi dengan bukti nyata (skor keyakinan: ${normalizedScore}%).`,
    missingEvidence,
    concreteEvidenceSummary,
  };
};
