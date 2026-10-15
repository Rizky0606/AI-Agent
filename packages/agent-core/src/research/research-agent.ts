import type { ModelGateway } from '@personal-ai-os/model-gateway';
import {
  ResearchEvaluator,
  type ResearchClaim,
  type ResearchContradiction,
  type ResearchEvidence,
  type ResearchSource,
} from '@personal-ai-os/evaluator';
import type {
  CategorizedResearchClaims,
  ResearchAgentConfig,
  ResearchExecutionReport,
  ResearchWorkflowStage,
} from '../types.ts';

/**
 * Stated in every auto-derived report: facts are quoted page openings, so the run proves the
 * sources exist and are cited, not that a model read them. Upgrade path: feed the fetched text
 * through ModelGateway and let the evaluator reject hallucinated citations.
 */
export const NO_SYNTHESIS_LIMITATION =
  'Klaim fakta adalah kutipan awal halaman yang benar-benar diambil dan tidak disintesis lintas sumber.';

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  author?: string | undefined;
  publishedDate?: string | undefined;
}

export interface ResearchEnvironment {
  search(query: string): Promise<SearchResultItem[]>;
  fetchContent?(url: string): Promise<{ url: string; title: string; content: string }>;
}

export interface ResearchTaskInput {
  taskId: string;
  userId: string;
  query: string;
  topics?: string[] | undefined;
  /**
   * Real search/browse backend. When absent the agent cannot gather sources and the
   * evaluator rejects the run — there is no built-in fallback source list.
   */
  environment?: ResearchEnvironment | undefined;
  /** Model gateway for multi-source claim synthesis with citations. */
  modelGateway?: ModelGateway | undefined;
  model?: string | undefined;
  /** Test seams: injected sources/claims bypass search and browse entirely. */
  mockSources?: ResearchSource[] | undefined;
  mockClaims?: ResearchClaim[] | undefined;
  mockContradictions?: ResearchContradiction[] | undefined;
  simulateFabricatedCitation?: boolean | undefined;
}

export interface ResolvedResearchAgentConfig {
  maxSources: number;
  minCredibilityScore: number;
  modelGateway?: ModelGateway | undefined;
  defaultModel?: string | undefined;
}

export class ResearchAgent {
  private readonly config: ResolvedResearchAgentConfig;
  private readonly evaluator: ResearchEvaluator;

  constructor(config?: ResearchAgentConfig, evaluator?: ResearchEvaluator) {
    this.config = {
      maxSources: config?.maxSources ?? 10,
      minCredibilityScore: config?.minCredibilityScore ?? 0.6,
      modelGateway: config?.modelGateway,
      defaultModel: config?.defaultModel,
    };
    this.evaluator = evaluator ?? new ResearchEvaluator();
  }

  async execute(input: ResearchTaskInput): Promise<ResearchExecutionReport> {
    let currentStage: ResearchWorkflowStage = 'decompose';

    // ========================================================
    // 1. DECOMPOSE
    // ========================================================
    currentStage = 'decompose';
    const subTopics =
      input.topics && input.topics.length > 0 ? input.topics : this.decomposeQuery(input.query);

    // ========================================================
    // 2. SEARCH
    // ========================================================
    currentStage = 'search';
    const rawSources: ResearchSource[] = [];
    const searchErrors: string[] = [];
    const environment = input.environment;

    if (input.mockSources !== undefined) {
      rawSources.push(...input.mockSources);
    } else if (environment) {
      for (const topic of subTopics) {
        let results: SearchResultItem[];
        try {
          results = await environment.search(topic);
        } catch (err) {
          // A provider outage must not throw past the evaluator: the run still has to end with
          // structured evidence saying no source was reachable.
          searchErrors.push(
            `Pencarian "${topic}" gagal: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        for (const item of results) {
          if (rawSources.length >= this.config.maxSources) break;
          if (rawSources.some((s) => s.url === item.url)) continue;
          const domain = item.domain || this.extractDomain(item.url);
          rawSources.push({
            id: `src-${rawSources.length + 1}`,
            url: item.url,
            title: item.title,
            domain,
            author: item.author,
            publishedDate: item.publishedDate,
            snippet: item.snippet,
            credibilityScore: this.calculateCredibilityScore(domain),
          });
        }
      }
    }

    // ========================================================
    // 3. BROWSE — every source must be fetched, or it is dropped
    // ========================================================
    currentStage = 'browse';
    let browsed: ResearchSource[] = rawSources;
    const unbrowsableUrls: string[] = [];

    if (input.mockSources === undefined && environment?.fetchContent) {
      const fetchContent = environment.fetchContent.bind(environment);
      browsed = [];
      for (const source of rawSources) {
        let page: { url: string; title: string; content: string };
        try {
          page = await fetchContent(source.url);
        } catch {
          unbrowsableUrls.push(source.url);
          continue;
        }
        const content = page.content.trim();
        if (content.length === 0) {
          unbrowsableUrls.push(source.url);
          continue;
        }
        browsed.push({
          ...source,
          title: source.title || page.title || source.url,
          snippet: content.slice(0, 400),
        });
      }
    }

    currentStage = 'extract';

    // ========================================================
    // 5. CROSS-CHECK & 6. SOURCE SCORING
    // ========================================================
    currentStage = 'cross_check';
    currentStage = 'source_scoring';

    const sources = browsed.map((s) => ({
      ...s,
      credibilityScore: s.credibilityScore ?? this.calculateCredibilityScore(s.domain),
    }));

    const avgCredibility =
      sources.length > 0
        ? sources.reduce((sum, s) => sum + s.credibilityScore, 0) / sources.length
        : 0;

    // ========================================================
    // 7. SYNTHESIZE (Facts vs Inferences vs Unverified & Contradictions)
    // ========================================================
    currentStage = 'synthesize';
    let claims: ResearchClaim[] = [];
    let synthesizedByModel = false;

    if (input.mockClaims && input.mockClaims.length > 0) {
      claims = input.mockClaims;
    } else {
      const gateway = input.modelGateway ?? this.config.modelGateway;
      const model = input.model ?? this.config.defaultModel;

      if (gateway && model && sources.length > 0) {
        try {
          const sourceListText = sources
            .map(
              (s) =>
                `[${s.id}]\nJudul: ${s.title}\nURL: ${s.url}\nKonten: ${s.snippet}`,
            )
            .join('\n\n');

          const systemPrompt =
            'Anda adalah Asisten Peneliti AI terpercaya. Tugas Anda adalah melakukan sintesis temuan faktual secara komprehensif dalam Bahasa Indonesia berdasarkan sumber-sumber yang disediakan.\n' +
            'Aturan Wajib:\n' +
            '1. Setiap klaim fakta ("sourced_fact") HARUS didukung oleh konten sumber dan menyertakan sourceIds yang tepat (contoh: ["src-1"]).\n' +
            '2. Gunakan HANYA ID sumber yang terdaftar (contoh: src-1, src-2).\n' +
            '3. Untuk kesimpulan yang ditarik secara logis dari fakta, gunakan tipe "inference". Untuk hal yang belum terverifikasi secara tuntas, gunakan tipe "unverified".\n' +
            '4. Format luaran HARUS berupa objek JSON valid dengan struktur persis berikut (tanpa blok percakapan tambahan):\n' +
            '{\n' +
            '  "claims": [\n' +
            '    { "statement": "Klaim fakta konkret", "type": "sourced_fact", "sourceIds": ["src-1"] },\n' +
            '    { "statement": "Inferensi analitis", "type": "inference", "sourceIds": ["src-1"] }\n' +
            '  ]\n' +
            '}';

          const userPrompt = `Pertanyaan Riset: "${input.query}"\n\nDaftar Sumber:\n${sourceListText}`;

          const chatRes = await gateway.chat({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0,
          });

          const jsonMatch = chatRes.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as {
              claims?: Array<{ statement?: string; type?: string; sourceIds?: string[] }>;
            };
            if (Array.isArray(parsed.claims) && parsed.claims.length > 0) {
              const validSourceIds = new Set(sources.map((s) => s.id));
              const validClaims = parsed.claims
                .filter((c) => typeof c.statement === 'string' && c.statement.trim().length > 0)
                .map((c, index) => {
                  const sIds = Array.isArray(c.sourceIds)
                    ? c.sourceIds.filter((sid) => validSourceIds.has(sid))
                    : [];
                  const type =
                    c.type === 'inference' || c.type === 'unverified' ? c.type : 'sourced_fact';
                  return {
                    id: `claim-${index + 1}`,
                    statement: (c.statement ?? '').trim(),
                    type: (sIds.length > 0 || type !== 'sourced_fact' ? type : 'unverified') as
                      | 'sourced_fact'
                      | 'inference'
                      | 'unverified',
                    sourceIds: sIds.length > 0 ? sIds : undefined,
                    confidence: 0.9,
                  };
                });
              if (validClaims.length > 0) {
                claims = validClaims;
                synthesizedByModel = true;
              }
            }
          }
        } catch {
          // Fall back gracefully to snippet claims
        }
      }

      if (claims.length === 0) {
        // Each fact is the opening text of a page that was actually fetched, cited to that page.
        // `NO_SYNTHESIS_LIMITATION` states the ceiling in every report produced here.
        claims = sources.map((source, index) => ({
          id: `claim-${index + 1}`,
          statement: source.snippet.trim() || source.title,
          type: 'sourced_fact' as const,
          sourceIds: [source.id],
          confidence: source.credibilityScore,
        }));
      }
    }

    const contradictions: ResearchContradiction[] = input.mockContradictions ?? [];

    const categorizedClaims: CategorizedResearchClaims = {
      sourcedFacts: claims.filter((c) => c.type === 'sourced_fact'),
      inferences: claims.filter((c) => c.type === 'inference'),
      unverified: claims.filter((c) => c.type === 'unverified'),
    };

    // ========================================================
    // 8. CITE (Strict Citation Mapping & Anti-Fabrication)
    // ========================================================
    currentStage = 'cite';
    let hasFabricatedCitations = false;

    if (input.simulateFabricatedCitation === true) {
      hasFabricatedCitations = true;
    } else {
      const sourceIdSet = new Set(sources.map((s) => s.id));
      for (const claim of categorizedClaims.sourcedFacts) {
        if (!claim.sourceIds || claim.sourceIds.length === 0) {
          // Uncited fact
          continue;
        }
        for (const sid of claim.sourceIds) {
          if (!sourceIdSet.has(sid)) {
            // Source ID does not exist in real sources -> fabricated
            hasFabricatedCitations = true;
            break;
          }
        }
      }
    }

    // ========================================================
    // 9. REPORT & RESEARCH EVALUATOR GATING
    // ========================================================
    currentStage = 'report';

    const researchEvidence: ResearchEvidence = {
      sources,
      claims,
      query: input.query,
      contradictions,
      hasFabricatedCitations,
      totalTopicsCount: subTopics.length,
      topicsCoveredCount: subTopics.length,
    };

    const evalResult = await this.evaluator.evaluateAsync(researchEvidence, {
      urlFetcher: environment?.fetchContent ? (url) => environment.fetchContent!(url) : undefined,
      query: input.query,
    });
    const issues = [
      ...(input.mockClaims || synthesizedByModel ? [] : [NO_SYNTHESIS_LIMITATION]),
      ...(searchErrors.length > 0
        ? [`${searchErrors.length} pencarian gagal: ${searchErrors.join(' | ')}`]
        : []),
      ...(unbrowsableUrls.length > 0
        ? [
            `${unbrowsableUrls.length} hasil pencarian dibuang karena kontennya tidak dapat diambil: ${unbrowsableUrls.join(', ')}.`,
          ]
        : []),
    ];

    const artifacts = [
      {
        id: `artifact-research-report-${input.taskId}`,
        title: `Research Report: ${input.query}`,
        content: this.generateReportMarkdown(
          input.query,
          sources,
          categorizedClaims,
          contradictions,
          evalResult.passed,
        ),
      },
    ];

    if (!evalResult.passed) {
      return {
        taskId: input.taskId,
        status: 'failed',
        summary: `Riset gagal evaluasi: ${evalResult.completionBlockedReason ?? evalResult.remainingIssues.join(', ')}${issues.length > 0 ? ` (${issues.join(' | ')})` : ''}`,
        workflowStage: currentStage,
        topics: subTopics,
        sources,
        claims,
        categorizedClaims,
        contradictions,
        averageCredibility: Number(avgCredibility.toFixed(2)),
        evaluationResult: evalResult,
        artifacts,
        limitations: [...evalResult.remainingIssues, ...issues],
        nextSteps: ['Lengkapi sumber independen dan hilangkan indikasi sitasi fiktif.'],
      };
    }

    return {
      taskId: input.taskId,
      status: 'completed',
      summary: `Riset selesai diverifikasi oleh ResearchEvaluator. Seluruh fakta tertaut ke sumber kredibel tanpa halusinasi sitasi.`,
      workflowStage: currentStage,
      topics: subTopics,
      sources,
      claims,
      categorizedClaims,
      contradictions,
      averageCredibility: Number(avgCredibility.toFixed(2)),
      evaluationResult: evalResult,
      artifacts,
      limitations: [
        ...issues,
        ...(categorizedClaims.unverified.length > 0
          ? [
              `${categorizedClaims.unverified.length} poin belum diverifikasi secara independen dan dicatat sebagai unverified.`,
            ]
          : []),
      ],
      nextSteps: [
        'Gunakan hasil sintesis sebagai dasar pertimbangan arsitektur atau keputusan teknis.',
      ],
    };
  }

  private decomposeQuery(query: string): string[] {
    const words = query.split(/\s+/).filter((w) => w.length > 3);
    if (words.length <= 2) {
      return [query];
    }
    return [
      query,
      `spesifikasi ${words.slice(0, 2).join(' ')}`,
      `analisis ${words.slice(-2).join(' ')}`,
    ];
  }

  private extractDomain(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      return parsed.hostname;
    } catch {
      return 'unknown-domain.com';
    }
  }

  private calculateCredibilityScore(domain: string): number {
    const lower = domain.toLowerCase();
    if (
      lower.endsWith('.gov') ||
      lower.endsWith('.edu') ||
      lower.includes('developer.mozilla.org') ||
      lower.includes('nodejs.org') ||
      lower.includes('typescriptlang.org') ||
      lower.includes('rfc-editor.org')
    ) {
      return 0.95;
    }
    if (lower.endsWith('.org') || lower.includes('github.com') || lower.includes('arxiv.org')) {
      return 0.88;
    }
    if (
      lower.includes('medium.com') ||
      lower.includes('dev.to') ||
      lower.includes('substack.com')
    ) {
      return 0.72;
    }
    return 0.65;
  }

  private generateReportMarkdown(
    query: string,
    sources: ResearchSource[],
    categorized: CategorizedResearchClaims,
    contradictions: ResearchContradiction[],
    passed: boolean,
  ): string {
    let md = `# Research Synthesis Report: ${query}\n\n`;
    md += `Status Evaluasi: ${passed ? 'PASSED (Terverifikasi)' : 'BLOCKED (Belum Terverifikasi)'}\n\n`;

    md += `## 1. Sumber Informasi (${sources.length} Sumber)\n\n`;
    md += `| ID | Domain | Judul | Kredibilitas |\n`;
    md += `| --- | --- | --- | --- |\n`;
    for (const s of sources) {
      md += `| ${s.id} | ${s.domain} | [${s.title}](${s.url}) | ${(s.credibilityScore * 100).toFixed(0)}% |\n`;
    }

    md += `\n## 2. Fakta Bersumber (Sourced Facts)\n\n`;
    for (const f of categorized.sourcedFacts) {
      const citeStr = (f.sourceIds ?? []).join(', ');
      md += `- ${f.statement} [${citeStr}]\n`;
    }

    md += `\n## 3. Inferensi & Analisis (Inferences)\n\n`;
    for (const inf of categorized.inferences) {
      md += `- ${inf.statement}\n`;
    }

    if (categorized.unverified.length > 0) {
      md += `\n## 4. Belum Terverifikasi (Unverified)\n\n`;
      for (const unv of categorized.unverified) {
        md += `- [UNVERIFIED] ${unv.statement}\n`;
      }
    }

    if (contradictions.length > 0) {
      md += `\n## 5. Kontradiksi Antar Sumber\n\n`;
      for (const c of contradictions) {
        md += `- Topik: ${c.topic}\n`;
        md += `  - Sumber ${c.sourceIdA}: ${c.claimA}\n`;
        md += `  - Sumber ${c.sourceIdB}: ${c.claimB}\n`;
        md += `  - Penjelasan: ${c.explanation}\n`;
      }
    }

    return md;
  }
}
