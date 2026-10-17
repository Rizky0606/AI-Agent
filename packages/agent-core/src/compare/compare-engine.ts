import type { ModelGateway } from '@personal-ai-os/model-gateway';
import type {
  CompareColumnResult,
  CompareEngineOptions,
  CompareExecutionResult,
  CompareRunInput,
  CompareSynthesisResult,
} from './types.ts';

export interface CompareEngineConfig {
  modelGateway?: ModelGateway | undefined;
  defaultSynthesisModel?: string | undefined;
}

export class CompareEngine {
  private readonly gateway?: ModelGateway | undefined;
  private readonly defaultSynthesisModel: string;

  constructor(config: CompareEngineConfig = {}) {
    this.gateway = config.modelGateway;
    this.defaultSynthesisModel =
      config.defaultSynthesisModel ?? 'google/gemini-2.5-flash';
  }

  async run(
    input: CompareRunInput,
    options: CompareEngineOptions = {},
  ): Promise<CompareExecutionResult> {
    const { runId, prompt, models, blindMode = false, tokenBudget = 4000 } = input;

    if (!models || models.length < 2 || models.length > 3) {
      throw new Error(
        `Perbandingan membutuhkan 2 hingga 3 model. Jumlah yang diberikan: ${models?.length ?? 0}`,
      );
    }

    if (!this.gateway) {
      throw new Error('ModelGateway belum dikonfigurasi pada CompareEngine.');
    }

    const gateway = this.gateway;
    const aliases = ['Model A', 'Model B', 'Model C'];

    await options.onEvent?.({
      type: 'compare.started',
      runId,
      modelsCount: models.length,
      blindMode,
      timestamp: Date.now(),
    });

    if (options.signal?.aborted) {
      return {
        runId,
        status: 'cancelled',
        columns: [],
        totalTokensUsed: 0,
        error: 'Perbandingan dibatalkan sebelum dimulai.',
      };
    }

    const perModelMaxTokens = Math.max(256, Math.floor(tokenBudget / models.length));
    let cumulativeTokensUsed = 0;

    const systemPrompt = blindMode
      ? 'Anda sedang dalam mode perbandingan model. Jawab pertanyaan pengguna secara akurat, mendalam, dan langsung. Jangan menyebutkan nama model, arsitektur, atau penyedia AI Anda sendiri dalam jawaban.'
      : 'Jawab pertanyaan pengguna secara akurat, mendalam, dan langsung.';

    // Run parallel stream per model with NO FALLBACK
    const columnPromises = models.map(async (modelId, columnIndex): Promise<CompareColumnResult> => {
      const modelAlias = aliases[columnIndex] ?? `Model ${columnIndex + 1}`;
      const startTime = Date.now();
      let content = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let cost: number | undefined;

      try {
        if (options.signal?.aborted) {
          throw new Error('Perbandingan dibatalkan.');
        }

        const stream = gateway.stream({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          maxTokens: perModelMaxTokens,
          signal: options.signal,
        });

        for await (const chunk of stream) {
          if (options.signal?.aborted) {
            throw new Error('Perbandingan dibatalkan.');
          }

          if (chunk.delta) {
            content += chunk.delta;
            await options.onEvent?.({
              type: 'compare.chunk',
              runId,
              columnIndex,
              delta: chunk.delta,
              timestamp: Date.now(),
            });
          }

          if (chunk.usage) {
            if (chunk.usage.promptTokens) promptTokens = chunk.usage.promptTokens;
            if (chunk.usage.completionTokens) completionTokens = chunk.usage.completionTokens;
            if (chunk.usage.totalTokens) totalTokens = chunk.usage.totalTokens;
          }

          if (cumulativeTokensUsed >= tokenBudget) {
            // Graceful token budget stop
            break;
          }
        }

        // If usage was not provided by stream chunk, approximate completion tokens or leave 0
        if (totalTokens === 0 && content.length > 0) {
          // Rough estimation only for budget guard if gateway returned no usage:
          completionTokens = Math.ceil(content.length / 4);
          promptTokens = Math.ceil(prompt.length / 4);
          totalTokens = promptTokens + completionTokens;
        }

        cumulativeTokensUsed += totalTokens;
        const latencyMs = Math.max(1, Date.now() - startTime);

        const colResult: CompareColumnResult = {
          columnIndex,
          modelId,
          modelAlias,
          content,
          status: 'completed',
          latencyMs,
          promptTokens: promptTokens > 0 ? promptTokens : undefined,
          completionTokens: completionTokens > 0 ? completionTokens : undefined,
          totalTokens: totalTokens > 0 ? totalTokens : undefined,
          cost,
        };

        await options.onEvent?.({
          type: 'compare.model_completed',
          runId,
          columnIndex,
          latencyMs,
          promptTokens: colResult.promptTokens,
          completionTokens: colResult.completionTokens,
          totalTokens: colResult.totalTokens,
          cost: colResult.cost,
          content,
          timestamp: Date.now(),
        });

        return colResult;
      } catch (err) {
        // STRICT NO-FALLBACK: Record failure directly for this column without router fallback
        const errorMessage = err instanceof Error ? err.message : String(err);

        const failedCol: CompareColumnResult = {
          columnIndex,
          modelId,
          modelAlias,
          content,
          status: 'failed',
          error: errorMessage,
          latencyMs: Date.now() - startTime,
        };

        await options.onEvent?.({
          type: 'compare.model_failed',
          runId,
          columnIndex,
          error: errorMessage,
          timestamp: Date.now(),
        });

        return failedCol;
      }
    });

    const columns = await Promise.all(columnPromises);

    await options.onEvent?.({
      type: 'compare.completed',
      runId,
      totalTokensUsed: cumulativeTokensUsed,
      timestamp: Date.now(),
    });

    const allFailed = columns.every((c) => c.status === 'failed');

    return {
      runId,
      status: allFailed ? 'failed' : 'completed',
      columns,
      totalTokensUsed: cumulativeTokensUsed,
      error: allFailed ? 'Semua model gagal menghasilkan respons.' : undefined,
    };
  }

  async synthesize(
    input: {
      runId: string;
      prompt: string;
      columns: CompareColumnResult[];
      synthesisModel?: string | undefined;
    },
    options: CompareEngineOptions = {},
  ): Promise<CompareSynthesisResult> {
    const { runId, prompt, columns, synthesisModel } = input;
    const modelToUse = synthesisModel || this.defaultSynthesisModel;

    if (!this.gateway) {
      throw new Error('ModelGateway belum dikonfigurasi pada CompareEngine.');
    }

    const validColumns = columns.filter((c) => c.status === 'completed' && c.content.trim().length > 0);
    if (validColumns.length < 2) {
      throw new Error('Sintesis membutuhkan minimal 2 model yang berhasil menghasilkan jawaban.');
    }

    const synthesisPrompt = `Anda adalah analis AI independen. Bandingkan jawaban dari model-model berikut untuk prompt pengguna di bawah ini:

---
PROMPT PENGGUNA:
"${prompt}"
---
JAWABAN MODEL:
${validColumns.map((c) => `[${c.modelAlias}]:\n${c.content}\n`).join('\n---\n')}
---

Tugas: Buat ringkasan perbandingan terstruktur dalam Bahasa Indonesia dengan format Markdown persis seperti berikut:

### Persamaan
(Poin-poin kesepakatan, kesamaan fakta, atau konsep dasar yang sama-sama dijawab oleh model-model)

### Perbedaan
(Perbedaan spesifik dalam kedalaman, akurasi teknis, struktur penjelasan, atau gaya penyampaian)

### Rekomendasi
(Saran objektif kapan sebaiknya menggunakan jawaban masing-masing model berdasarkan kebutuhan pengguna)
`;

    let synthesisContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    try {
      const stream = this.gateway.stream({
        model: modelToUse,
        messages: [
          {
            role: 'system',
            content: 'Anda adalah analis AI komparatif yang objektif, ringkas, dan jelas.',
          },
          { role: 'user', content: synthesisPrompt },
        ],
        maxTokens: 1500,
        signal: options.signal,
      });

      for await (const chunk of stream) {
        if (options.signal?.aborted) {
          throw new Error('Sintesis dibatalkan.');
        }

        if (chunk.delta) {
          synthesisContent += chunk.delta;
          await options.onEvent?.({
            type: 'compare.synthesis_chunk',
            runId,
            delta: chunk.delta,
            timestamp: Date.now(),
          });
        }

        if (chunk.usage) {
          if (chunk.usage.promptTokens) promptTokens = chunk.usage.promptTokens;
          if (chunk.usage.completionTokens) completionTokens = chunk.usage.completionTokens;
          if (chunk.usage.totalTokens) totalTokens = chunk.usage.totalTokens;
        }
      }

      await options.onEvent?.({
        type: 'compare.synthesis_completed',
        runId,
        content: synthesisContent,
        model: modelToUse,
        usage: { promptTokens, completionTokens, totalTokens },
        timestamp: Date.now(),
      });

      return {
        content: synthesisContent,
        model: modelToUse,
        usage: { promptTokens, completionTokens, totalTokens },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await options.onEvent?.({
        type: 'compare.synthesis_failed',
        runId,
        error: errorMessage,
        timestamp: Date.now(),
      });
      throw err;
    }
  }
}
