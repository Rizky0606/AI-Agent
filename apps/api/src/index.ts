import { Redis } from 'ioredis';
import { NineRouterGateway, MockModelGateway } from '@personal-ai-os/model-gateway';
import { buildApp } from './app.ts';
import { createAuthService } from './auth/service.ts';
import { createDatabase } from './db/client.ts';
import { SqlAuthRepository } from './db/sql-auth-repository.ts';
import { SqlDeviceRepository } from './db/device-repository.ts';
import { SqlChatRepository } from './db/chat-repository.ts';
import { SqlModelConfigRepository } from './db/model-config-repository.ts';
import { ModelRouter } from './services/model-router.ts';

import { SqlProjectRepository } from './db/project-repository.ts';
import { SqlTaskRepository } from './db/task-repository.ts';
import { SqlApprovalRepository } from './db/approval-repository.ts';
import { SqlAuditRepository } from './db/audit-repository.ts';
import { BullMqTaskQueue } from './services/task-queue.ts';
import { InMemoryTaskEventBroadcaster } from './services/event-broadcaster.ts';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const databaseUrl = required('DATABASE_URL');
const redisUrl = required('REDIS_URL');
const jwtSecret = required('JWT_SECRET');
const { client: sql, db } = createDatabase(databaseUrl);
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true });

const deviceRepository = new SqlDeviceRepository(db);
const chatRepository = new SqlChatRepository(db);
const modelConfigRepository = new SqlModelConfigRepository(db);
const projectRepository = new SqlProjectRepository(db);
const taskRepository = new SqlTaskRepository(db);
const taskQueue = new BullMqTaskQueue(redis);
const broadcaster = new InMemoryTaskEventBroadcaster();
const approvalRepository = new SqlApprovalRepository(db);
const auditRepository = new SqlAuditRepository(db);

const nineRouterKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;
const gateway = nineRouterKey
  ? new NineRouterGateway({
      baseUrl: process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
      apiKey: nineRouterKey,
      timeoutMs: Number(process.env.NINEROUTER_TIMEOUT_MS ?? 30000),
    })
  : new MockModelGateway();

// Ensure provider and baseline verified models are registered in model_configs
const provider = await modelConfigRepository.upsertProvider(
  '9router',
  process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
);
await modelConfigRepository.upsertModelConfig(
  provider.id,
  process.env.DEFAULT_CHAT_MODEL ?? 'anthropic/claude-3-5-sonnet',
  ['chat', 'streaming'],
  128_000,
);

const modelRouter = new ModelRouter(modelConfigRepository, gateway);

const app = await buildApp({
  auth: createAuthService(new SqlAuthRepository(db), jwtSecret),
  health: {
    database: async () => {
      await sql`select 1`;
      return true;
    },
    redis: async () => (await redis.ping()) === 'PONG',
  },
  registerDevice: (userId, input) => deviceRepository.create(userId, input),
  chat: {
    chatRepo: chatRepository,
    router: modelRouter,
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
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
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
