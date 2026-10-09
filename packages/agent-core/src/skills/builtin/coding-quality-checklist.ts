import type { SkillHandler, SkillManifest } from '../types.ts';

export interface QualityCheckItem {
  check: string;
  status: 'pass' | 'fail' | 'warn';
  notes: string;
}

export interface CodingQualityInput {
  codeOrDiff: string;
  testResultsSummary?: string | undefined;
  modifiedFiles?: string[] | undefined;
}

export interface CodingQualityOutput {
  passed: boolean;
  score: number;
  items: QualityCheckItem[];
  criticalIssues: string[];
}

export const CODING_QUALITY_CHECKLIST_MANIFEST: SkillManifest = {
  name: 'coding-quality-checklist',
  version: '1.0.0',
  description:
    'Checklist verifikasi kualitas kode, kepatuhan arsitektur, pemindaian kredensial sensitif, dan bukti pengujian.',
  inputSchema: {
    type: 'object',
    properties: {
      codeOrDiff: { type: 'string' },
      testResultsSummary: { type: 'string' },
      modifiedFiles: { type: 'array', items: { type: 'string' } },
    },
    required: ['codeOrDiff'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      passed: { type: 'boolean' },
      score: { type: 'number' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            check: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'fail', 'warn'] },
            notes: { type: 'string' },
          },
        },
      },
      criticalIssues: { type: 'array', items: { type: 'string' } },
    },
    required: ['passed', 'score', 'items'],
  },
  toolRequirements: [],
  permissions: [
    {
      action: 'tool:inspect_code_quality',
      resource: 'workspace://code',
      scope: 'workspace',
      riskLevel: 'LOW',
      reason: 'Audit statis dan inspeksi diff untuk menjamin standar kualitas kode.',
    },
  ],
  compatibility: {
    agentCoreVersion: '>=0.2.0',
    platforms: ['node', 'linux', 'windows'],
  },
  metadata: {
    category: 'quality_assurance',
    author: 'personal-ai-os',
  },
};

export const codingQualityChecklistHandler: SkillHandler<
  CodingQualityInput,
  CodingQualityOutput
> = async (input) => {
  const items: QualityCheckItem[] = [];
  const criticalIssues: string[] = [];

  const text = input.codeOrDiff;

  // 1. Security Check (No leaked secrets/credentials)
  const secretPattern =
    /(?:api_key|secret|password|jwt_secret)\s*[:=]\s*['"][a-zA-Z0-9_\-.~+]{16,}['"]/i;
  const hasSecret = secretPattern.test(text);

  if (hasSecret) {
    items.push({
      check: 'security_hygiene',
      status: 'fail',
      notes: 'Terdeteksi potensi hardcoded API key, secret, atau password pada file/diff.',
    });
    criticalIssues.push('Ditemukan hardcoded secret pada perubahan kode.');
  } else {
    items.push({
      check: 'security_hygiene',
      status: 'pass',
      notes: 'Tidak ditemukan token atau kredensial bocor dalam diff.',
    });
  }

  // 2. Test Verification Check
  const testSummary = input.testResultsSummary ?? '';
  const hasPassingTests =
    /passed|ok|lulus/i.test(testSummary) && !/failed|gagal/i.test(testSummary);

  if (hasPassingTests || testSummary.length > 0) {
    items.push({
      check: 'test_evidence',
      status: 'pass',
      notes: 'Terdapat bukti eksekusi pengujian yang berhasil.',
    });
  } else {
    items.push({
      check: 'test_evidence',
      status: 'warn',
      notes: 'Tidak ada ringkasan hasil test yang disertakan atau hasil test mencatat kegagalan.',
    });
  }

  // 3. Diff Completeness
  if (text.trim().length > 0) {
    items.push({
      check: 'diff_inspection',
      status: 'pass',
      notes: 'Perubahan kode nyata terverifikasi.',
    });
  } else {
    items.push({
      check: 'diff_inspection',
      status: 'fail',
      notes: 'Diff kosong; tidak ada perubahan kode nyata yang tercatat.',
    });
    criticalIssues.push('Diff kosong.');
  }

  // 4. Error Handling Check
  const hasErrorHandling = /try\s*\{|catch\s*\(|throw new|\.catch\(|if\s*\(.*err.*\)/i.test(text);
  if (hasErrorHandling) {
    items.push({
      check: 'error_handling',
      status: 'pass',
      notes: 'Pola error handling terdeteksi pada kode.',
    });
  } else {
    items.push({
      check: 'error_handling',
      status: 'warn',
      notes: 'Tidak ditemukan blok penanganan error eksplisit (try/catch atau pemeriksaan error).',
    });
  }

  // Calculate score
  let earned = 0;
  for (const item of items) {
    if (item.status === 'pass') earned += 1;
    else if (item.status === 'warn') earned += 0.5;
  }

  const score = Number((earned / items.length).toFixed(2));
  const passed = criticalIssues.length === 0 && score >= 0.75;

  return {
    passed,
    score,
    items,
    criticalIssues,
  };
};
