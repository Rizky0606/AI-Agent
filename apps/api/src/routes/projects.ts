import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ChatRepository } from '../db/chat-repository.ts';
import type { ProjectRepository } from '../db/project-repository.ts';

import type { AuditRepository } from '../db/audit-repository.ts';

export interface ProjectRouteDependencies {
  auth: AuthService;
  projectRepo: ProjectRepository;
  chatRepo: ChatRepository;
  audit?: AuditRepository | undefined;
}

const extractUser = async (request: FastifyRequest, auth: AuthService) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHENTICATED', 'authentication required');
  }
  const token = authHeader.slice(7).trim();
  return auth.authenticate(token);
};

export const registerProjectRoutes = (
  app: FastifyInstance,
  deps: ProjectRouteDependencies,
): void => {
  // 1. Create project
  app.post(
    '/v1/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const body = request.body as { name: string; description?: string };
      const project = await deps.projectRepo.createProject(user.id, body.name, body.description);
      return reply.code(201).send(project);
    },
  );

  // 2. List projects
  app.get('/v1/projects', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const projects = await deps.projectRepo.listProjects(user.id);
    return reply.send({ projects });
  });

  // 3. Get project by ID
  app.get<{ Params: { projectId: string } }>('/v1/projects/:projectId', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const project = await deps.projectRepo.getProject(user.id, request.params.projectId);
    if (!project) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Project not found',
          requestId: request.id,
        },
      });
    }
    return reply.send(project);
  });

  // 4. Update project
  app.patch<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const body = request.body as { name?: string; description?: string };
      const updated = await deps.projectRepo.updateProject(user.id, request.params.projectId, body);
      if (!updated) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
            requestId: request.id,
          },
        });
      }
      return reply.send(updated);
    },
  );

  // 5. Delete project
  app.delete<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId',
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const deleted = await deps.projectRepo.deleteProject(user.id, request.params.projectId);
      if (!deleted) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
            requestId: request.id,
          },
        });
      }
      return reply.code(204).send();
    },
  );

  // 6. Create conversation under project
  app.post<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/conversations',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const project = await deps.projectRepo.getProject(user.id, request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
            requestId: request.id,
          },
        });
      }

      const body = (request.body as { title?: string } | undefined) ?? {};
      const conversation = await deps.chatRepo.createConversation(
        user.id,
        request.params.projectId,
        body.title,
      );
      return reply.code(201).send(conversation);
    },
  );

  // 7. List conversations under project
  app.get<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/conversations',
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const project = await deps.projectRepo.getProject(user.id, request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
            requestId: request.id,
          },
        });
      }

      const conversations = await deps.chatRepo.listConversations(
        user.id,
        request.params.projectId,
      );
      return reply.send({ conversations });
    },
  );

  // 8. Get conversation by ID
  app.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId',
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const conv = await deps.chatRepo.getConversation(user.id, request.params.conversationId);
      if (!conv) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Conversation not found',
            requestId: request.id,
          },
        });
      }
      const messages = await deps.chatRepo.getMessages(user.id, conv.id);
      return reply.send({ ...conv, messages });
    },
  );

  // 9. Update conversation
  app.patch<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            model: { type: ['string', 'null'], maxLength: 200 },
            mode: { type: 'string', enum: ['auto', 'fast', 'coding', 'complex', 'research'] },
            workspaceId: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const body = request.body as {
        title?: string;
        model?: string | null;
        mode?: 'auto' | 'fast' | 'coding' | 'complex' | 'research';
        workspaceId?: string | null;
      };
      const updated = await deps.chatRepo.updateConversation(
        user.id,
        request.params.conversationId,
        {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.model !== undefined ? { model: body.model } : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.workspaceId !== undefined ? { workspaceId: body.workspaceId } : {}),
        },
      );
      if (!updated) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Conversation not found',
            requestId: request.id,
          },
        });
      }

      if (deps.audit && (body.model !== undefined || body.mode !== undefined)) {
        await deps.audit.log({
          userId: user.id,
          action: 'conversation.model.updated',
          resourceType: 'conversation',
          resourceId: request.params.conversationId,
          decision: 'allow',
          metadata: { model: body.model, mode: body.mode },
        });
      }

      return reply.send(updated);
    },
  );

  // 10. Delete conversation
  app.delete<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId',
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const deleted = await deps.chatRepo.deleteConversation(
        user.id,
        request.params.conversationId,
      );
      if (!deleted) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Conversation not found',
            requestId: request.id,
          },
        });
      }
      return reply.code(204).send();
    },
  );
};
