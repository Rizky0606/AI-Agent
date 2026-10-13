import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  ModelGateway,
} from '@personal-ai-os/model-gateway';
import { ModelGatewayError } from '@personal-ai-os/model-gateway';
import type { ActiveModelRecord, ModelConfigRepository } from '../db/model-config-repository.ts';

export type RouterRequirements = {
  taskType?: 'chat' | 'coding' | 'research' | undefined;
  requiresStreaming?: boolean | undefined;
  requiresVision?: boolean | undefined;
  requiresToolCalling?: boolean | undefined;
  estimatedTokens?: number | undefined;
  preferredModel?: string | undefined;
};

export type ModelResolutionResult =
  | {
      ok: true;
      primary: ActiveModelRecord;
      fallback?: ActiveModelRecord | undefined;
    }
  | {
      ok: false;
      error: 'VISION_NOT_VERIFIED' | 'NO_COMPATIBLE_MODEL' | 'MODEL_NOT_AVAILABLE';
      message: string;
    };

export class ModelRouter {
  private readonly modelConfigs: ModelConfigRepository;
  private readonly gateway: ModelGateway;

  constructor(modelConfigs: ModelConfigRepository, gateway: ModelGateway) {
    this.modelConfigs = modelConfigs;
    this.gateway = gateway;
  }

  async resolveModel(requirements: RouterRequirements): Promise<ModelResolutionResult> {
    const activeModels = await this.modelConfigs.listActiveModels();

    if (requirements.requiresVision) {
      const hasVision = activeModels.some((m) => m.capabilities.includes('vision'));
      if (!hasVision) {
        return {
          ok: false,
          error: 'VISION_NOT_VERIFIED',
          message:
            'Fitur vision belum diverifikasi pada model/provider yang aktif. Lampiran gambar belum dapat diproses; mohon gunakan pesan berbasis teks.',
        };
      }
    }

    if (requirements.preferredModel && !activeModels.some((m) => m.model === requirements.preferredModel)) {
      return { ok: false, error: 'MODEL_NOT_AVAILABLE', message: 'The selected model is not active.' };
    }
    const compatible = activeModels.filter((m) => {
      if (requirements.requiresStreaming && !m.capabilities.includes('streaming')) return false;
      if (requirements.requiresToolCalling && !m.capabilities.includes('tool_calling'))
        return false;
      if (requirements.requiresVision && !m.capabilities.includes('vision')) return false;
      if (requirements.estimatedTokens && m.contextWindow < requirements.estimatedTokens)
        return false;
      return true;
    });

    if (compatible.length === 0) {
      return {
        ok: false,
        error: 'NO_COMPATIBLE_MODEL',
        message:
          'Tidak ada model aktif yang memenuhi kriteria kapasitas dan kapabilitas untuk tugas ini.',
      };
    }

    // Sort to determine primary and fallback
    compatible.sort((a, b) => {
      if (requirements.preferredModel) {
        if (a.model === requirements.preferredModel) return -1;
        if (b.model === requirements.preferredModel) return 1;
      }
      // Prefer larger context window if task has high token requirements
      if (requirements.estimatedTokens && requirements.estimatedTokens > 8000) {
        return b.contextWindow - a.contextWindow;
      }
      return 0;
    });

    const primary = compatible[0]!;
    const fallback = compatible.length > 1 ? compatible[1] : undefined;

    return { ok: true, primary, fallback };
  }

  async chat(
    request: Omit<ChatCompletionRequest, 'model'>,
    requirements: RouterRequirements = {},
  ): Promise<
    ChatCompletionResponse & { resolvedModel: string; fallbackUsed?: boolean | undefined }
  > {
    const resolution = await this.resolveModel(requirements);
    if (!resolution.ok) {
      throw new ModelGatewayError('INVALID_REQUEST', resolution.message, { statusCode: 400 });
    }

    const { primary, fallback } = resolution;

    try {
      const response = await this.gateway.chat({ ...request, model: primary.model });
      return { ...response, resolvedModel: primary.model, fallbackUsed: false };
    } catch (err) {
      if (
        fallback &&
        err instanceof ModelGatewayError &&
        (err.retryable || err.code === 'PROVIDER_UNAVAILABLE')
      ) {
        const response = await this.gateway.chat({ ...request, model: fallback.model });
        return { ...response, resolvedModel: fallback.model, fallbackUsed: true };
      }
      throw err;
    }
  }

  async *stream(
    request: Omit<ChatCompletionRequest, 'model'>,
    requirements: RouterRequirements = { requiresStreaming: true },
  ): AsyncIterable<
    ChatStreamChunk & { resolvedModel: string; fallbackUsed?: boolean | undefined }
  > {
    const resolution = await this.resolveModel({ ...requirements, requiresStreaming: true });
    if (!resolution.ok) {
      throw new ModelGatewayError('INVALID_REQUEST', resolution.message, { statusCode: 400 });
    }

    const { primary, fallback } = resolution;

    let startedYielding = false;
    try {
      for await (const chunk of this.gateway.stream({ ...request, model: primary.model })) {
        startedYielding = true;
        yield { ...chunk, resolvedModel: primary.model, fallbackUsed: false };
      }
    } catch (err) {
      // Only fallback if no chunks were yielded yet to avoid corrupting client stream
      if (
        !startedYielding &&
        fallback &&
        err instanceof ModelGatewayError &&
        (err.retryable || err.code === 'PROVIDER_UNAVAILABLE')
      ) {
        for await (const chunk of this.gateway.stream({ ...request, model: fallback.model })) {
          yield { ...chunk, resolvedModel: fallback.model, fallbackUsed: true };
        }
        return;
      }
      throw err;
    }
  }
}
