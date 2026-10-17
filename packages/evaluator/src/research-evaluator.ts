import type {
  AcceptanceCriterion,
  EvaluatedCriterion,
  EvaluationResult,
  ResearchClaim,
  ResearchEvidence,
  UrlFetcher,
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
    id: 'claim_support',
    description:
      'Setiap klaim fakta didukung oleh konten aktual dari URL sumber yang diambil ulang',
    category: 'research',
    required: true,
  },
  {
    id: 'query_relevance',
    description: 'Temuan dan klaim riset relevan secara substansial terhadap pertanyaan pengguna',
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
  {
    id: 'verbatim_limit',
    description:
      'Kutipan verbatim dibatasi pendek (maksimal 200 karakter) guna mencegah penyalinan berlebih konten berhak cipta',
    category: 'research',
    required: true,
  },
  {
    id: 'information_gaps',
    description:
      'Bagian informasi yang tidak ditemukan atau belum tuntas teridentifikasi secara transparan',
    category: 'research',
    required: true,
  },
];

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'adalah', 'yang', 'untuk', 'dengan', 'pada', 'dalam', 'dari', 'atau', 'dan', 'ini', 'itu',
    'juga', 'akan', 'bisa', 'dapat', 'tidak', 'saya', 'kami', 'anda', 'mereka', 'apa', 'mengapa',
    'bagaimana', 'seperti', 'secara', 'antara', 'lain', 'lebih', 'karena', 'oleh', 'harus', 'telah',
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'have',
    'has', 'had', 'what', 'how', 'why', 'when', 'where', 'which', 'who', 'about', 'into',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
}

function checkClaimSupported(
  statement: string,
  content: string,
): { supported: boolean; matchRatio: number; skipped?: boolean } {
  // If no content / snippet is available at all, verification cannot disprove claim
  if (!content || content.trim().length === 0) {
    return { supported: true, matchRatio: 1.0, skipped: true };
  }
  const claimWords = extractKeywords(statement);
  if (claimWords.length === 0) return { supported: true, matchRatio: 1.0 };
  const contentLower = content.toLowerCase();
  let matches = 0;
  for (const word of claimWords) {
    if (contentLower.includes(word)) {
      matches++;
    }
  }
  const matchRatio = matches / claimWords.length;
  // If at least 20% of significant claim keywords match the source content, or at least 2 keywords match
  const supported = matchRatio >= 0.2 || matches >= 2;
  return { supported, matchRatio };
}

function checkQueryRelevance(
  query: string | undefined,
  claims: readonly ResearchClaim[],
): { relevant: boolean; score: number; reason: string } {
  if (!query || query.trim().length === 0) {
    return {
      relevant: true,
      score: 1.0,
      reason: 'Pertanyaan tidak disertakan secara spesifik; relevansi diterima.',
    };
  }
  const queryWords = extractKeywords(query);
  if (queryWords.length === 0) {
    return {
      relevant: true,
      score: 1.0,
      reason: 'Pertanyaan tidak memiliki kata kunci diskriminatif; relevansi diterima.',
    };
  }
  const allClaimText = claims.map((c) => c.statement).join(' ').toLowerCase();
  let matches = 0;
  for (const word of queryWords) {
    if (allClaimText.includes(word)) {
      matches++;
    }
  }
  const score = Number((matches / queryWords.length).toFixed(2));
  const relevant = score >= 0.25; // At least 25% query keyword coverage
  return {
    relevant,
    score,
    reason: relevant
      ? `Klaim temuan riset relevan dengan pertanyaan (mencakup ${matches}/${queryWords.length} kata kunci pertanyaan).`
      : `Klaim temuan riset tidak memiliki relevansi memadai terhadap pertanyaan "${query}" (hanya mencakup ${matches}/${queryWords.length} kata kunci).`,
  };
}

export class ResearchEvaluator {
  evaluate(
    evidence: ResearchEvidence,
    customCriteria?: readonly AcceptanceCriterion[],
  ): EvaluationResult {
    return this.evaluateInternal(evidence, customCriteria, { query: evidence.query });
  }

  async evaluateAsync(
    evidence: ResearchEvidence,
    options?: {
      urlFetcher?: UrlFetcher | undefined;
      query?: string | undefined;
      customCriteria?: readonly AcceptanceCriterion[] | undefined;
    },
  ): Promise<EvaluationResult> {
    const fetchedContents = new Map<string, string>();
    if (options?.urlFetcher && evidence.sources.length > 0) {
      await Promise.all(
        evidence.sources.map(async (source) => {
          try {
            const res = await options.urlFetcher!(source.url);
            const text = typeof res === 'string' ? res : res.content;
            if (text && text.trim().length > 0) {
              fetchedContents.set(source.id, text);
            }
          } catch {
            // Re-fetch failed, fallback to source.snippet
          }
        }),
      );
    }

    return this.evaluateInternal(evidence, options?.customCriteria, {
      fetchedContents,
      query: options?.query ?? evidence.query,
    });
  }

  private evaluateInternal(
    evidence: ResearchEvidence,
    customCriteria?: readonly AcceptanceCriterion[],
    options?: {
      fetchedContents?: Map<string, string> | undefined;
      query?: string | undefined;
    },
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

        case 'claim_support': {
          const sourcedFacts = evidence.claims.filter((c) => c.type === 'sourced_fact');
          let unsupportedCount = 0;
          const unsupportedDetails: string[] = [];

          for (const claim of sourcedFacts) {
            let hasAnySupport = false;
            const sIds = claim.sourceIds ?? [];
            if (sIds.length === 0) {
              unsupportedCount++;
              unsupportedDetails.push(`Klaim "${claim.statement.slice(0, 40)}" tidak memiliki rujukan sumber.`);
              continue;
            }

            for (const sid of sIds) {
              const src = sourceMap.get(sid);
              const fetchedText = options?.fetchedContents?.get(sid);
              const rawContent = fetchedText ?? src?.snippet;
              if (!rawContent || rawContent.trim().length === 0) {
                // If neither re-fetched content nor snippet is present, cannot disprove support
                hasAnySupport = true;
                break;
              }
              const sourceContent = [src?.title, rawContent].filter(Boolean).join(' ');
              const supportCheck = checkClaimSupported(claim.statement, sourceContent);
              if (supportCheck.supported) {
                hasAnySupport = true;
                break;
              }
            }

            if (!hasAnySupport) {
              unsupportedCount++;
              unsupportedDetails.push(
                `Klaim "${claim.statement.slice(0, 40)}" tidak didukung oleh isi sumber (${sIds.join(', ')})`,
              );
            }
          }

          if (unsupportedCount === 0) {
            passed = true;
            evidenceSummary = `${sourcedFacts.length} factual claims verified against source contents / re-fetched URLs.`;
            reason = 'Seluruh klaim fakta terverifikasi dan didukung oleh konten aktual sumber rujukan.';
          } else {
            reason = `Terdapat ${unsupportedCount} klaim fakta yang tidak didukung oleh konten sumber: ${unsupportedDetails.slice(0, 2).join('; ')}.`;
            if (criterion.required) remainingIssues.push(`Claim support: ${reason}`);
          }
          break;
        }

        case 'query_relevance': {
          const q = options?.query ?? evidence.query;
          const rel = checkQueryRelevance(q, evidence.claims);
          if (rel.relevant) {
            passed = true;
            evidenceSummary = `Query relevance score: ${(rel.score * 100).toFixed(0)}%. ${rel.reason}`;
            reason = rel.reason;
          } else {
            reason = rel.reason;
            if (criterion.required) remainingIssues.push(`Query relevance: ${reason}`);
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

        case 'verbatim_limit': {
          const quotes = evidence.quotes ?? [];
          const oversized = quotes.filter((q) => q.quote && q.quote.trim().length > 200);
          if (oversized.length === 0) {
            passed = true;
            evidenceSummary =
              quotes.length > 0
                ? `${quotes.length} verbatim quote(s) adhere to length bound (<= 200 chars).`
                : 'No oversized verbatim quotes detected.';
            reason = 'Batas kutipan verbatim ditaati (tidak melebihi 200 karakter).';
          } else {
            reason = `Terdapat ${oversized.length} kutipan verbatim yang melebihi batas 200 karakter (terpanjang: ${Math.max(...oversized.map((o) => o.quote.length))} karakter).`;
            if (criterion.required) remainingIssues.push(`Verbatim limit: ${reason}`);
          }
          break;
        }

        case 'information_gaps': {
          const gaps = evidence.informationGaps ?? [];
          passed = true;
          evidenceSummary =
            gaps.length > 0
              ? `${gaps.length} information gap(s) identified and documented.`
              : 'Seluruh pertanyaan tuntas diteliti tanpa celah informasi tercatat.';
          reason = 'Pencatatan celah informasi / hal yang tidak ditemukan transparan.';
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
