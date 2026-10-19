import type { ModelGateway } from '@personal-ai-os/model-gateway';
import type { ResearchPlan, SubQuestion } from './types.ts';

export interface PlanGeneratorOptions {
  modelGateway?: ModelGateway | undefined;
  model?: string | undefined;
  maxSubQuestions?: number | undefined;
}

export class PlanGenerator {
  private readonly gateway?: ModelGateway | undefined;
  private readonly model?: string | undefined;
  private readonly maxSubQuestions: number;

  constructor(options?: PlanGeneratorOptions) {
    this.gateway = options?.modelGateway;
    this.model = options?.model;
    this.maxSubQuestions = options?.maxSubQuestions ?? 4;
  }

  async generatePlan(
    query: string,
    scope = 'general',
    language = 'id',
    signal?: AbortSignal,
  ): Promise<ResearchPlan> {
    if (!this.gateway || !this.model) {
      return this.generateFallbackPlan(query);
    }

    const systemPrompt =
      'Anda adalah Asisten Perencana Riset AI (Research Planner). Tugas Anda adalah memecah pertanyaan riset pengguna menjadi sub-pertanyaan terarah dan menghasilkan kueri pencarian web yang efektif.\n' +
      'Aturan Wajib:\n' +
      '1. Keluaran HARUS berupa objek JSON valid persis dengan struktur berikut:\n' +
      '{\n' +
      '  "subQuestions": [\n' +
      '    {\n' +
      '      "id": "q-1",\n' +
      '      "question": "Sub-pertanyaan spesifik",\n' +
      '      "rationale": "Mengapa pertanyaan ini krusial untuk menjawab topik utama",\n' +
      '      "searchQueries": ["kueri pencarian web 1", "kueri pencarian web 2"]\n' +
      '    }\n' +
      '  ]\n' +
      '}\n' +
      `2. Buat antara 2 hingga ${this.maxSubQuestions} sub-pertanyaan yang saling melengkapi (komprehensif).\n` +
      `3. Bahasa: ${language === 'id' ? 'Bahasa Indonesia' : language}.\n` +
      '4. HANYA cetak JSON murni, jangan ada prolog atau salam penutup percakapan.';

    const userPrompt = `Pertanyaan Utama: "${query}"\nCakupan (Scope): "${scope}"\nBahasa: "${language}"`;

    let attempts = 0;
    const maxAttempts = 3;
    let lastError = '';

    while (attempts < maxAttempts) {
      attempts++;
      if (signal?.aborted) {
        throw new Error('Riset dibatalkan.');
      }

      try {
        const res = await this.gateway.chat({
          model: this.model,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            ...(lastError
              ? [
                  { role: 'assistant' as const, content: 'Gagal' },
                  {
                    role: 'user' as const,
                    content: `Format sebelumnya tidak valid (${lastError}). Harap ulangi dan berikan objek JSON murni sesuai skema.`,
                  },
                ]
              : [{ role: 'user' as const, content: userPrompt }]),
          ],
          temperature: 0.2,
          signal,
        });

        const jsonMatch = res.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = 'Tidak ditemukan blok JSON dalam jawaban model.';
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]) as { subQuestions?: unknown };
        const validated = this.validateSubQuestions(parsed.subQuestions);
        if (validated && validated.length > 0) {
          return {
            subQuestions: validated.slice(0, this.maxSubQuestions),
            approved: false,
          };
        }
        lastError = 'Struktur subQuestions tidak sesuai skema yang diwajibkan.';
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return this.generateFallbackPlan(query);
  }

  private validateSubQuestions(raw: unknown): SubQuestion[] | null {
    if (!Array.isArray(raw)) return null;

    const result: SubQuestion[] = [];
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;

      const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `q-${i + 1}`;
      const question = typeof rec.question === 'string' ? rec.question.trim() : '';
      const rationale = typeof rec.rationale === 'string' ? rec.rationale.trim() : '';
      const searchQueries = Array.isArray(rec.searchQueries)
        ? rec.searchQueries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        : [];

      if (question.length > 0 && searchQueries.length > 0) {
        result.push({
          id,
          question,
          rationale: rationale || `Investigasi aspek: ${question}`,
          searchQueries,
        });
      }
    }

    return result.length > 0 ? result : null;
  }

  private generateFallbackPlan(query: string): ResearchPlan {
    const clean = query.trim();
    const words = clean.split(/\s+/).filter((w) => w.length > 2);

    const subQuestions: SubQuestion[] = [
      {
        id: 'q-1',
        question: `Konsep dasar dan definisi ${clean}`,
        rationale: 'Memahami fondasi topik riset dan terminologi yang digunakan.',
        searchQueries: [clean, `definisi ${clean}`],
      },
    ];

    if (words.length >= 2) {
      subQuestions.push({
        id: 'q-2',
        question: `Analisis mendalam dan perbandingan terkait ${words.slice(0, 3).join(' ')}`,
        rationale:
          'Mengidentifikasi detail teknis, kelebihan, dan kekurangan dari sumber kredibel.',
        searchQueries: [`analisis ${words.slice(0, 3).join(' ')}`, `perbandingan ${clean}`],
      });
    }

    return {
      subQuestions,
      approved: false,
    };
  }
}
