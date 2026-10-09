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

  // 2. Store memory (evaluated first)
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
      } = req.body;

      const candidate: MemoryCandidate = {
        userId: user.id,
        projectId,
        content,
        type,
        scope,
        provenance,
        metadata,
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

      const stored = await memoryRepo.createMemory({
        ...candidate,
        content: evaluation.sanitizedContent || candidate.content,
      });

      return reply.status(201).send({ data: stored, evaluation });
    },
  );

  // 3. List memories
  app.get(
    '/v1/memories',
    async (
      req: FastifyRequest<{
        Querystring: {
          projectId?: string;
          type?: MemoryType;
          scope?: string;
          limit?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const filter: MemoryFilter = {
        projectId: req.query.projectId,
        type: req.query.type,
        scope: req.query.scope,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      };

      const list = await memoryRepo.listMemories(user.id, filter);
      return reply.send({ data: list });
    },
  );

  // 4. Get memory by ID
  app.get(
    '/v1/memories/:id',
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

  // 5. Correct memory
  app.patch(
    '/v1/memories/:id',
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

  // 6. Delete memory
  app.delete(
    '/v1/memories/:id',
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

  // 7. Semantic search
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
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const { query, projectId, type, limit = 5, threshold = 0.0 } = req.body;

      const results = await memoryRepo.searchSemantic(user.id, {
        query,
        projectId,
        type,
        limit,
        threshold,
      });

      return reply.send({ data: results });
    },
  );

  // 8. Assemble context with Context Manager
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
      } = req.body;

      // Fetch relevant memories for this user
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
        options: { tokenBudget },
      });

      return reply.send({ data: assembled });
    },
  );
}
