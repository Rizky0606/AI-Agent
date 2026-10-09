import type { SkillHandler, SkillManifest } from '../types.ts';
import type { QualityCheckItem } from './coding-quality-checklist.ts';

export interface ResearchSourceItem {
  id: string;
  url: string;
  domain: string;
  credibilityScore?: number | undefined;
}

export interface ResearchClaimItem {
  id?: string | undefined;
  statement: string;
  sourceIds?: string[] | undefined;
  type: string; // 'sourced_fact' | 'inference' | 'unverified'
}

export interface ResearchQualityInput {
  query: string;
  sources: ResearchSourceItem[];
  claims: ResearchClaimItem[];
}

export interface ResearchQualityOutput {
  passed: boolean;
  qualityScore: number;
  items: QualityCheckItem[];
  unbackedClaims: string[];
}

export const RESEARCH_QUALITY_CHECKLIST_MANIFEST: SkillManifest = {
  name: 'research-quality-checklist',
  version: '1.0.0',
  description:
    'Checklist verifikasi kualitas riset, validitas rujukan, anti-halusinasi sitasi, dan konsistensi sumber independen.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      sources: { type: 'array' },
      claims: { type: 'array' },
    },
    required: ['query', 'sources', 'claims'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      passed: { type: 'boolean' },
      qualityScore: { type: 'number' },
      items: { type: 'array' },
      unbackedClaims: { type: 'array', items: { type: 'string' } },
    },
    required: ['passed', 'qualityScore', 'items', 'unbackedClaims'],
  },
  toolRequirements: [],
  permissions: [
    {
      action: 'tool:inspect_research_quality',
      resource: 'research://citations',
      scope: 'workspace',
      riskLevel: 'LOW',
      reason: 'Audit kredibilitas sumber dan pemetaan sitasi rujukan riset.',
    },
  ],
  compatibility: {
    agentCoreVersion: '>=0.2.0',
    platforms: ['node', 'linux', 'windows'],
  },
  metadata: {
    category: 'research_assurance',
    author: 'personal-ai-os',
  },
};

export const researchQualityChecklistHandler: SkillHandler<
  ResearchQualityInput,
  ResearchQualityOutput
> = async (input) => {
  const items: QualityCheckItem[] = [];
  const unbackedClaims: string[] = [];

  const sourceMap = new Map(input.sources.map((s) => [s.id, s]));

  // 1. Source Credibility Check
  if (input.sources.length === 0) {
    items.push({
      check: 'source_credibility',
      status: 'fail',
      notes: 'Tidak ada sumber data rujukan yang dilampirkan.',
    });
  } else {
    const avgScore =
      input.sources.reduce((sum, s) => sum + (s.credibilityScore ?? 0.7), 0) / input.sources.length;

    if (avgScore >= 0.6) {
      items.push({
        check: 'source_credibility',
        status: 'pass',
        notes: `Rata-rata kredibilitas sumber: ${(avgScore * 100).toFixed(0)}% (memenuhi standar >= 60%).`,
      });
    } else {
      items.push({
        check: 'source_credibility',
        status: 'warn',
        notes: `Rata-rata kredibilitas sumber (${(avgScore * 100).toFixed(0)}%) di bawah ambang batas minimal 60%.`,
      });
    }
  }

  // 2. Multi-source Cross-check
  if (input.sources.length >= 2) {
    items.push({
      check: 'multi_source_cross_check',
      status: 'pass',
      notes: `Riset menggunakan ${input.sources.length} sumber rujukan independen.`,
    });
  } else {
    items.push({
      check: 'multi_source_cross_check',
      status: 'warn',
      notes:
        'Hanya ada 1 sumber rujukan; disarankan minimal 2 sumber independen untuk verifikasi silang.',
    });
  }

  // 3. Citation Authenticity (Anti-Fabrication)
  let missingCitations = 0;
  for (const claim of input.claims) {
    if (claim.type === 'sourced_fact') {
      if (!claim.sourceIds || claim.sourceIds.length === 0) {
        missingCitations++;
        unbackedClaims.push(claim.statement);
      } else {
        for (const sid of claim.sourceIds) {
          if (!sourceMap.has(sid)) {
            missingCitations++;
            unbackedClaims.push(`${claim.statement} (referensi sumber tidak dikenal: ${sid})`);
          }
        }
      }
    }
  }

  if (missingCitations === 0 && input.claims.length > 0) {
    items.push({
      check: 'citation_authenticity',
      status: 'pass',
      notes: 'Semua klaim fakta tertaut ke sumber valid tanpa sitasi fiktif.',
    });
  } else {
    items.push({
      check: 'citation_authenticity',
      status: 'fail',
      notes: `Ditemukan ${missingCitations} klaim fakta tanpa sitasi valid atau mengacu pada ID sumber fiktif.`,
    });
  }

  // 4. Epistemic Categorization (facts vs inferences vs unverified)
  const hasCategorization = input.claims.every((c) =>
    ['sourced_fact', 'inference', 'unverified'].includes(c.type),
  );
  if (hasCategorization && input.claims.length > 0) {
    items.push({
      check: 'epistemic_categorization',
      status: 'pass',
      notes: 'Klaim terpisah secara tegas antara fakta bersumber, inferensi, dan unverified.',
    });
  } else {
    items.push({
      check: 'epistemic_categorization',
      status: 'warn',
      notes: 'Beberapa klaim belum diklasifikasikan ke dalam kategori epistemik yang valid.',
    });
  }

  // Compute score
  let earned = 0;
  for (const item of items) {
    if (item.status === 'pass') earned += 1;
    else if (item.status === 'warn') earned += 0.5;
  }

  const qualityScore = items.length > 0 ? Number((earned / items.length).toFixed(2)) : 0;
  const passed = unbackedClaims.length === 0 && qualityScore >= 0.75;

  return {
    passed,
    qualityScore,
    items,
    unbackedClaims,
  };
};
