import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ResearchRepository } from '../db/research-repository.ts';
import type { TaskEventBroadcaster } from '../services/event-broadcaster.ts';
import {
  DeepResearchEngine,
  type DeepResearchEvent,
  type DeepResearchRunInput,
  type ResearchDepth,
  type ResearchEnvironment,
  type ResearchPlan,
  DEFAULT_BUDGET_BY_DEPTH,
} from '@personal-ai-os/agent-core';
import type { ModelGateway } from '@personal-ai-os/model-gateway';

export interface ResearchRouteDependencies {
  auth: AuthService;
  researchRepo: ResearchRepository;
  broadcaster?: TaskEventBroadcaster | undefined;
  engine?: DeepResearchEngine | undefined;
  environment?: ResearchEnvironment | undefined;
  modelGateway?: ModelGateway | undefined;
  fastModel?: string | undefined;
  complexModel?: string | undefined;
}

const extractUser = async (request: FastifyRequest, auth: AuthService) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHENTICATED', 'Otentikasi diperlukan');
  }
  const token = authHeader.slice(7).trim();
  return auth.authenticate(token);
};

export const registerResearchRoutes = (
  app: FastifyInstance,
  deps: ResearchRouteDependencies,
): void => {
  const activeControllers = new Map<string, AbortController>();
  const engine =
    deps.engine ??
    new DeepResearchEngine({
      modelGateway: deps.modelGateway,
      fastModel: deps.fastModel,
      complexModel: deps.complexModel,
    });

  const broadcastEvent = async (userId: string, event: DeepResearchEvent) => {
    if (!deps.broadcaster) return;
    try {
      await deps.broadcaster.publish({
        id: randomUUID(),
        userId,
        taskId: event.runId,
        eventType: event.type,
        payload: {
          ...event.data,
          timestamp: event.timestamp,
        },
        createdAt: event.timestamp,
      });
    } catch {
      // Ignore broadcast errors
    }
  };

  const executePipelineInBackground = async (
    userId: string,
    runInput: DeepResearchRunInput,
    abortController: AbortController,
  ) => {
    activeControllers.set(runInput.runId, abortController);

    try {
      await deps.researchRepo.updateRunStatus(userId, runInput.runId, 'running');

      const result = await engine.run(runInput, deps.environment, {
        signal: abortController.signal,
        onEvent: async (evt) => {
          await broadcastEvent(userId, evt);
        },
        onCheckpoint: async (cp) => {
          await deps.researchRepo.updateRunStatus(userId, runInput.runId, 'running', {
            checkpoint: cp as unknown as Record<string, unknown>,
            budgetUsed: cp.budgetUsed as unknown as Record<string, unknown>,
          });
        },
      });

      if (abortController.signal.aborted || result.status === 'cancelled') {
        await deps.researchRepo.updateRunStatus(userId, runInput.runId, 'cancelled', {
          budgetUsed: result.budgetUsed as unknown as Record<string, unknown>,
          error: 'Riset dibatalkan.',
        });
        return;
      }

      if (result.status === 'waiting_plan_approval') {
        await deps.researchRepo.updateRunStatus(userId, runInput.runId, 'waiting_plan_approval', {
          plan: result.plan as unknown as Record<string, unknown>,
          budgetUsed: result.budgetUsed as unknown as Record<string, unknown>,
        });
        return;
      }

      // Save sources
      if (result.sources.length > 0) {
        await deps.researchRepo.saveSources(
          runInput.runId,
          result.sources.map((s) => ({
            sourceId: s.id,
            url: s.url,
            title: s.title,
            domain: s.domain,
            credibilityScore: s.credibilityScore,
            snippet: s.snippet,
            fetchStatus: 'fetched',
          })),
        );
      }

      // Save evidence
      if (result.evidence.length > 0) {
        await deps.researchRepo.saveEvidence(
          runInput.runId,
          result.evidence.map((e) => ({
            sourceId: e.sourceId,
            statement: e.statement,
            claimType: e.claimType,
            quote: e.quote,
            confidence: e.confidence,
            verified: true,
          })),
        );
      }

      // Save report
      if (result.report) {
        await deps.researchRepo.saveReport(runInput.runId, {
          title: result.report.title,
          contentMarkdown: result.report.contentMarkdown,
          confidenceBySection: result.report.confidenceBySection,
          gaps: result.report.gaps,
          limitations: result.report.limitations,
          summary: result.report.summary,
        });
      }

      const finalStatus = result.status === 'completed' ? 'completed' : 'failed';
      await deps.researchRepo.updateRunStatus(userId, runInput.runId, finalStatus, {
        plan: result.plan as unknown as Record<string, unknown>,
        budgetUsed: result.budgetUsed as unknown as Record<string, unknown>,
        error: result.error ?? null,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await deps.researchRepo.updateRunStatus(userId, runInput.runId, 'failed', {
        error: errorMsg,
      });
    } finally {
      activeControllers.delete(runInput.runId);
    }
  };

  // 1. POST /v1/research — Mulai Research Run Baru
  app.post(
    '/v1/research',
    {
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'query'],
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            query: { type: 'string', minLength: 3, maxLength: 2000 },
            scope: { type: 'string', maxLength: 100 },
            language: { type: 'string', maxLength: 16 },
            depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
            customBudget: {
              type: 'object',
              properties: {
                maxSearches: { type: 'integer', minimum: 1, maximum: 50 },
                maxPagesRead: { type: 'integer', minimum: 1, maximum: 50 },
                maxModelTokens: { type: 'integer', minimum: 1000, maximum: 500000 },
                maxDurationMs: { type: 'integer', minimum: 5000, maximum: 1800000 },
              },
            },
            requirePlanApproval: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const body = request.body as {
        projectId: string;
        query: string;
        scope?: string;
        language?: string;
        depth?: ResearchDepth;
        customBudget?: {
          maxSearches?: number;
          maxPagesRead?: number;
          maxModelTokens?: number;
          maxDurationMs?: number;
        };
        requirePlanApproval?: boolean;
      };

      const depth: ResearchDepth = body.depth ?? 'standard';
      const baseBudget = DEFAULT_BUDGET_BY_DEPTH[depth];
      const budgetConfig = {
        maxSearches: body.customBudget?.maxSearches ?? baseBudget.maxSearches,
        maxPagesRead: body.customBudget?.maxPagesRead ?? baseBudget.maxPagesRead,
        maxModelTokens: body.customBudget?.maxModelTokens ?? baseBudget.maxModelTokens,
        maxDurationMs: body.customBudget?.maxDurationMs ?? baseBudget.maxDurationMs,
      };

      const run = await deps.researchRepo.createRun({
        userId: user.id,
        projectId: body.projectId,
        query: body.query,
        scope: body.scope,
        language: body.language,
        depth,
        budgetConfig,
      });

      const abortController = new AbortController();
      const runInput: DeepResearchRunInput = {
        runId: run.id,
        userId: user.id,
        projectId: body.projectId,
        query: body.query,
        scope: body.scope,
        language: body.language,
        depth,
        customBudget: body.customBudget,
        requirePlanApproval: body.requirePlanApproval,
      };

      // Execute asynchronously in background
      void executePipelineInBackground(user.id, runInput, abortController);

      return reply.code(201).send({ run });
    },
  );

  // 2. GET /v1/research/:id — Ambil Detail Research Run
  app.get(
    '/v1/research/:id',
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
      const details = await deps.researchRepo.getRunDetails(user.id, request.params.id);
      if (!details) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Research run tidak ditemukan.' },
        });
      }

      return reply.send({
        run: details.run,
        sources: details.sources,
        evidence: details.evidence,
        report: details.report,
      });
    },
  );

  // 3. GET /v1/research — Riwayat Research Run
  app.get(
    '/v1/research',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
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
          status?: string;
          limit?: number;
          offset?: number;
        };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const result = await deps.researchRepo.listRuns(user.id, {
        projectId: request.query.projectId,
        status: request.query.status,
        limit: request.query.limit,
        offset: request.query.offset,
      });

      return reply.send({
        runs: result.runs,
        total: result.total,
      });
    },
  );

  // 4. POST /v1/research/:id/cancel — Batalkan Research Run
  app.post(
    '/v1/research/:id/cancel',
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
      const run = await deps.researchRepo.getRun(user.id, request.params.id);
      if (!run) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Research run tidak ditemukan.' },
        });
      }

      const controller = activeControllers.get(request.params.id);
      if (controller) {
        controller.abort();
        activeControllers.delete(request.params.id);
      }

      const updated = await deps.researchRepo.updateRunStatus(
        user.id,
        request.params.id,
        'cancelled',
        {
          error: 'Riset dibatalkan oleh pengguna.',
        },
      );

      return reply.send({ success: true, run: updated });
    },
  );

  // 5. POST /v1/research/:id/approve-plan — Setujui atau Ubah Rencana Sub-Pertanyaan
  app.post(
    '/v1/research/:id/approve-plan',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            plan: {
              type: 'object',
              properties: {
                subQuestions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'question', 'searchQueries'],
                    properties: {
                      id: { type: 'string' },
                      question: { type: 'string' },
                      rationale: { type: 'string' },
                      searchQueries: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { plan?: { subQuestions?: ResearchPlan['subQuestions'] } };
      }>,
      reply,
    ) => {
      const user = await extractUser(request, deps.auth);
      const run = await deps.researchRepo.getRun(user.id, request.params.id);
      if (!run) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Research run tidak ditemukan.' },
        });
      }

      if (run.status !== 'waiting_plan_approval') {
        return reply.code(400).send({
          error: {
            code: 'INVALID_STATUS',
            message: `Research run tidak dalam status menunggu persetujuan rencana (status saat ini: ${run.status}).`,
          },
        });
      }

      const existingPlan = (run.plan as unknown as ResearchPlan) ?? { subQuestions: [] };
      const approvedPlan: ResearchPlan = {
        subQuestions: request.body?.plan?.subQuestions ?? existingPlan.subQuestions,
        approved: true,
      };

      const updated = await deps.researchRepo.updateRunStatus(
        user.id,
        request.params.id,
        'running',
        {
          plan: approvedPlan as unknown as Record<string, unknown>,
        },
      );

      const abortController = new AbortController();
      const runInput: DeepResearchRunInput = {
        runId: run.id,
        userId: user.id,
        projectId: run.projectId,
        query: run.query,
        scope: run.scope,
        language: run.language,
        depth: run.depth as ResearchDepth,
        initialPlan: approvedPlan,
      };

      void executePipelineInBackground(user.id, runInput, abortController);

      return reply.send({ success: true, run: updated });
    },
  );
};
