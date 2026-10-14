import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import {
  NineRouterGateway,
  MockModelGateway,
  type ModelGateway,
} from '@personal-ai-os/model-gateway';
import { ManifestValidator, SkillLoader } from '@personal-ai-os/agent-core';
import { InactiveEmbeddingProvider } from '@personal-ai-os/memory';
import { ArtifactManager, DiskArtifactStorage, createDefaultToolRegistry } from '@personal-ai-os/tools';
import { EventEngine, NotificationEngine, SchedulerEngine } from '@personal-ai-os/scheduler';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';

import { buildApp } from './app.ts';
import { createAuthService } from './auth/service.ts';
import { createDatabase } from './db/client.ts';
import { SqlAuthRepository } from './db/sql-auth-repository.ts';
import { SqlDeviceRepository } from './db/device-repository.ts';
import { SqlChatRepository } from './db/chat-repository.ts';
import { SqlModelConfigRepository } from './db/model-config-repository.ts';
import { SqlProjectRepository } from './db/project-repository.ts';
import { SqlTaskRepository } from './db/task-repository.ts';
import { SqlApprovalRepository } from './db/approval-repository.ts';
import { SqlAuditRepository } from './db/audit-repository.ts';
import { DrizzleMemoryRepository } from './db/memory-repository.ts';
import { SqlSkillRepository } from './db/skill-repository.ts';
import { SqlScheduleRepository } from './db/schedule-repository.ts';
import { DeviceConnectionManager } from './services/device-connection-manager.ts';
import { ModelRouter } from './services/model-router.ts';
import { BullMqTaskQueue } from './services/task-queue.ts';
import { RedisTaskEventBroadcaster } from './services/event-broadcaster.ts';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

// Ensure DATABASE_URL is properly synchronized with POSTGRES_PASSWORD to avoid drift
const resolveDatabaseUrl = (): string => {
  let url = process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER ?? 'personal_ai_os';
  const password = process.env.POSTGRES_PASSWORD ?? '';
  const db = process.env.POSTGRES_DB ?? 'personal_ai_os';
  const host = process.env.POSTGRES_HOST ?? 'postgres';
  const port = process.env.POSTGRES_PORT ?? '5432';

  if (!url) {
    if (!password && process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL or POSTGRES_PASSWORD is required in production environment.');
    }
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }

  // Handle template interpolations from .env if unexpanded
  if (url.includes('${POSTGRES_PASSWORD}') && password) {
    url = url.replace('${POSTGRES_PASSWORD}', encodeURIComponent(password));
  }
  if (url.includes('${POSTGRES_USER}')) {
    url = url.replace('${POSTGRES_USER}', encodeURIComponent(user));
  }
  if (url.includes('${POSTGRES_DB}')) {
    url = url.replace('${POSTGRES_DB}', db);
  }

  return url;
};

const databaseUrl = resolveDatabaseUrl();
const redisUrl = required('REDIS_URL');
const jwtSecret = required('JWT_SECRET');
const { client: sql, db } = createDatabase(databaseUrl);
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true });

// Repositories & core services
const deviceRepository = new SqlDeviceRepository(db);
const deviceManager = new DeviceConnectionManager();
const chatRepository = new SqlChatRepository(db);
const modelConfigRepository = new SqlModelConfigRepository(db);
const projectRepository = new SqlProjectRepository(db);
const taskRepository = new SqlTaskRepository(db);
const taskQueue = new BullMqTaskQueue(redis);
const redisSubscriber = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
const broadcaster = new RedisTaskEventBroadcaster({
  publisher: redis,
  subscriber: redisSubscriber,
});
const approvalRepository = new SqlApprovalRepository(db);
const toolRegistry = createDefaultToolRegistry({ guard: new SecuredCapabilityGuard(new PermissionEngine()) });
const auditRepository = new SqlAuditRepository(db);

// Model Gateway Setup with explicit security checks
const isProduction = process.env.NODE_ENV === 'production';
const modelGatewaySetting = process.env.MODEL_GATEWAY?.toLowerCase();
const nineRouterKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;

let gateway: ModelGateway;

if (modelGatewaySetting === 'mock') {
  if (isProduction) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: MODEL_GATEWAY=mock is forbidden in production environment. A live 9Router API key is required.',
    );
  }
  console.warn(
    '[SECURITY / AUDIT WARNING] MODEL_GATEWAY=mock is explicitly active. MockModelGateway will be used for model calls. Do not use in production!',
  );
  gateway = new MockModelGateway();
} else if (!nineRouterKey || nineRouterKey.trim() === '') {
  if (isProduction) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: NINEROUTER_API_KEY is required in production environment. Process terminated.',
    );
  }
  throw new Error(
    'NINEROUTER_API_KEY is missing. In development/testing, explicitly set MODEL_GATEWAY=mock to use MockModelGateway, or configure a valid NINEROUTER_API_KEY.',
  );
} else {
  gateway = new NineRouterGateway({
    baseUrl: process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
    apiKey: nineRouterKey,
    timeoutMs: Number(process.env.NINEROUTER_TIMEOUT_MS ?? 30000),
  });
}

// Model Configuration - DEFAULT_CHAT_MODEL must come from verification or explicit configuration
let defaultChatModel = process.env.DEFAULT_CHAT_MODEL;
if (!defaultChatModel) {
  if (modelGatewaySetting === 'mock') {
    defaultChatModel = 'anthropic/claude-3-5-sonnet';
  } else {
    throw new Error(
      'DEFAULT_CHAT_MODEL is required. Per docs/verification/9router.md, models cannot be guessed; configure a verified model ID.',
    );
  }
}

// Ensure provider and baseline verified models are registered in model_configs
const provider = await modelConfigRepository.upsertProvider(
  '9router',
  process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
);
await modelConfigRepository.upsertModelConfig(
  provider.id,
  defaultChatModel,
  ['chat', 'streaming'],
  128_000,
);

const modelRouter = new ModelRouter(modelConfigRepository, gateway);

// Durable memory store. Semantic search stays inactive because 9Router exposes no embedding
// provider (`POST /v1/embeddings` returns "No credentials for provider: openai"), so vectors
// cannot be generated and `isSemanticSearchActive()` reports false honestly.
const memoryRepository = new DrizzleMemoryRepository(db, new InactiveEmbeddingProvider());

// Artifacts Subsystem with DiskArtifactStorage and quota
const artifactsDir =
  process.env.ARTIFACTS_DIR ?? fileURLToPath(new URL('../../../data/artifacts', import.meta.url));
const artifactManager = new ArtifactManager({
  storage: new DiskArtifactStorage(artifactsDir),
  userQuotaBytes: Number(process.env.ARTIFACT_USER_QUOTA_BYTES ?? 100 * 1024 * 1024), // 100 MB default
});

// Skills Subsystem with SqlSkillRepository and startup sync from SKILLS_DIR
const skillsDir =
  process.env.SKILLS_DIR ?? fileURLToPath(new URL('../../../skills', import.meta.url));
const skillRepository = new SqlSkillRepository(db);

const skillLoader = new SkillLoader(new ManifestValidator());
try {
  const diskSkills = await skillLoader.loadFromDirectory(skillsDir);
  for (const s of diskSkills) {
    await skillRepository.upsertSkill(s.manifest);
  }
} catch (err) {
  console.warn(
    `[SKILLS] Startup synchronization notice for "${skillsDir}": ${err instanceof Error ? err.message : String(err)}`,
  );
}

// Schedules & Events Subsystem with database-backed persistence (Migration 0005)
const scheduleRepository = new SqlScheduleRepository(db);
const schedulerEngine = new SchedulerEngine({
  storage: scheduleRepository,
  dispatcher: async (execution) => {
    const userId =
      (execution.taskPayload.input['userId'] as string) ?? '00000000-0000-0000-0000-000000000000';
    const projectId =
      (execution.taskPayload.input['projectId'] as string) ??
      '00000000-0000-0000-0000-000000000000';
    await taskQueue.enqueue({
      id: execution.idempotencyKey,
      userId,
      projectId,
      kind: execution.taskPayload.kind,
      status: 'queued',
      progress: 0,
      priority: execution.taskPayload.priority ?? 0,
      attempt: 0,
      maxAttempts: 3,
      payload: execution.taskPayload.input,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  },
});
await schedulerEngine.init();

const eventEngine = new EventEngine();
const notificationEngine = new NotificationEngine();

// Assemble and build Fastify application with all modules wired
const auth = createAuthService(new SqlAuthRepository(db), jwtSecret);
const app = await buildApp({
  auth,
  health: {
    database: async () => {
      await sql`select 1`;
      return true;
    },
    redis: async () => (await redis.ping()) === 'PONG',
  },
  deviceManager,
  internalBridgeToken: process.env.RUNTIME_BRIDGE_TOKEN,
  listDevices: (userId) => deviceRepository.listByUser(userId),
  registerDevice: (userId, input) => deviceRepository.create(userId, input),
  registerAgent: (userId, input) => deviceRepository.registerAgent(userId, input),
  chat: {
    chatRepo: chatRepository,
    router: modelRouter,
    modelConfigs: modelConfigRepository,
    gateway,
  },
  models: {
    auth,
    modelConfigs: modelConfigRepository,
    gateway,
    providerBaseUrl: process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
  },
  project: {
    projectRepo: projectRepository,
    chatRepo: chatRepository,
  },
  task: {
    projectRepo: projectRepository,
    taskRepo: taskRepository,
    taskQueue,
    broadcaster,
  },
  approval: {
    approvalRepo: approvalRepository,
    taskRepo: taskRepository,
    taskQueue,
    broadcaster,
    auditRepo: auditRepository,
  },
  memory: {
    memoryRepo: memoryRepository,
  },
  artifacts: {
    artifactManager,
  },
  skills: {
    skillRepo: skillRepository,
    skillsDir,
    toolRegistry,
  },
  schedules: {
    schedulerEngine,
    eventEngine,
    notificationEngine,
  },
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await broadcaster.close(true);
  await redis.quit();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

await app.listen({
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.API_PORT ?? 3000),
});
