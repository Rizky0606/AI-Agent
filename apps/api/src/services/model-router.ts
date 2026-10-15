import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  ModelGateway,
} from '@personal-ai-os/model-gateway';
import { ModelGatewayError } from '@personal-ai-os/model-gateway';
import type { ActiveModelRecord, ModelConfigRepository } from '../db/model-config-repository.ts';

export type ChatMode = 'auto' | 'fast' | 'coding' | 'complex' | 'research';

export type RouterRequirements = {
  taskType?: 'chat' | 'coding' | 'research' | undefined;
  mode?: ChatMode | undefined;
  requiresStreaming?: boolean | undefined;
  requiresVision?: boolean | undefined;
  requiresToolCalling?: boolean | undefined;
  estimatedTokens?: number | undefined;
  /** Explicit choice at message level (highest priority) */
  preferredModel?: string | undefined;
  /** Conversation-level model preference (medium priority) */
  conversationModel?: string | null | undefined;
  /** User-level default model preference (low priority) */
  userDefaultModel?: string | null | undefined;
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

    // Resolution Hierarchy: Message choice > Conversation preference > User default > Auto
    const explicitCandidate =
      (requirements.preferredModel && requirements.preferredModel.trim()) ||
      (requirements.conversationModel && requirements.conversationModel.trim()) ||
      (requirements.userDefaultModel && requirements.userDefaultModel.trim()) ||
      undefined;

    if (explicitCandidate) {
      const candidate = activeModels.find((m) => m.model === explicitCandidate);
      if (!candidate) {
        return {
          ok: false,
          error: 'MODEL_NOT_AVAILABLE',
          message:
            'Model yang dipilih tidak tersedia atau sedang nonaktif. Silakan pilih model lain atau gunakan mode Otomatis.',
        };
      }

      if (requirements.requiresVision && !candidate.capabilities.includes('vision')) {
        return {
          ok: false,
          error: 'VISION_NOT_VERIFIED',
          message:
            'Fitur vision belum diverifikasi pada model/provider yang aktif. Lampiran gambar belum dapat diproses; mohon gunakan pesan berbasis teks.',
        };
      }

      if (requirements.requiresStreaming && !candidate.capabilities.includes('streaming')) {
        return {
          ok: false,
          error: 'NO_COMPATIBLE_MODEL',
          message:
            'Model yang dipilih tidak mendukung streaming yang diperlukan untuk tugas ini.',
        };
      }

      if (requirements.requiresToolCalling && !candidate.capabilities.includes('tool_calling')) {
        return {
          ok: false,
          error: 'NO_COMPATIBLE_MODEL',
          message:
            'Model yang dipilih tidak mendukung pemanggilan fungsi (tool calling).',
        };
      }

      if (requirements.estimatedTokens && candidate.contextWindow < requirements.estimatedTokens) {
        return {
          ok: false,
          error: 'NO_COMPATIBLE_MODEL',
          message:
            'Tidak ada model aktif yang memenuhi kriteria kapasitas dan kapabilitas untuk tugas ini.',
        };
      }

      // Select fallback if another compatible model exists
      const fallback = activeModels.find(
        (m) =>
          m.model !== candidate.model &&
          (!requirements.requiresStreaming || m.capabilities.includes('streaming')) &&
          (!requirements.requiresToolCalling || m.capabilities.includes('tool_calling')) &&
          (!requirements.requiresVision || m.capabilities.includes('vision')) &&
          (!requirements.estimatedTokens || m.contextWindow >= requirements.estimatedTokens),
      );

      return { ok: true, primary: candidate, fallback };
    }

    // Auto Policy Resolution
    const mode =
      requirements.mode ??
      (requirements.taskType === 'coding'
        ? 'coding'
        : requirements.taskType === 'research'
          ? 'research'
          : 'auto');

    // Retrieve Auto policy model without hardcoded names: check env then database table
    const envVarName = `AUTO_MODEL_${mode.toUpperCase()}`;
    const envPolicyModel = process.env[envVarName] ?? (mode === 'auto' ? process.env.AUTO_MODEL_DEFAULT : undefined);
    const dbPolicyModel =
      (typeof this.modelConfigs.getRoutingPolicy === 'function'
        ? await this.modelConfigs.getRoutingPolicy(mode)
        : null) ??
      (mode === 'auto' && typeof this.modelConfigs.getRoutingPolicy === 'function'
        ? await this.modelConfigs.getRoutingPolicy('default')
        : null);
    const targetPolicyModel = envPolicyModel ?? dbPolicyModel ?? undefined;

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

    // Dynamic mode-based sorting WITHOUT hardcoded model names
    compatible.sort((a, b) => {
      if (targetPolicyModel) {
        if (a.model === targetPolicyModel) return -1;
        if (b.model === targetPolicyModel) return 1;
      }

      if (a.isDefault && !b.isDefault) return -1;
      if (b.isDefault && !a.isDefault) return 1;

      if (mode === 'coding') {
        const aTool = a.capabilities.includes('tool_calling') ? 1 : 0;
        const bTool = b.capabilities.includes('tool_calling') ? 1 : 0;
        if (aTool !== bTool) return bTool - aTool;
        return b.contextWindow - a.contextWindow;
      }

      if (mode === 'research' || mode === 'complex') {
        return b.contextWindow - a.contextWindow;
      }

      if (mode === 'fast') {
        const aLat = a.lastLatencyMs ?? 999999;
        const bLat = b.lastLatencyMs ?? 999999;
        if (aLat !== bLat) return aLat - bLat;
        return a.contextWindow - b.contextWindow;
      }

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
