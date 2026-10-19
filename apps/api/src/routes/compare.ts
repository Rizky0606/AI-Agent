import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ChatRepository } from '../db/chat-repository.ts';
import type { CompareRepository, CompareResultRow } from '../db/compare-repository.ts';
import type { ModelConfigRepository } from '../db/model-config-repository.ts';
import type { TaskEventBroadcaster } from '../services/event-broadcaster.ts';
import {
  CompareEngine,
  type CompareEngineEvent,
  type CompareRunInput,
} from '@personal-ai-os/agent-core';
import type { ModelGateway } from '@personal-ai-os/model-gateway';

export interface CompareRouteDependencies {
  auth: AuthService;
  compareRepo: CompareRepository;
  chatRepo?: ChatRepository | undefined;
  broadcaster?: TaskEventBroadcaster | undefined;
  engine?: CompareEngine | undefined;
  modelGateway?: ModelGateway | undefined;
  modelConfigs?: ModelConfigRepository | undefined;
  defaultSynthesisModel?: string | undefined;
}

const extractUser = async (request: FastifyRequest, auth: AuthService) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHENTICATED', 'Otentikasi diperlukan');
  }
  const token = authHeader.slice(7).trim();
  return auth.authenticate(token);
};

const sanitizeResultsForBlindMode = (
  results: CompareResultRow[],
  blindMode: boolean,
  revealed: boolean,
) => {
  if (!blindMode || revealed) {
    return results;
  }
  return results.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { modelId: _hidden, ...rest } = r;
    return { ...rest, modelId: undefined };
  });
};

export const registerCompareRoutes = (
  app: FastifyInstance,
  deps: CompareRouteDependencies,
): void => {
  const activeControllers = new Map<string, AbortController>();
  const engine =
    deps.engine ??
    new CompareEngine({
      modelGateway: deps.modelGateway,
      defaultSynthesisModel: deps.defaultSynthesisModel,
    });

  const broadcastEvent = async (userId: string, event: CompareEngineEvent) => {
    if (!deps.broadcaster) return;
    try {
      await deps.broadcaster.publish({
        id: randomUUID(),
        userId,
        taskId: event.runId,
        eventType: event.type,
        payload: {
          ...event,
        },
        createdAt: new Date(event.timestamp).toISOString(),
      });
    } catch {
      // Ignore broadcast errors
    }
  };

  const executeCompareInBackground = async (
    userId: string,
    runInput: CompareRunInput,
    abortController: AbortController,
  ) => {
    activeControllers.set(runInput.runId, abortController);

    try {
      const result = await engine.run(runInput, {
        signal: abortController.signal,
        onEvent: async (evt) => {
          // If blind mode, do not broadcast real modelId in chunk or event
          let eventToBroadcast = evt;
          if (runInput.blindMode && evt.type === 'compare.model_completed') {
            eventToBroadcast = {
              ...evt,
            };
          }

          await broadcastEvent(userId, eventToBroadcast);

          if (evt.type === 'compare.chunk') {
            await deps.compareRepo.updateResult(runInput.runId, evt.columnIndex, {
              status: 'streaming',
            });
          } else if (evt.type === 'compare.model_completed') {
            await deps.compareRepo.updateResult(runInput.runId, evt.columnIndex, {
              content: evt.content,
              status: 'completed',
              latencyMs: evt.latencyMs,
              promptTokens: evt.promptTokens,
              completionTokens: evt.completionTokens,
              totalTokens: evt.totalTokens,
              cost: evt.cost,
            });
          } else if (evt.type === 'compare.model_failed') {
            await deps.compareRepo.updateResult(runInput.runId, evt.columnIndex, {
              status: 'failed',
              error: evt.error,
            });
          }
        },
      });

      const finalStatus = abortController.signal.aborted
        ? 'cancelled'
        : result.status === 'completed'
          ? 'completed'
          : 'failed';

      await deps.compareRepo.updateRunStatus(userId, runInput.runId, finalStatus, {
        totalTokensUsed: result.totalTokensUsed,
        error: result.error ?? null,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await deps.compareRepo.updateRunStatus(userId, runInput.runId, 'failed', {
        error: errorMsg,
      });
    } finally {
      activeControllers.delete(runInput.runId);
    }
  };

  // 1. POST /v1/compare — Mulai Sesi Perbandingan Multi-Model
  app.post(
    '/v1/compare',
    {
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'prompt', 'models'],
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            prompt: { type: 'string', minLength: 1, maxLength: 30000 },
            models: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 3,
            },
            blindMode: { type: 'boolean' },
            tokenBudget: { type: 'integer', minimum: 500, maximum: 50000 },
            synthesisModel: { type: 'string' },
          },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (
      request: FastifyRequest<{
        Body: {
          projectId: string;
          prompt: string;
          models: string[];
          blindMode?: boolean;
          tokenBudget?: number;
          synthesisModel?: string;
        };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const { projectId, prompt, models, blindMode = false, tokenBudget = 4000, synthesisModel } =
        request.body;

      if (!models || models.length < 2 || models.length > 3) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_MODELS_COUNT',
            message: 'Perbandingan membutuhkan antara 2 hingga 3 model.',
          },
        });
      }

      const runDetails = await deps.compareRepo.createRun({
        userId: user.id,
        projectId,
        prompt,
        models,
        blindMode,
        tokenBudget,
      });

      const abortController = new AbortController();
      const runInput: CompareRunInput = {
        runId: runDetails.run.id,
        userId: user.id,
        projectId,
        prompt,
        models,
        blindMode,
        tokenBudget,
        synthesisModel,
      };

      void executeCompareInBackground(user.id, runInput, abortController);

      const sanitizedResults = sanitizeResultsForBlindMode(
        runDetails.results,
        runDetails.run.blindMode,
        runDetails.run.revealed,
      );

      return reply.code(201).send({
        run: runDetails.run,
        results: sanitizedResults,
      });
    },
  );

  // 2. GET /v1/compare/:id — Ambil Detail Run Perbandingan
  app.get(
    '/v1/compare/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = await extractUser(request, deps.auth);
      const details = await deps.compareRepo.getRunDetails(user.id, request.params.id);

      if (!details) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Sesi perbandingan tidak ditemukan.' },
        });
      }

      const sanitizedResults = sanitizeResultsForBlindMode(
        details.results,
        details.run.blindMode,
        details.run.revealed,
      );

      return reply.send({
        run: details.run,
        results: sanitizedResults,
      });
    },
  );

  // 3. GET /v1/compare — Riwayat Sesi Perbandingan
  app.get(
    '/v1/compare',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: {
          projectId?: string;
          limit?: number;
          offset?: number;
        };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const result = await deps.compareRepo.listRuns(user.id, {
        projectId: request.query.projectId,
        limit: request.query.limit,
        offset: request.query.offset,
      });

      return reply.send({
        runs: result.runs,
        total: result.total,
      });
    },
  );

  // 4. POST /v1/compare/:id/reveal — Ungkap Identitas Model (Mode Buta)
  app.post(
    '/v1/compare/:id/reveal',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = await extractUser(request, deps.auth);
      const run = await deps.compareRepo.getRun(user.id, request.params.id);

      if (!run) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Sesi perbandingan tidak ditemukan.' },
        });
      }

      await deps.compareRepo.revealRun(user.id, request.params.id);
      const details = await deps.compareRepo.getRunDetails(user.id, request.params.id);

      const mapping: Record<number, string> = {};
      if (details) {
        for (const res of details.results) {
          mapping[res.columnIndex] = res.modelId;
        }
      }

      if (deps.broadcaster) {
        await deps.broadcaster.publish({
          id: randomUUID(),
          userId: user.id,
          taskId: request.params.id,
          eventType: 'compare.revealed',
          payload: { runId: request.params.id, mapping },
          createdAt: new Date().toISOString(),
        });
      }

      return reply.send({
        run: details?.run,
        results: details?.results,
        mapping,
      });
    },
  );

  // 5. POST /v1/compare/:id/winner — Pilih Model Pemenang
  app.post(
    '/v1/compare/:id/winner',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['resultId'],
          properties: { resultId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { resultId: string };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const details = await deps.compareRepo.selectWinner(
        user.id,
        request.params.id,
        request.body.resultId,
      );

      if (!details) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Sesi perbandingan atau kolom hasil pemenang tidak ditemukan.',
          },
        });
      }

      const mapping: Record<number, string> = {};
      for (const res of details.results) {
        mapping[res.columnIndex] = res.modelId;
      }

      if (deps.broadcaster) {
        await deps.broadcaster.publish({
          id: randomUUID(),
          userId: user.id,
          taskId: request.params.id,
          eventType: 'compare.winner_selected',
          payload: {
            runId: request.params.id,
            winnerResultId: request.body.resultId,
            winnerModelId: details.run.winnerModelId,
            mapping,
          },
          createdAt: new Date().toISOString(),
        });
      }

      return reply.send({
        run: details.run,
        results: details.results,
        mapping,
      });
    },
  );

  // 6. POST /v1/compare/:id/synthesize — Sintesis Perbandingan
  app.post(
    '/v1/compare/:id/synthesize',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: { model: { type: 'string' } },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { model?: string };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const details = await deps.compareRepo.getRunDetails(user.id, request.params.id);

      if (!details) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Sesi perbandingan tidak ditemukan.' },
        });
      }

      const completedResults = details.results.filter(
        (r) => r.status === 'completed' && r.content.trim().length > 0,
      );

      if (completedResults.length < 2) {
        return reply.code(400).send({
          error: {
            code: 'INSUFFICIENT_COMPLETED_MODELS',
            message: 'Sintesis membutuhkan minimal 2 model yang berhasil menghasilkan jawaban.',
          },
        });
      }

      try {
        const synthResult = await engine.synthesize(
          {
            runId: details.run.id,
            prompt: details.run.prompt,
            columns: completedResults.map((r) => ({
              columnIndex: r.columnIndex,
              modelId: r.modelId,
              modelAlias: r.modelAlias,
              content: r.content,
              status: 'completed',
            })),
            synthesisModel: request.body?.model,
          },
          {
            onEvent: async (evt) => {
              await broadcastEvent(user.id, evt);
            },
          },
        );

        await deps.compareRepo.saveSynthesis(user.id, details.run.id, {
          status: 'completed',
          model: synthResult.model,
          content: synthResult.content,
          usage: synthResult.usage,
        });

        return reply.send({
          synthesis: {
            status: 'completed',
            model: synthResult.model,
            content: synthResult.content,
            usage: synthResult.usage,
          },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({
          error: {
            code: 'SYNTHESIS_FAILED',
            message: `Gagal membuat sintesis: ${errorMsg}`,
          },
        });
      }
    },
  );

  // 7. POST /v1/compare/:id/promote — Jadikan Jawaban Ini Lanjutan Percakapan di Chat
  app.post(
    '/v1/compare/:id/promote',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['resultId'],
          properties: {
            resultId: { type: 'string', format: 'uuid' },
            title: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { resultId: string; title?: string };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const details = await deps.compareRepo.getRunDetails(user.id, request.params.id);

      if (!details) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Sesi perbandingan tidak ditemukan.' },
        });
      }

      const target = details.results.find((r) => r.id === request.body.resultId);
      if (!target) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Kolom hasil jawaban tidak ditemukan.' },
        });
      }

      if (!deps.chatRepo) {
        return reply.code(503).send({
          error: {
            code: 'CHAT_UNAVAILABLE',
            message: 'Layanan chat tidak tersedia untuk promosi percakapan.',
          },
        });
      }

      const conversationTitle =
        request.body.title ??
        (details.run.prompt.length > 50
          ? `${details.run.prompt.slice(0, 47)}...`
          : details.run.prompt);

      const conversation = await deps.chatRepo.createConversation(
        user.id,
        details.run.projectId,
        conversationTitle,
        {
          model: target.modelId,
          mode: 'auto',
        },
      );

      // Append user prompt message
      await deps.chatRepo.appendMessage(
        user.id,
        conversation.id,
        'user',
        details.run.prompt,
      );

      // Append assistant winner message
      await deps.chatRepo.appendMessage(
        user.id,
        conversation.id,
        'assistant',
        target.content,
        {
          promotedFromCompareRunId: details.run.id,
          promotedModelId: target.modelId,
          promotedModelAlias: target.modelAlias,
        },
      );

      return reply.code(201).send({
        success: true,
        conversationId: conversation.id,
        title: conversation.title ?? conversationTitle,
      });
    },
  );

  // 8. DELETE /v1/compare/:id — Hapus Sesi Perbandingan
  app.delete(
    '/v1/compare/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = await extractUser(request, deps.auth);
      const controller = activeControllers.get(request.params.id);
      if (controller) {
        controller.abort();
        activeControllers.delete(request.params.id);
      }

      const deleted = await deps.compareRepo.deleteRun(user.id, request.params.id);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Sesi perbandingan tidak ditemukan.' },
        });
      }

      return reply.send({ success: true });
    },
  );
};
