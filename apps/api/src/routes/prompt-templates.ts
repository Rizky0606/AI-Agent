import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { PromptTemplateRepository } from '../db/prompt-template-repository.ts';

export interface PromptTemplateRouteDependencies {
  auth: AuthService;
  promptTemplateRepo: PromptTemplateRepository;
}

export const registerPromptTemplateRoutes = (
  app: FastifyInstance,
  deps: PromptTemplateRouteDependencies,
): void => {
  const authenticate = async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError('UNAUTHENTICATED', 'authentication required');
    }
    return deps.auth.authenticate(authHeader.slice(7));
  };

  // 1. GET /v1/prompt-templates — List all templates for user
  app.get('/v1/prompt-templates', async (request: FastifyRequest, reply) => {
    const user = await authenticate(request);
    const templates = await deps.promptTemplateRepo.list(user.id);
    return reply.send({
      templates: templates.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  });

  // 2. POST /v1/prompt-templates — Create a new template
  app.post(
    '/v1/prompt-templates',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'title', 'content'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            content: { type: 'string', minLength: 1, maxLength: 20000 },
            variables: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { name: string; title: string; content: string; variables?: string[] };
      }>,
      reply,
    ) => {
      const user = await authenticate(request);
      try {
        const created = await deps.promptTemplateRepo.create(user.id, request.body);
        return reply.code(201).send({
          template: {
            ...created,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({
          error: {
            code: 'CREATE_FAILED',
            message: msg.includes('unique') ? 'Nama template sudah digunakan' : msg,
          },
        });
      }
    },
  );

  // 3. GET /v1/prompt-templates/:id — Get specific template
  app.get(
    '/v1/prompt-templates/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = await authenticate(request);
      const template = await deps.promptTemplateRepo.get(user.id, request.params.id);
      if (!template) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Template prompt tidak ditemukan' },
        });
      }
      return reply.send({
        template: {
          ...template,
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
        },
      });
    },
  );

  // 4. PUT /v1/prompt-templates/:id — Update template
  app.put(
    '/v1/prompt-templates/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            content: { type: 'string', minLength: 1, maxLength: 20000 },
            variables: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { title?: string; content?: string; variables?: string[] };
      }>,
      reply,
    ) => {
      const user = await authenticate(request);
      const updated = await deps.promptTemplateRepo.update(
        user.id,
        request.params.id,
        request.body,
      );
      if (!updated) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Template prompt tidak ditemukan' },
        });
      }
      return reply.send({
        template: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    },
  );

  // 5. DELETE /v1/prompt-templates/:id — Delete template
  app.delete(
    '/v1/prompt-templates/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const user = await authenticate(request);
      const ok = await deps.promptTemplateRepo.delete(user.id, request.params.id);
      if (!ok) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Template prompt tidak ditemukan' },
        });
      }
      return reply.send({ success: true });
    },
  );
};
