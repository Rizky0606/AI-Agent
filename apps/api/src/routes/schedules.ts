import {
  EventEngine,
  NotificationEngine,
  SchedulerEngine,
  type MissedRunPolicy,
  type NotificationPreferences,
  type ScheduleType,
  type TaskPayload,
} from '@personal-ai-os/scheduler';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';

interface AuthUser {
  id: string;
  email: string;
}

export interface SchedulesRoutesOptions {
  auth: AuthService;
  schedulerEngine: SchedulerEngine;
  eventEngine: EventEngine;
  notificationEngine: NotificationEngine;
}

export const registerSchedulesRoutes = async (
  fastify: FastifyInstance,
  options: SchedulesRoutesOptions,
): Promise<void> => {
  const { auth, schedulerEngine, eventEngine, notificationEngine } = options;

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthUser | undefined> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      void reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authorization header format Bearer <token> required',
        },
      });
      return undefined;
    }
    const token = authHeader.slice(7).trim();
    try {
      const authUser = await auth.authenticate(token);
      return { id: authUser.id, email: authUser.email };
    } catch {
      void reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Token akses tidak valid atau telah kedaluwarsa' },
      });
      return undefined;
    }
  };

  // 1. Create Schedule
  fastify.post(
    '/v1/schedules',
    async (
      request: FastifyRequest<{
        Body: {
          name: string;
          type: ScheduleType;
          projectId?: string;
          runAt?: string;
          cronExpression?: string;
          timezone?: string;
          missedRunPolicy?: MissedRunPolicy;
          taskPayload: TaskPayload;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const body = request.body;
      if (!body.name || !body.type || !body.taskPayload) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Field name, type, dan taskPayload wajib diisi',
          },
        });
      }

      // Accept {kind, payload} shape and normalize to TaskPayload {kind, input}
      const rawPayload = body.taskPayload as unknown as Record<string, unknown>;
      const normalizedTaskPayload = {
        kind: String(rawPayload.kind ?? ''),
        input: (rawPayload.input ?? rawPayload.payload ?? {}) as Record<string, unknown>,
        priority: typeof rawPayload.priority === 'number' ? rawPayload.priority : undefined,
      };
      if (!normalizedTaskPayload.kind) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'taskPayload.kind wajib diisi',
          },
        });
      }

      try {
        const job = schedulerEngine.registerSchedule({
          userId: user.id,
          name: body.name,
          type: body.type,
          projectId: body.projectId,
          runAt: body.runAt,
          cronExpression: body.cronExpression,
          timezone: body.timezone || 'Asia/Jakarta',
          missedRunPolicy: body.missedRunPolicy,
          taskPayload: normalizedTaskPayload,
        });

        return reply.code(201).send({ schedule: job });
      } catch (err: unknown) {
        return reply.code(400).send({
          error: {
            code: 'SCHEDULE_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );

  // 2. List Schedules
  fastify.get(
    '/v1/schedules',
    async (
      request: FastifyRequest<{
        Querystring: { status?: 'active' | 'paused' | 'completed' | 'cancelled' };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const filter: {
        userId: string;
        status?: 'active' | 'paused' | 'completed' | 'cancelled' | undefined;
      } = {
        userId: user.id,
      };
      if (request.query.status) {
        filter.status = request.query.status;
      }

      const schedulesList = schedulerEngine.listJobs(filter);

      return reply.code(200).send({ schedules: schedulesList });
    },
  );

  // 3. Get Schedule Detail
  fastify.get(
    '/v1/schedules/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const job = schedulerEngine.getJob(request.params.id);
      if (!job || job.userId !== user.id) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Jadwal tidak ditemukan' } });
      }

      return reply.code(200).send({ schedule: job });
    },
  );

  // 4. Pause Schedule
  fastify.post(
    '/v1/schedules/:id/pause',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const job = schedulerEngine.getJob(request.params.id);
      if (!job || job.userId !== user.id) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Jadwal tidak ditemukan' } });
      }

      const updated = schedulerEngine.pauseSchedule(job.id);
      return reply.code(200).send({ schedule: updated });
    },
  );

  // 5. Resume Schedule
  fastify.post(
    '/v1/schedules/:id/resume',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const job = schedulerEngine.getJob(request.params.id);
      if (!job || job.userId !== user.id) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Jadwal tidak ditemukan' } });
      }

      const updated = schedulerEngine.resumeSchedule(job.id);
      return reply.code(200).send({ schedule: updated });
    },
  );

  // 6. Cancel Schedule
  fastify.delete(
    '/v1/schedules/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const job = schedulerEngine.getJob(request.params.id);
      if (!job || job.userId !== user.id) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Jadwal tidak ditemukan' } });
      }

      const updated = schedulerEngine.cancelSchedule(job.id);
      return reply.code(200).send({ schedule: updated });
    },
  );

  // 6b. Update Schedule
  fastify.patch(
    '/v1/schedules/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          name?: string;
          cronExpression?: string;
          runAt?: string;
          timezone?: string;
          missedRunPolicy?: MissedRunPolicy;
          taskPayload?: TaskPayload;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const job = schedulerEngine.getJob(request.params.id);
      if (!job || job.userId !== user.id) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Jadwal tidak ditemukan' } });
      }

      const body = request.body ?? {};
      let normalizedTaskPayload: TaskPayload | undefined;
      if (body.taskPayload) {
        const rawPayload = body.taskPayload as unknown as Record<string, unknown>;
        normalizedTaskPayload = {
          kind: String(rawPayload.kind ?? job.taskPayload.kind),
          input: (rawPayload.input ?? rawPayload.payload ?? job.taskPayload.input) as Record<string, unknown>,
          priority: typeof rawPayload.priority === 'number' ? rawPayload.priority : job.taskPayload.priority,
        };
      }

      try {
        const updated = schedulerEngine.updateSchedule(job.id, {
          name: body.name,
          cronExpression: body.cronExpression,
          runAt: body.runAt,
          timezone: body.timezone,
          missedRunPolicy: body.missedRunPolicy,
          taskPayload: normalizedTaskPayload,
        });

        return reply.code(200).send({ schedule: updated });
      } catch (err: unknown) {
        return reply.code(400).send({
          error: {
            code: 'SCHEDULE_UPDATE_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );

  // 7. Event Ingestion
  fastify.post('/v1/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await authenticate(request, reply);
    if (!user) return;

    try {
      const result = await eventEngine.processEvent(request.body);
      return reply.code(200).send({ result });
    } catch (err: unknown) {
      return reply.code(400).send({
        error: {
          code: 'EVENT_VALIDATION_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // 8. Notifications List
  fastify.get('/v1/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await authenticate(request, reply);
    if (!user) return;

    const list = await notificationEngine.listNotifications(user.id);
    return reply.code(200).send({ notifications: list });
  });

  // 9. Mark Notification as Read
  fastify.post(
    '/v1/notifications/:id/read',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const notif = await notificationEngine.getNotification(request.params.id);
      if (!notif || notif.userId !== user.id) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Notifikasi tidak ditemukan' } });
      }

      const updated = await notificationEngine.markAsRead(notif.id);
      return reply.code(200).send({ notification: updated });
    },
  );

  // 10. Notification Preferences
  fastify.get(
    '/v1/notifications/preferences',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const prefs = await notificationEngine.getUserPreferences(user.id);
      return reply.code(200).send({ preferences: prefs });
    },
  );

  fastify.put(
    '/v1/notifications/preferences',
    async (
      request: FastifyRequest<{ Body: { preferences: NotificationPreferences } }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      if (!request.body.preferences) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Field preferences wajib diisi',
          },
        });
      }

      await notificationEngine.setUserPreferences(user.id, request.body.preferences);
      return reply.code(200).send({ preferences: request.body.preferences });
    },
  );
};
