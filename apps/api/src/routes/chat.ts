import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { AuthService, AuthUser } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ChatRepository } from '../db/chat-repository.ts';
import type { ModelConfigRepository } from '../db/model-config-repository.ts';
import type { ModelRouter } from '../services/model-router.ts';
import type { ModelGateway } from '@personal-ai-os/model-gateway';
import { ModelGatewayError } from '@personal-ai-os/model-gateway';

export type ChatRouteDependencies = {
  auth: AuthService;
  chatRepo: ChatRepository;
  router: ModelRouter;
  modelConfigs: ModelConfigRepository;
  gateway: ModelGateway;
};

type ChatMode = 'auto' | 'fast' | 'coding' | 'complex' | 'research';

const taskTypeForMode = (mode: ChatMode | undefined): 'chat' | 'coding' | 'research' | undefined =>
  mode === 'coding' ? 'coding' : mode === 'research' ? 'research' : 'chat';


type IncomingWsMessage =
  | { type: 'auth'; token: string }
  | {
      type: 'chat.send';
      conversationId?: string;
      projectId?: string;
      workspaceId?: string;
      model?: string;
      mode?: ChatMode;
      content: string;
      attachments?: Array<{ type: 'image'; url: string }>;
    }
  | { type: 'chat.cancel'; messageId?: string }
  | { type: 'ping' };

export const registerChatRoutes = (app: FastifyInstance, deps: ChatRouteDependencies): void => {

  // HTTP REST chat completion endpoint
  app.post(
    '/v1/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            workspaceId: { type: 'string', format: 'uuid' },
            model: { type: 'string', minLength: 1, maxLength: 200 },
            mode: { type: 'string', enum: ['auto', 'fast', 'coding', 'complex', 'research'] },
            content: { type: 'string', minLength: 1, maxLength: 30000 },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                required: ['type', 'url'],
                properties: {
                  type: { type: 'string', enum: ['image'] },
                  url: { type: 'string', minLength: 1 },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthError('UNAUTHENTICATED', 'authentication required');
      }
      const user = await deps.auth.authenticate(authHeader.slice(7));

      const body = request.body as {
        conversationId?: string;
        projectId?: string;
        workspaceId?: string;
        model?: string;
        mode?: ChatMode;
        content: string;
        attachments?: Array<{ type: 'image'; url: string }>;
      };
      const hasVisionAttachments = Boolean(body.attachments && body.attachments.length > 0);
      const projectId = body.projectId ?? (await deps.chatRepo.getOrCreateDefaultProject(user.id));
      const sessionMetadata = {
        mode: body.mode ?? 'auto',
        model: body.model ?? null,
        workspaceId: body.workspaceId ?? null,
      };
      const conversationId = await deps.chatRepo.getOrCreateConversation(
        user.id,
        projectId,
        body.conversationId,
        undefined,
        sessionMetadata,
      );
      if (body.conversationId && (body.mode || body.model || body.workspaceId)) {
        await deps.chatRepo.updateConversation(user.id, conversationId, sessionMetadata);
      }

      await deps.chatRepo.appendMessage(user.id, conversationId, 'user', body.content, {
        attachments: body.attachments,
        mode: body.mode ?? 'auto',
        model: body.model ?? null,
        workspaceId: body.workspaceId ?? null,
      });
      // Fetch history for context
      const history = await deps.chatRepo.getMessages(user.id, conversationId);
      const messages = history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const requirements = { requiresVision: hasVisionAttachments, preferredModel: body.model, taskType: taskTypeForMode(body.mode) };
      const resolution = await deps.router.resolveModel(requirements);
      if (!resolution.ok) {
        return reply.code(400).send({
          error: {
            code: resolution.error,
            message: resolution.message,
            requestId: request.id,
          },
        });
      }

      const response = await deps.router.chat(
        { messages },
        requirements,
      );

      // Persist assistant message
      const savedAssistant = await deps.chatRepo.appendMessage(
        user.id,
        conversationId,
        'assistant',
        response.content,
        {
          usage: response.usage,
          resolvedModel: response.resolvedModel,
          fallbackUsed: response.fallbackUsed,
          mode: body.mode ?? 'auto',
          model: body.model ?? null,
          workspaceId: body.workspaceId ?? null,
        },
      );

      return reply.send({
        conversationId,
        message: {
          id: savedAssistant.id,
          role: 'assistant',
          content: savedAssistant.content,
          createdAt: savedAssistant.createdAt,
        },
        usage: response.usage,
        resolvedModel: response.resolvedModel,
        mode: body.mode ?? 'auto',
      });
    },
  );

  // WebSocket chat streaming endpoint
  app.get('/v1/chat/ws', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    let currentUser: AuthUser | null = null;
    const activeStreams = new Map<string, AbortController>();

    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    };

    // Authenticate via query token or Authorization header if provided at handshake
    const query = request.query as Record<string, string | undefined>;
    const tokenCandidate =
      query.token ??
      (request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7)
        : undefined);

    if (tokenCandidate) {
      deps.auth
        .authenticate(tokenCandidate)
        .then((user) => {
          currentUser = user;
          send({ type: 'auth.ok', userId: user.id });
        })
        .catch(() => {
          send({ type: 'error', code: 'UNAUTHENTICATED', message: 'Invalid authentication token' });
          socket.close(1008, 'Authentication failed');
        });
    }

    socket.on('message', async (raw: Buffer | string) => {
      let data: IncomingWsMessage;
      try {
        data = JSON.parse(raw.toString()) as IncomingWsMessage;
      } catch {
        send({ type: 'error', code: 'INVALID_JSON', message: 'Malformed JSON payload' });
        return;
      }

      if (data.type === 'ping') {
        send({ type: 'pong' });
        return;
      }

      if (data.type === 'auth') {
        try {
          currentUser = await deps.auth.authenticate(data.token);
          send({ type: 'auth.ok', userId: currentUser.id });
        } catch {
          send({ type: 'error', code: 'UNAUTHENTICATED', message: 'Authentication failed' });
          socket.close(1008, 'Authentication failed');
        }
        return;
      }

      if (!currentUser) {
        send({
          type: 'error',
          code: 'UNAUTHENTICATED',
          message: 'Authentication required before sending messages',
        });
        return;
      }

      if (data.type === 'chat.cancel') {
        if (data.messageId && activeStreams.has(data.messageId)) {
          const controller = activeStreams.get(data.messageId)!;
          controller.abort();
          activeStreams.delete(data.messageId);
        } else {
          // Cancel all active streams for this socket if messageId is omitted
          for (const controller of activeStreams.values()) {
            controller.abort();
          }
          activeStreams.clear();
        }
        return;
      }

      if (data.type === 'chat.send') {
        const hasVisionAttachments = Boolean(data.attachments && data.attachments.length > 0);

        const requirements = {
          requiresVision: hasVisionAttachments,
          requiresStreaming: true,
          preferredModel: data.model,
          taskType: taskTypeForMode(data.mode),
        };
        const resolution = await deps.router.resolveModel(requirements);
        if (!resolution.ok) {
          send({ type: 'error', code: resolution.error, message: resolution.message });
          return;
        }

        const user = currentUser;
        const assistantMessageId = randomUUID();
        const controller = new AbortController();
        activeStreams.set(assistantMessageId, controller);

        let conversationId = data.conversationId;
        try {
          const projectId =
            data.projectId ?? (await deps.chatRepo.getOrCreateDefaultProject(user.id));
          const sessionMetadata = {
            mode: data.mode ?? 'auto',
            model: data.model ?? null,
            workspaceId: data.workspaceId ?? null,
          };
          conversationId = await deps.chatRepo.getOrCreateConversation(
            user.id,
            projectId,
            data.conversationId,
            undefined,
            sessionMetadata,
          );
          if (data.conversationId && (data.mode || data.model || data.workspaceId)) {
            await deps.chatRepo.updateConversation(user.id, conversationId, sessionMetadata);
          }

          if (!data.conversationId) {
            send({ type: 'conversation.created', conversationId });
          }

          // Persist user prompt
          await deps.chatRepo.appendMessage(user.id, conversationId, 'user', data.content, {
            attachments: data.attachments,
            mode: data.mode ?? 'auto',
            model: data.model ?? null,
            workspaceId: data.workspaceId ?? null,
          });

          // Fetch context messages
          const history = await deps.chatRepo.getMessages(user.id, conversationId);
          const messages = history.map((m) => ({
            role: m.role,
            content: m.content,
          }));

          let accumulated = '';
          let lastUsage: Record<string, unknown> | undefined;
          let resolvedModel = 'default';

          const stream = deps.router.stream(
            { messages, signal: controller.signal },
            requirements,
          );

          for await (const chunk of stream) {
            if (controller.signal.aborted) {
              break;
            }

            resolvedModel = chunk.resolvedModel;
            if (chunk.delta) {
              accumulated += chunk.delta;
              send({
                type: 'message.delta',
                messageId: assistantMessageId,
                delta: chunk.delta,
              });
            }
            if (chunk.usage) {
              lastUsage = chunk.usage;
            }
          }
          if (controller.signal.aborted) {
            await deps.chatRepo.appendMessage(user.id, conversationId, 'assistant', accumulated, {
              cancelled: true,
              resolvedModel,
              mode: data.mode ?? 'auto',
              model: data.model ?? null,
              workspaceId: data.workspaceId ?? null,
            });
            send({
              type: 'message.cancelled',
              messageId: assistantMessageId,
              content: accumulated,
            });
          } else {
            await deps.chatRepo.appendMessage(user.id, conversationId, 'assistant', accumulated, {
              usage: lastUsage,
              resolvedModel,
              mode: data.mode ?? 'auto',
              model: data.model ?? null,
              workspaceId: data.workspaceId ?? null,
            });
            send({
              type: 'message.completed',
              messageId: assistantMessageId,
              content: accumulated,
              usage: lastUsage,
              resolvedModel,
              mode: data.mode ?? 'auto',
            });
          }
        } catch (err) {
          if (controller.signal.aborted) {
            if (conversationId) {
              await deps.chatRepo.appendMessage(user.id, conversationId, 'assistant', '', {
                cancelled: true,
                mode: data.mode ?? 'auto',
                model: data.model ?? null,
                workspaceId: data.workspaceId ?? null,
              });
            }
            send({
              type: 'message.cancelled',
              messageId: assistantMessageId,
              content: '',
            });
          } else {
            const code = err instanceof ModelGatewayError ? err.code : 'STREAM_ERROR';
            const message = err instanceof Error ? err.message : 'Chat streaming failed';
            send({ type: 'error', code, message });
          }
        } finally {
          activeStreams.delete(assistantMessageId);
        }
      }
    });

    socket.on('close', () => {
      for (const controller of activeStreams.values()) {
        controller.abort();
      }
      activeStreams.clear();
    });
  });
};
