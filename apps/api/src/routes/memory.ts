import {
  ContextManager,
  type MemoryCandidate,
  type MemoryFilter,
  type MemoryProvenance,
  type MemoryType,
} from '@personal-ai-os/memory';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { MemoryRepository } from '../db/memory-repository.ts';

interface AuthUser {
  id: string;
  email: string;
}

/**
 * `:id` is a uuid. Without this, a path like `/v1/memories/search` reaches Postgres as a uuid
 * literal and the driver fails with `22P02`, turning a bad request into a 500.
 */
const idParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
} as const;

export function registerMemoryRoutes(
  app: FastifyInstance,
  options: { memoryRepo: MemoryRepository; auth?: AuthService | undefined },
): void {
  const { memoryRepo, auth } = options;
  const contextManager = new ContextManager();

  // Helper to extract authenticated user
  const getUser = async (req: FastifyRequest): Promise<AuthUser> => {
    if (auth) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthError('UNAUTHENTICATED', 'authentication required');
      }
      return auth.authenticate(authHeader.slice(7).trim());
    }
    return (
      (req as unknown as { user?: AuthUser }).user ?? {
        id: 'default-user',
        email: 'user@personal-ai-os.local',
      }
    );
  };

  // 1. Evaluate memory candidate with write policy
  app.post(
    '/v1/memories/evaluate',
    async (
      req: FastifyRequest<{
        Body: {
          content: string;
          type: MemoryType;
          scope?: string;
          provenance?: MemoryProvenance;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const { content, type, scope = 'user', provenance = 'user_explicit' } = req.body;

      const candidate: MemoryCandidate = {
        userId: user.id,
        content,
        type,
        scope,
        provenance,
      };

      const evaluation = memoryRepo.evaluateCandidate(candidate);
      return reply.send({ data: evaluation });
    },
  );

  // 2. Search memories (POST & GET registered BEFORE /:id to prevent route collision)
  const handleSearch = async (
    userId: string,
    query: string,
    projectId: string | undefined,
    type: MemoryType | undefined,
    limit: number,
    threshold: number,
    searchMode?: 'semantic' | 'text' | 'hybrid',
  ) => {
    const isActive =
      typeof memoryRepo.isSemanticSearchActive === 'function'
        ? memoryRepo.isSemanticSearchActive()
        : false;

    const results = await memoryRepo.searchSemantic(userId, {
      query,
      projectId,
      type,
      limit,
      threshold,
      searchMode,
    });

    const activeMode = results[0]?.searchMode ?? (isActive ? (searchMode ?? 'hybrid') : 'text_fallback');

    return {
      data: results,
      semanticSearchActive: isActive,
      searchMode: activeMode,
      status: isActive ? 'active' : 'inactive',
      notice: isActive
        ? undefined
        : 'Pencarian semantik saat ini inactive / nonaktif (belum ada provider embedding terverifikasi). Menggunakan pencarian teks hybrid PostgreSQL.',
    };
  };

  app.post(
    '/v1/memories/search',
    async (
      req: FastifyRequest<{
        Body: {
          query: string;
          projectId?: string;
          type?: MemoryType;
          limit?: number;
          threshold?: number;
          searchMode?: 'semantic' | 'text' | 'hybrid';
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const { query, projectId, type, limit = 10, threshold = 0.0, searchMode } = req.body;
      const response = await handleSearch(user.id, query, projectId, type, limit, threshold, searchMode);
      return reply.send(response);
    },
  );

  app.get(
    '/v1/memories/search',
    async (
      req: FastifyRequest<{
        Querystring: {
          q?: string;
          query?: string;
          projectId?: string;
          type?: MemoryType;
          limit?: string;
          threshold?: string;
          searchMode?: 'semantic' | 'text' | 'hybrid';
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const query = req.query.query || req.query.q || '';
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
      const threshold = req.query.threshold ? parseFloat(req.query.threshold) : 0.0;
      const response = await handleSearch(
        user.id,
        query,
        req.query.projectId,
        req.query.type,
        limit,
        threshold,
        req.query.searchMode,
      );
      return reply.send(response);
    },
  );

  // 3. Proposals queue management (registered BEFORE /:id)
  app.get(
    '/v1/memories/proposals',
    async (
      req: FastifyRequest<{
        Querystring: { projectId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const proposals = await memoryRepo.listProposals(
        user.id,
        req.query.projectId ? { projectId: req.query.projectId } : undefined,
      );
      return reply.send({ data: proposals });
    },
  );

  app.post(
    '/v1/memories/proposals/:id/approve',
    { schema: idParamsSchema },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      try {
        const approved = await memoryRepo.approveProposal(user.id, req.params.id);
        return reply.send({ data: approved, status: 'approved' });
      } catch (err) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );

  app.post(
    '/v1/memories/proposals/:id/reject',
    { schema: idParamsSchema },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      const rejected = await memoryRepo.rejectProposal(user.id, req.params.id);
      if (!rejected) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Proposal not found' },
        });
      }
      return reply.send({ success: true, status: 'rejected' });
    },
  );

  // 4. Sweeper endpoint
  app.post('/v1/memories/sweep', async (req: FastifyRequest, reply: FastifyReply) => {
    await getUser(req);
    const result = await memoryRepo.sweepExpiredMemories();
    return reply.send({ data: result });
  });

  // 5. Backfill embeddings endpoint
  app.post(
    '/v1/memories/backfill',
    async (
      req: FastifyRequest<{
        Body?: { batchSize?: number; maxRows?: number; rateLimitDelayMs?: number };
      }>,
      reply: FastifyReply,
    ) => {
      await getUser(req);
      const { batchSize = 20, maxRows = 100, rateLimitDelayMs = 250 } = req.body ?? {};
      const result = memoryRepo.backfillEmbeddings
        ? await memoryRepo.backfillEmbeddings(batchSize, maxRows, rateLimitDelayMs)
        : { processed: 0, success: 0, failed: 0 };
      return reply.send({ data: result });
    },
  );

  // 6. Store memory (evaluated first)
  app.post(
    '/v1/memories',
    async (
      req: FastifyRequest<{
        Body: {
          content: string;
          type: MemoryType;
          scope?: string;
          projectId?: string;
          provenance?: MemoryProvenance;
          metadata?: Record<string, unknown>;
          force?: boolean;
          isProposal?: boolean;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const {
        content,
        type,
        scope = 'user',
        projectId,
        provenance = 'user_explicit',
        metadata,
        force = false,
        isProposal = false,
      } = req.body;

      const candidate: MemoryCandidate = {
        userId: user.id,
        projectId,
        content,
        type,
        scope,
        provenance,
        metadata: {
          ...(metadata ?? {}),
          ...(isProposal ? { isProposal: true, status: 'proposed' } : {}),
        },
      };

      const evaluation = memoryRepo.evaluateCandidate(candidate);
      if (!evaluation.shouldStore && !force) {
        return reply.status(400).send({
          error: {
            code: 'MEMORY_POLICY_REJECTED',
            message: evaluation.reason,
            details: evaluation,
          },
        });
      }

      const sanitizedCandidate = {
        ...candidate,
        content: evaluation.sanitizedContent || candidate.content,
      };

      const stored = isProposal
        ? await memoryRepo.createProposal(sanitizedCandidate)
        : await memoryRepo.createMemory(sanitizedCandidate);

      return reply.status(201).send({ data: stored, evaluation });
    },
  );

  // 7. List memories
  app.get(
    '/v1/memories',
    async (
      req: FastifyRequest<{
        Querystring: {
          projectId?: string;
          type?: MemoryType;
          scope?: string;
          limit?: string;
          includeProposals?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const filter: MemoryFilter = {
        projectId: req.query.projectId,
        type: req.query.type,
        scope: req.query.scope,
        includeProposals: req.query.includeProposals === 'true',
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      };

      const list = await memoryRepo.listMemories(user.id, filter);
      return reply.send({ data: list });
    },
  );

  // 8. Parameterized :id routes (registered AFTER all static routes)
  // Get memory by ID
  app.get(
    '/v1/memories/:id',
    { schema: idParamsSchema },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      const item = await memoryRepo.getMemory(user.id, req.params.id);
      if (!item) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Memory not found' },
        });
      }
      return reply.send({ data: item });
    },
  );

  // Correct memory
  app.patch(
    '/v1/memories/:id',
    { schema: idParamsSchema },
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { content: string; provenance?: MemoryProvenance };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const { content, provenance = 'user_correction' } = req.body;

      try {
        const updated = await memoryRepo.correctMemory(user.id, req.params.id, content, provenance);
        return reply.send({ data: updated });
      } catch (err) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );

  // Delete memory
  app.delete(
    '/v1/memories/:id',
    { schema: idParamsSchema },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      const deleted = await memoryRepo.deleteMemory(user.id, req.params.id);
      if (!deleted) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Memory not found' },
        });
      }
      return reply.status(204).send();
    },
  );

  // 9. Assemble context with Context Manager (includes topK and returns usedMemories)
  app.post(
    '/v1/context/assemble',
    async (
      req: FastifyRequest<{
        Body: {
          systemPolicies?: string[];
          userPrompt: string;
          conversationHistory?: Array<{
            role: 'user' | 'assistant' | 'system' | 'tool';
            content: string;
          }>;
          toolOutputs?: Array<{ toolName: string; output: string }>;
          projectId?: string;
          tokenBudget?: number;
          topK?: number;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const {
        systemPolicies = [
          'Semua tindakan HIGH/CRITICAL memerlukan approval.',
          'Dilarang mencatat secret atau kredensial ke log.',
        ],
        userPrompt,
        conversationHistory = [],
        toolOutputs = [],
        projectId,
        tokenBudget = 4096,
        topK,
      } = req.body;

      // Fetch relevant active memories for this user
      const memoriesList = await memoryRepo.listMemories(user.id, {
        projectId,
        limit: 10,
      });

      const assembled = contextManager.assemble({
        systemPolicies,
        userPrompt,
        conversationHistory,
        relevantMemories:
          memoriesList as unknown as readonly import('@personal-ai-os/memory').MemoryRecord[],
        toolOutputs,
        options: { tokenBudget, topK },
      });

      return reply.send({ data: assembled });
    },
  );
}
