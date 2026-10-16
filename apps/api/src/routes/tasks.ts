import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ProjectRepository } from '../db/project-repository.ts';
import type { TaskRepository } from '../db/task-repository.ts';
import type { ChatRepository } from '../db/chat-repository.ts';
import type { TaskEventBroadcaster } from '../services/event-broadcaster.ts';
import type { TaskQueue } from '../services/task-queue.ts';
import { createVersionedCheckpoint } from '@personal-ai-os/shared';

export interface TaskRouteDependencies {
  auth: AuthService;
  projectRepo: ProjectRepository;
  chatRepo: ChatRepository;
  taskRepo: TaskRepository;
  taskQueue: TaskQueue;
  broadcaster: TaskEventBroadcaster;
}

const extractUser = async (request: FastifyRequest, auth: AuthService) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHENTICATED', 'authentication required');
  }
  const token = authHeader.slice(7).trim();
  return auth.authenticate(token);
};

export const registerTaskRoutes = (app: FastifyInstance, deps: TaskRouteDependencies): void => {
  // 1. Create Task
  app.post(
    '/v1/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'kind', 'payload'],
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            kind: { type: 'string', minLength: 1, maxLength: 80 },
            payload: { type: 'object' },
            idempotencyKey: { type: 'string', maxLength: 128 },
            conversationId: { type: 'string', format: 'uuid' },
            priority: { type: 'integer', minimum: -20, maximum: 20 },
            maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const body = request.body as {
        projectId: string;
        kind: string;
        payload: Record<string, unknown>;
        idempotencyKey?: string;
        conversationId?: string;
        priority?: number;
        maxAttempts?: number;
      };
      const requestedMode = body.payload.mode;
      if (
        requestedMode !== undefined &&
        requestedMode !== 'auto' &&
        requestedMode !== 'fast' &&
        requestedMode !== 'coding' &&
        requestedMode !== 'complex' &&
        requestedMode !== 'research'
      ) {
        return reply.code(400).send({
          error: { code: 'INVALID_MODE', message: 'payload.mode must be auto, fast, coding, complex, or research', requestId: request.id },
        });
      }
      const requestedRuntime = body.payload.runtime;
      if (
        requestedRuntime !== undefined &&
        requestedRuntime !== 'auto' &&
        requestedRuntime !== 'omp' &&
        requestedRuntime !== 'hermes' &&
        requestedRuntime !== 'native'
      ) {
        return reply.code(400).send({
          error: { code: 'INVALID_RUNTIME', message: 'payload.runtime must be auto, omp, hermes, or native', requestId: request.id },
        });
      }
      // Ensure project exists and belongs to user
      const project = await deps.projectRepo.getProject(user.id, body.projectId);
      if (!project) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Project not found',
            requestId: request.id,
          },
        });
      }

      // A task launched from chat carries its conversation; ownership is checked like any other
      // resource so a guessed uuid cannot attach a task to someone else's transcript.
      if (body.conversationId) {
        const conversation = await deps.chatRepo.getConversation(user.id, body.conversationId);
        if (!conversation) {
          return reply.code(404).send({
            error: { code: 'NOT_FOUND', message: 'Conversation not found', requestId: request.id },
          });
        }
      }

      const outgoingTraceparent =
        (reply.getHeader('traceparent') as string | undefined) ??
        (typeof request.headers['traceparent'] === 'string' ? request.headers['traceparent'] : undefined);
      const enrichedPayload = {
        ...body.payload,
        ...(outgoingTraceparent && !body.payload.traceparent ? { traceparent: outgoingTraceparent } : {}),
      };

      const { task, isDuplicate } = await deps.taskRepo.createTask({
        userId: user.id,
        projectId: body.projectId,
        kind: body.kind,
        payload: enrichedPayload,
        conversationId: body.conversationId ?? null,
        idempotencyKey: body.idempotencyKey,
        priority: body.priority,
        maxAttempts: body.maxAttempts,
      });

      if (!isDuplicate) {
        // Record and emit task.created event
        const createdEvent = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.created', {
          projectId: task.projectId,
          kind: task.kind,
          priority: task.priority,
          ...(task.conversationId ? { conversationId: task.conversationId } : {}),
        });
        deps.broadcaster.publish(createdEvent);

        // Enqueue to BullMQ
        await deps.taskQueue.enqueue(task);
        return reply.code(201).send({ task, isDuplicate: false });
      }

      // Idempotent duplicate: return existing task
      return reply.code(200).send({ task, isDuplicate: true });
    },
  );

  // 2. Get Task by ID
  app.get<{ Params: { taskId: string } }>('/v1/tasks/:taskId', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const task = await deps.taskRepo.getTask(user.id, request.params.taskId);
    if (!task) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          requestId: request.id,
        },
      });
    }
    return reply.send(task);
  });

  // 3. List Tasks for Project
  app.get<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/tasks',
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

      const tasks = await deps.taskRepo.listTasks(user.id, { projectId: request.params.projectId });
      return reply.send({ tasks });
    },
  );

  // 3b. List Tasks for authenticated user (optionally filtered by projectId or status)
  app.get<{ Querystring: { projectId?: string; status?: string; conversationId?: string } }>(
    '/v1/tasks',
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const { projectId, status, conversationId } = request.query;
      if (projectId) {
        const project = await deps.projectRepo.getProject(user.id, projectId);
        if (!project) {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Project not found',
              requestId: request.id,
            },
          });
        }
      }

      let tasks = await deps.taskRepo.listTasks(user.id, { projectId, conversationId });
      if (status) {
        tasks = tasks.filter((t) => t.status === status);
      }
      return reply.send({ tasks });
    },
  );

  // 4. Pause Task
  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/pause', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const task = await deps.taskRepo.getTask(user.id, request.params.taskId);
    if (!task) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          requestId: request.id,
        },
      });
    }

    const updated = await deps.taskRepo.updateTaskStatus(user.id, task.id, 'paused');
    const pauseEvent = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.paused', {
      reason: 'User requested pause via API',
    });
    deps.broadcaster.publish(pauseEvent);

    return reply.send(updated);
  });

  // 5. Resume Task
  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/resume', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const task = await deps.taskRepo.getTask(user.id, request.params.taskId);
    if (!task) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          requestId: request.id,
        },
      });
    }

    const updated = await deps.taskRepo.updateTaskStatus(user.id, task.id, 'queued');
    const resumeEvent = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.resumed', {
      resumedFromStep: (task.checkpoint?.stepIndex ?? 0) + 1,
    });
    deps.broadcaster.publish(resumeEvent);

    // Re-enqueue for worker processing
    await deps.taskQueue.enqueue(updated);

    return reply.send(updated);
  });

  // 6. Cancel Task
  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/cancel', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const task = await deps.taskRepo.getTask(user.id, request.params.taskId);
    if (!task) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          requestId: request.id,
        },
      });
    }

    // If already terminal, return existing
    if (task.status === 'cancelled') {
      return reply.send(task);
    }

    const updated = await deps.taskRepo.updateTaskStatus(user.id, task.id, 'cancelled');
    await deps.taskQueue.cancel(task.id);

    const cancelEvent = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.cancelled', {
      reason: 'User cancelled task via API',
    });
    deps.broadcaster.publish(cancelEvent);

    return reply.send(updated);
  });

  // 7. Approve Task (when in waiting_approval)
  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/approve', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const task = await deps.taskRepo.getTask(user.id, request.params.taskId);
    if (!task) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          requestId: request.id,
        },
      });
    }

    if (task.status !== 'waiting_approval') {
      return reply.code(400).send({
        error: {
          code: 'INVALID_STATE',
          message: `Task is in '${task.status}', not in 'waiting_approval'`,
          requestId: request.id,
        },
      });
    }

    const checkpoint = createVersionedCheckpoint({
      version: (task.checkpoint?.version ?? 0) + 1,
      stepIndex: 3,
      totalSteps: 4,
      lastExecutedAction: 'waiting_approval',
      actionType: 'approval',
      actionState: { ...task.checkpoint?.actionState, approved: true },
      verified: true,
    });

    const updated = await deps.taskRepo.updateTaskStatus(user.id, task.id, 'running', {
      checkpoint,
    });

    const approveEvent = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.progress', {
      approved: true,
      action: 'user_approved',
    });
    deps.broadcaster.publish(approveEvent);

    // Re-enqueue to finish remaining steps
    await deps.taskQueue.enqueue(updated);

    return reply.send(updated);
  });

  // 8. Get Task Historical Events
  app.get<{
    Params: { taskId: string };
    Querystring: { afterEventId?: string; limit?: string };
  }>('/v1/tasks/:taskId/events', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const task = await deps.taskRepo.getTask(user.id, request.params.taskId);
    if (!task) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          requestId: request.id,
        },
      });
    }

    const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined;
    const events = await deps.taskRepo.getTaskEvents(user.id, task.id, {
      afterEventId: request.query.afterEventId,
      limit,
    });

    return reply.send({ events });
  });
};
