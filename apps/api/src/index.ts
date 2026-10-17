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
import {
  EventEngine,
  NotificationEngine,
  SchedulerEngine,
  createFcmProviderFromEnv,
} from '@personal-ai-os/scheduler';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';

import { buildApp } from './app.ts';
import { createAuthService } from './auth/service.ts';
import { createGoogleOAuthClient, googleOAuthConfigFromEnv } from './auth/google.ts';
import { createDatabase } from './db/client.ts';
import { SqlAuthRepository } from './db/sql-auth-repository.ts';
import { SqlDeviceRepository } from './db/device-repository.ts';
import { SqlChatRepository } from './db/chat-repository.ts';
import { SqlModelConfigRepository } from './db/model-config-repository.ts';
import { SqlProjectRepository } from './db/project-repository.ts';
import { SqlTaskRepository } from './db/task-repository.ts';
import { SqlApprovalRepository } from './db/approval-repository.ts';
import { artifactWriteAuditEntry, SqlAuditRepository } from './db/audit-repository.ts';
import { DrizzleMemoryRepository } from './db/memory-repository.ts';
import { SqlSkillRepository } from './db/skill-repository.ts';
import { SqlMcpRepository } from './db/mcp-repository.ts';
import { SqlScheduleRepository } from './db/schedule-repository.ts';
import { SqlNotificationRepository } from './db/notification-repository.ts';
import { SqlCompareRepository } from './db/compare-repository.ts';
import { DeviceConnectionManager } from './services/device-connection-manager.ts';
import { ModelRouter } from './services/model-router.ts';
import { BullMqTaskQueue } from './services/task-queue.ts';
import { RedisTaskEventBroadcaster } from './services/event-broadcaster.ts';
import { createTaskNotificationListener } from './services/task-notifications.ts';
import {
  DEFAULT_EPHEMERAL_TTL_MS,
  sweepExpiredArtifacts,
} from './services/artifact-retention-sweeper.ts';

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
const auditRepository = new SqlAuditRepository(db);
const mcpRepository = new SqlMcpRepository(db);
const compareRepository = new SqlCompareRepository(db);
const toolRegistry = createDefaultToolRegistry({
  guard: new SecuredCapabilityGuard(new PermissionEngine(), { auditLogger: auditRepository }),
});

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
  auditSink: (record) => auditRepository.log(artifactWriteAuditEntry(record)),
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

// Schedules & Events Subsystem with database-backed persistence (Migration 0005).
// Proses API hanya mendaftarkan jadwal ke tabel `schedules`; slot dijalankan oleh container
// `scheduler`, yang punya dispatcher durable sendiri (INSERT tasks + BullMQ).
const scheduleRepository = new SqlScheduleRepository(db);
const schedulerEngine = new SchedulerEngine({ storage: scheduleRepository });
await schedulerEngine.init();

const eventEngine = new EventEngine();
const notificationEngine = new NotificationEngine({
  storage: new SqlNotificationRepository(db),
  fcmProvider: createFcmProviderFromEnv(),
  resolveDeviceTokens: (userId) => deviceRepository.listPushTokens(userId),
});

// Google sign-in is optional: with no credentials the routes answer 503 and password login is
// unaffected, so a half-configured deployment never issues tokens it cannot verify.
const googleConfig = googleOAuthConfigFromEnv();
if (isProduction && !googleConfig)
  console.warn('[WARN] GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI unset: Google sign-in is disabled.');

// Assemble and build Fastify application with all modules wired
const auth = createAuthService(new SqlAuthRepository(db), jwtSecret);
const app = await buildApp({
  auth,
  google: googleConfig
    ? {
        client: createGoogleOAuthClient(googleConfig),
        allowedRedirectUris: (process.env.GOOGLE_ALLOWED_REDIRECT_URIS ?? 'personal-ai://auth')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      }
    : undefined,
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
  setDevicePushToken: (userId, deviceId, pushToken) =>
    deviceRepository.setPushToken(userId, deviceId, pushToken),
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
    audit: auditRepository,
  },
  project: {
    projectRepo: projectRepository,
    chatRepo: chatRepository,
  },
  task: {
    projectRepo: projectRepository,
    chatRepo: chatRepository,
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
  mcp: {
    mcpRepo: mcpRepository,
  },
  schedules: {
    schedulerEngine,
    eventEngine,
    notificationEngine,
  },
  compare: {
    compareRepo: compareRepository,
    chatRepo: chatRepository,
    broadcaster,
    modelGateway: gateway,
    modelConfigs: modelConfigRepository,
    defaultSynthesisModel: process.env.COMPARE_SYNTHESIS_MODEL ?? 'google/gemini-2.5-flash',
  },
});

// Retention sweep: the API process owns both the artifact storage and the database, so it is
// where expired artifacts get deleted. Disabled unless the interval is set to a positive value.
const artifactSweepIntervalMs = Number(process.env.ARTIFACT_RETENTION_SWEEP_INTERVAL_MS ?? 0);
const artifactSweepTimer =
  artifactSweepIntervalMs > 0
    ? setInterval(() => {
        void sweepExpiredArtifacts({
          artifactManager,
          getTaskStatus: async (ownerId, taskId) =>
            (await taskRepository.getTask(ownerId, taskId))?.status ?? null,
          projectExists: async (ownerId, projectId) =>
            (await projectRepository.getProject(ownerId, projectId)) !== null,
          ephemeralTtlMs: Number(process.env.ARTIFACT_EPHEMERAL_TTL_MS ?? DEFAULT_EPHEMERAL_TTL_MS),
        })
          .then((result) => {
            app.log.debug(result, 'artifact retention sweep');
            if (result.deleted > 0 || result.failed.length > 0) {
              app.log.info(result, 'artifact retention sweep');
            }
          })
          .catch((err: unknown) => {
            app.log.error({ err }, 'artifact retention sweep failed');
          });
      }, artifactSweepIntervalMs)
    : undefined;
artifactSweepTimer?.unref();

// Event task dari worker (Redis) menjadi baris notifications durable di proses API.
broadcaster.subscribe(
  createTaskNotificationListener({
    notificationEngine,
    onError: (err, event) => {
      app.log.error({ err, taskId: event.taskId, eventType: event.eventType }, 'notifikasi task gagal');
    },
  }),
);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(artifactSweepTimer);
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
