import type { ToolRegistry } from '@personal-ai-os/tools';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { AuthError, type AuthService, type AuthUser } from './auth/service.ts';
import type { ChatRepository } from './db/chat-repository.ts';
import type { ModelConfigRepository } from './db/model-config-repository.ts';
import type { ProjectRepository } from './db/project-repository.ts';
import type { TaskRepository } from './db/task-repository.ts';
import type { ModelGateway } from '@personal-ai-os/model-gateway';
import type { TaskEventBroadcaster } from './services/event-broadcaster.ts';
import type { TaskQueue } from './services/task-queue.ts';
import type { ModelRouter } from './services/model-router.ts';
import { defaultTracer, IllegalTaskStateTransitionError } from '@personal-ai-os/shared';
import { registerChatRoutes } from './routes/chat.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import type { ApprovalRepository } from './db/approval-repository.ts';
import type { AuditRepository } from './db/audit-repository.ts';
import { registerTaskRoutes } from './routes/tasks.ts';
import { registerEventsWsRoute } from './routes/events-ws.ts';
import { registerApprovalRoutes } from './routes/approvals.ts';
import type { DeviceConnectionManager } from './services/device-connection-manager.ts';
import { registerAgentWsRoute } from './routes/agent-ws.ts';
import { registerDeviceCommandRoutes } from './routes/device-commands.ts';
import type { MemoryRepository } from './db/memory-repository.ts';
import { registerMemoryRoutes } from './routes/memory.ts';
import type { ArtifactManager } from '@personal-ai-os/tools';
import { registerArtifactRoutes } from './routes/artifacts.ts';
import type { SkillRepository } from './db/skill-repository.ts';
import { registerSkillRoutes } from './routes/skills.ts';
import { EventEngine, NotificationEngine, SchedulerEngine } from '@personal-ai-os/scheduler';
import { registerSchedulesRoutes } from './routes/schedules.ts';
import { registerModelRoutes } from './routes/models.ts';
export type AppDependencies = {
  auth: AuthService;
  health?: { database: () => Promise<boolean>; redis: () => Promise<boolean> } | undefined;
  deviceManager?: DeviceConnectionManager | undefined;
  /**
   * Shared service token for `/v1/internal/*`. The worker dispatches device commands through
   * those routes because the device sockets only exist in this process. Unset means the routes
   * are not mounted at all, so dispatch fails closed instead of running unauthenticated.
   */
  internalBridgeToken?: string | undefined;
  listDevices?:
    | ((userId: string) => Promise<
        Array<{
          id: string;
          name: string;
          platform: string;
          lastSeenAt?: Date | null | undefined;
          isOnline?: boolean | undefined;
        }>
      >)
    | undefined;
  /**
   * Resolves the row a verified device key belongs to, creating it on first contact. The agent
   * never picks its own id: the handshake verifies a signature and the server answers with
   * `devices.id`.
   */
  registerAgent?:
    | ((
        userId: string,
        input: { name: string; platform: string; publicKey: string },
      ) => Promise<{ id: string; name: string; platform: string }>)
    | undefined;
  registerDevice?: (
    userId: string,
    input: { name: string; platform: string },
  ) => Promise<{ id: string; name: string; platform: string }> | undefined;

  /**
   * Stores the FCM registration token for one of the caller's devices. Scoped by `userId`, so a
   * token cannot be attached to a device the caller does not own.
   */
  setDevicePushToken?:
    | ((userId: string, deviceId: string, pushToken: string) => Promise<boolean>)
    | undefined;
  chat?:
    | {
        chatRepo: ChatRepository;
        router: ModelRouter;
        modelConfigs: ModelConfigRepository;
        gateway: ModelGateway;
      }
    | undefined;
  project?:
    | {
        projectRepo: ProjectRepository;
        chatRepo: ChatRepository;
      }
    | undefined;
  task?:
    | {
        projectRepo: ProjectRepository;
        taskRepo: TaskRepository;
        taskQueue: TaskQueue;
        broadcaster: TaskEventBroadcaster;
      }
    | undefined;
  approval?:
    | {
        approvalRepo: ApprovalRepository;
        taskRepo?: TaskRepository | undefined;
        taskQueue?: TaskQueue | undefined;
        broadcaster?: TaskEventBroadcaster | undefined;
        auditRepo?: AuditRepository | undefined;
      }
    | undefined;
  memory?:
    | {
        memoryRepo: MemoryRepository;
      }
    | undefined;
  artifacts?:
    | {
        artifactManager: ArtifactManager;
      }
    | undefined;
  skills?: {
    skillRepo: SkillRepository;
    skillsDir?: string | undefined;
    toolRegistry?: ToolRegistry | undefined;
  } | undefined;
  schedules?:
    | {
        schedulerEngine?: SchedulerEngine | undefined;
        eventEngine?: EventEngine | undefined;
        notificationEngine?: NotificationEngine | undefined;
      }
    | undefined;
  models?: {
    auth: AuthService;
    modelConfigs: ModelConfigRepository;
    gateway: ModelGateway;
    providerBaseUrl: string;
  } | undefined;
};

const requestId = (request: { headers: Record<string, string | string[] | undefined> }): string => {
  const candidate = request.headers['x-request-id'] ?? request.headers['x-trace-id'];
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
};

const bearer = (request: FastifyRequest): string => {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer '))
    throw new AuthError('UNAUTHENTICATED', 'authentication required');
  return value.slice(7);
};

/**
 * Origins allowed to call the API from a browser context: the Tauri webview
 * origins of the Windows agent plus the local dev server. Native clients
 * (Android, tests) send no Origin header and are unaffected.
 */
const CORS_ALLOWED_ORIGINS = (
  process.env.CORS_ALLOWED_ORIGINS ??
  'tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const userFromRequest = async (request: FastifyRequest, auth: AuthService): Promise<AuthUser> =>
  auth.authenticate(bearer(request));

export const buildApp = async (dependencies: AppDependencies): Promise<FastifyInstance> => {
  const app = Fastify({
    genReqId: requestId,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'password',
        'refreshToken',
        'jwt_secret',
        'JWT_SECRET',
        'NINEROUTER_API_KEY',
        'apiKey',
        'api_key',
        'token',
        'secret',
        'credential',
      ],
    },
  });

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute', allowList: ['127.0.0.1'] });
  await app.register(websocket);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-trace-id', request.id);

    const origin = request.headers.origin;
    if (!origin || !CORS_ALLOWED_ORIGINS.includes(origin)) return;

    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      reply
        .header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
        .header('Access-Control-Allow-Headers', 'authorization,content-type')
        .header('Access-Control-Max-Age', '600')
        .code(204)
        .send();
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const candidate =
      typeof error === 'object' && error !== null
        ? (error as { statusCode?: number; code?: string; message?: string })
        : undefined;
    const isIllegalTransition = error instanceof IllegalTaskStateTransitionError;
    const status =
      error instanceof AuthError
        ? error.statusCode
        : isIllegalTransition
          ? 400
          : typeof candidate?.statusCode === 'number' && candidate.statusCode >= 400
            ? candidate.statusCode
            : 500;
    const code =
      error instanceof AuthError
        ? error.code
        : isIllegalTransition
          ? 'ILLEGAL_STATE_TRANSITION'
          : status === 400
            ? 'VALIDATION_ERROR'
            : (candidate?.code ?? 'INTERNAL_ERROR');
    const message =
      status >= 500
        ? 'internal server error'
        : error instanceof Error
          ? error.message
          : (candidate?.message ?? 'request failed');
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send({ error: { code, message, requestId: request.id } });
  });

  app.get('/health', async (_request, reply) => reply.send({ status: 'ok', service: 'api' }));
  app.get('/metrics', async (_request, reply) =>
    reply
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(defaultTracer.toPrometheusFormat()),
  );
  app.get('/ready', async (_request, reply) => {
    const checks = { database: false, redis: false };
    if (dependencies.health) {
      [checks.database, checks.redis] = await Promise.all([
        dependencies.health.database().catch(() => false),
        dependencies.health.redis().catch(() => false),
      ]);
    }
    const ready = checks.database && checks.redis;
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });

  const credentialsSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 320 },
      password: { type: 'string', minLength: 12, maxLength: 256 },
    },
  } as const;
  app.post(
    '/v1/auth/register',
    {
      schema: { body: credentialsSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const result = await dependencies.auth.register(body.email, body.password);
      return reply.code(201).send(result);
    },
  );
  app.post(
    '/v1/auth/login',
    {
      schema: { body: credentialsSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      return reply.send(await dependencies.auth.login(body.email, body.password));
    },
  );
  app.post(
    '/v1/auth/refresh',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 256 } },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) =>
      reply.send(
        await dependencies.auth.refresh((request.body as { refreshToken: string }).refreshToken),
      ),
  );
  app.post(
    '/v1/auth/logout',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      await userFromRequest(request, dependencies.auth);
      await dependencies.auth.logout((request.body as { refreshToken: string }).refreshToken);
      return reply.code(204).send();
    },
  );
  app.get('/v1/me', async (request, reply) => {
    const user = await userFromRequest(request, dependencies.auth);
    return reply.send({ user: { id: user.id, email: user.email } });
  });
  app.get(
    '/v1/users/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const user = await userFromRequest(request, dependencies.auth);
      const requested = (request.params as { userId: string }).userId;
      if (user.id !== requested)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'not found', requestId: request.id } });
      return reply.send({ user: { id: user.id, email: user.email } });
    },
  );
  app.post(
    '/v1/devices',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'platform'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            platform: { type: 'string', enum: ['android', 'windows', 'web'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await userFromRequest(request, dependencies.auth);
      if (!dependencies.registerDevice)
        return reply.code(503).send({
          error: {
            code: 'NOT_CONFIGURED',
            message: 'device registration unavailable',
            requestId: request.id,
          },
        });
      const body = request.body as { name: string; platform: string };
      return reply.code(201).send({ device: await dependencies.registerDevice(user.id, body) });
    },
  );

  app.get('/v1/devices', async (request, reply) => {
    const user = await userFromRequest(request, dependencies.auth);
    // Presence comes from the live sockets; the shape comes from the registered rows, so every
    // entry carries the same fields whether the device is connected or not.
    const online = new Set(dependencies.deviceManager?.listOnlineDeviceIds(user.id) ?? []);
    const registered = (await dependencies.listDevices?.(user.id)) ?? [];
    return reply.send({
      devices: registered.map((device) => ({ ...device, isOnline: online.has(device.id) })),
    });
  });

  // Push token registration for FCM delivery. Scoped to the caller's own device row.
  app.post(
    '/v1/devices/:deviceId/push-token',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pushToken'],
          properties: { pushToken: { type: 'string', minLength: 1, maxLength: 4096 } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply) => {
      const user = await userFromRequest(request, dependencies.auth);
      if (!dependencies.setDevicePushToken)
        return reply.code(503).send({
          error: {
            code: 'NOT_CONFIGURED',
            message: 'push token registration unavailable',
            requestId: request.id,
          },
        });
      const { pushToken } = request.body as { pushToken: string };
      const stored = await dependencies.setDevicePushToken(user.id, request.params.deviceId, pushToken);
      if (!stored) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Perangkat tidak ditemukan' } });
      }
      return reply.code(204).send();
    },
  );

  if (dependencies.deviceManager) {
    registerAgentWsRoute(app, {
      auth: dependencies.auth,
      deviceManager: dependencies.deviceManager,
      registerAgent: dependencies.registerAgent,
    });
    if (dependencies.internalBridgeToken) {
      registerDeviceCommandRoutes(app, {
        deviceManager: dependencies.deviceManager,
        token: dependencies.internalBridgeToken,
      });
    }
  }
  if (dependencies.models) {
    registerModelRoutes(app, { ...dependencies.models, auth: dependencies.auth });
  }

  if (dependencies.chat) {
    registerChatRoutes(app, {
      auth: dependencies.auth,
      chatRepo: dependencies.chat.chatRepo,
      router: dependencies.chat.router,
      modelConfigs: dependencies.chat.modelConfigs,
      gateway: dependencies.chat.gateway,
    });
  }

  if (dependencies.project) {
    registerProjectRoutes(app, {
      auth: dependencies.auth,
      projectRepo: dependencies.project.projectRepo,
      chatRepo: dependencies.project.chatRepo,
    });
  }

  if (dependencies.task) {
    registerTaskRoutes(app, {
      auth: dependencies.auth,
      projectRepo: dependencies.task.projectRepo,
      taskRepo: dependencies.task.taskRepo,
      taskQueue: dependencies.task.taskQueue,
      broadcaster: dependencies.task.broadcaster,
    });
    registerEventsWsRoute(app, {
      auth: dependencies.auth,
      taskRepo: dependencies.task.taskRepo,
      broadcaster: dependencies.task.broadcaster,
    });
  }

  if (dependencies.approval) {
    registerApprovalRoutes(app, {
      auth: dependencies.auth,
      approvalRepo: dependencies.approval.approvalRepo,
      taskRepo: dependencies.approval.taskRepo,
      taskQueue: dependencies.approval.taskQueue,
      broadcaster: dependencies.approval.broadcaster,
      auditRepo: dependencies.approval.auditRepo,
    });
  }

  if (dependencies.memory) {
    registerMemoryRoutes(app, {
      memoryRepo: dependencies.memory.memoryRepo,
      auth: dependencies.auth,
    });
  }

  if (dependencies.artifacts) {
    registerArtifactRoutes(app, {
      artifactManager: dependencies.artifacts.artifactManager,
      auth: dependencies.auth,
    });
  }

  if (dependencies.skills) {
    registerSkillRoutes(app, {
      skillRepo: dependencies.skills.skillRepo,
      auth: dependencies.auth,
      skillsDir: dependencies.skills.skillsDir,
      toolRegistry: dependencies.skills.toolRegistry,
    });
  }

  if (dependencies.schedules) {
    registerSchedulesRoutes(app, {
      auth: dependencies.auth,
      schedulerEngine: dependencies.schedules.schedulerEngine ?? new SchedulerEngine(),
      eventEngine: dependencies.schedules.eventEngine ?? new EventEngine(),
      notificationEngine: dependencies.schedules.notificationEngine ?? new NotificationEngine(),
    });
  }

  return app;
};
