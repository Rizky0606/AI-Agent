import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlinkSync, writeFileSync } from 'node:fs';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  type ApprovalCreatorParams,
  type EventPublisher,
  TaskExecutor,
  type TaskExecutorOptions,
  type TaskJobData,
} from './task-executor.ts';
import type { TaskRepository } from '@personal-ai-os/shared';
import { createDatabase, SqlApprovalRepository, SqlTaskRepository } from '@personal-ai-os/api/db';
import { RedisTaskEventBroadcaster } from '@personal-ai-os/api/services';
import {
  MockModelGateway,
  type ModelGateway,
  NineRouterGateway,
} from '@personal-ai-os/model-gateway';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { RemoteRuntimeAdapter, RuntimeManager } from '@personal-ai-os/agent-core';

export * from './task-executor.ts';

export interface WorkerConfig {
  redisUrl?: string | undefined;
  concurrency?: number | undefined;
  taskRepo: TaskRepository;
  broadcaster: EventPublisher;
  executorOptions?: TaskExecutorOptions | undefined;
}

export const createAgentWorker = (
  config: WorkerConfig,
): {
  executor: TaskExecutor;
  worker?: Worker | undefined;
  close: () => Promise<void>;
} => {
  const executor = new TaskExecutor(config.taskRepo, config.broadcaster, config.executorOptions);
  const concurrency = config.concurrency ?? 2; // Low concurrency for limited VPS resources

  if (!config.redisUrl) {
    return {
      executor,
      close: async () => {},
    };
  }

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    'personal-ai-os-tasks',
    async (job) => {
      await executor.execute(job.data as TaskJobData);
    },
    {
      connection: redis as never,
      concurrency,
    },
  );

  return {
    executor,
    worker,
    close: async () => {
      await worker.close();
      await redis.quit();
    },
  };
};

export const resolveDatabaseUrl = (): string | undefined => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const user = process.env.POSTGRES_USER ?? 'personal_ai_os';
    const password = process.env.POSTGRES_PASSWORD ?? '';
    const db = process.env.POSTGRES_DB ?? 'personal_ai_os';
    const host = process.env.POSTGRES_HOST ?? 'postgres';
    const port = process.env.POSTGRES_PORT ?? '5432';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  return url;
};

export const startWorkerProcess = async (): Promise<{
  close: () => Promise<void>;
  worker?: Worker | undefined;
  executor: TaskExecutor;
}> => {
  const databaseUrl = resolveDatabaseUrl();
  const redisUrl = process.env.REDIS_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to start agent-worker process.');
  }
  if (!redisUrl) {
    throw new Error('REDIS_URL is required to start agent-worker process.');
  }

  const { client: sqlClient, db } = createDatabase(databaseUrl);
  const taskRepo = new SqlTaskRepository(db);
  const approvalRepo = new SqlApprovalRepository(db);
  const broadcaster = new RedisTaskEventBroadcaster({ redisUrl });

  // Approval creator for guarded actions
  const approvalCreator = async (params: ApprovalCreatorParams) => {
    const created = await approvalRepo.createApproval({
      userId: params.userId,
      projectId: params.projectId ?? 'default-project',
      taskId: params.taskId ?? undefined,
      action: params.action,
      resource: params.resource,
      scope: params.scope,
      riskLevel: params.riskLevel,
      consequence: params.consequence,
      fingerprint: params.fingerprint,
      expiresInSeconds: params.expiresInSeconds ?? 3600,
    });
    return { id: created.id };
  };

  // Model gateway
  let modelGateway: ModelGateway | undefined;
  const isProduction = process.env.NODE_ENV === 'production';
  const modelGatewaySetting = process.env.MODEL_GATEWAY?.toLowerCase();
  const nineRouterKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;

  if (modelGatewaySetting === 'mock') {
    if (isProduction) {
      throw new Error('MODEL_GATEWAY=mock is forbidden in production environment.');
    }
    modelGateway = new MockModelGateway();
  } else if (nineRouterKey) {
    modelGateway = new NineRouterGateway({
      baseUrl: process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
      apiKey: nineRouterKey,
      timeoutMs: Number(process.env.NINEROUTER_TIMEOUT_MS ?? 30000),
    });
  }

  const runtimeBridgeUrl = process.env.RUNTIME_BRIDGE_URL;
  const runtimeBridgeToken = process.env.RUNTIME_BRIDGE_TOKEN;
  const runtimePreferred = process.env.RUNTIME_PREFERRED ?? 'omp';
  if (!['omp', 'hermes'].includes(runtimePreferred)) throw new Error('RUNTIME_PREFERRED must be omp or hermes.');
  if (isProduction && (!runtimeBridgeUrl || !runtimeBridgeToken)) throw new Error('Production worker requires RUNTIME_BRIDGE_URL and RUNTIME_BRIDGE_TOKEN.');
  const runtimeManager = new RuntimeManager();
  if (runtimeBridgeUrl && runtimeBridgeToken) {
    for (const runtimeId of ['omp', 'hermes'] as const) {
      runtimeManager.register(new RemoteRuntimeAdapter({
        id: runtimeId,
        name: runtimeId === 'omp' ? 'OMP host bridge' : 'Hermes host bridge',
        version: runtimeId === 'omp' ? '18.6.1' : '0.20.5',
        baseUrl: runtimeBridgeUrl,
        token: runtimeBridgeToken,
      }));
    }
    await runtimeManager.initializeAll();
  }
  if (runtimeBridgeUrl && runtimeBridgeToken) {
    const interval = setInterval(() => void runtimeManager.healthCheckAll().then((health) => {
      for (const [runtimeId, result] of health) if (!result.healthy) console.warn(JSON.stringify({ service: 'agent-worker', event: 'runtime_unhealthy', runtimeId, error: result.error }));
    }), Number(process.env.RUNTIME_HEALTH_INTERVAL_MS ?? 30_000));
    interval.unref();
  }

  const workerConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
  const workerHandle = createAgentWorker({
    redisUrl,
    concurrency: workerConcurrency,
    taskRepo,
    broadcaster,
    executorOptions: {
      approvalCreator,
      modelGateway,
      runtimeManager,
      preferredRuntimeId: runtimePreferred,
      guard: new SecuredCapabilityGuard(new PermissionEngine(), {
        approvalValidator: approvalRepo,
      }),
    },
  });

  // Recover interrupted / dangling tasks after worker startup
  try {
    const recovered = await workerHandle.executor.recoverInterruptedTasks();
    if (recovered.recoveredCount > 0) {
      console.log(
        JSON.stringify({
          service: 'agent-worker',
          action: 'recovery',
          recoveredCount: recovered.recoveredCount,
        }),
      );
    }
  } catch (recErr) {
    console.error('[agent-worker] Error recovering dangling tasks:', recErr);
  }

  console.log(
    JSON.stringify({
      service: 'agent-worker',
      status: 'running',
      concurrency: workerConcurrency,
    }),
  );

  let isClosing = false;
  const closeAll = async (): Promise<void> => {
    if (isClosing) return;
    isClosing = true;
    await workerHandle.close();
    await broadcaster.close(true);
    await sqlClient.end({ timeout: 5 });
  };

  return {
    close: closeAll,
    worker: workerHandle.worker,
    executor: workerHandle.executor,
  };
};

// Standalone execution if started directly via process
const isMainModule = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    const executedPath = resolve(process.argv[1]);
    return currentFilePath === executedPath;
  } catch {
    return process.argv[1].endsWith('agent-worker/src/index.ts');
  }
};

if (isMainModule()) {
  let keepAliveInterval: NodeJS.Timeout | undefined;

  startWorkerProcess()
    .then((handle) => {
      let isShuttingDown = false;
      const shutdown = async (signal: string): Promise<void> => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        try {
          unlinkSync(healthFile);
        } catch {
          // Ignore
        }
        console.log(`[agent-worker] Received ${signal}. Shutting down gracefully...`);
        try {
          await handle.close();
          console.log('[agent-worker] Graceful shutdown completed.');
          process.exit(0);
        } catch (err) {
          console.error('[agent-worker] Error during shutdown:', err);
          process.exit(1);
        }
      };

      process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
      });
      process.once('SIGINT', () => {
        void shutdown('SIGINT');
      });

      const healthFile = process.env.HEALTHCHECK_FILE ?? '/tmp/healthy';
      const touchHealth = () => {
        try {
          writeFileSync(healthFile, Date.now().toString());
        } catch {
          // Best effort
        }
      };
      touchHealth();

      // Keep process event loop alive indefinitely while waiting for jobs
      keepAliveInterval = setInterval(() => {
        touchHealth();
      }, 15_000);
    })
    .catch((err) => {
      console.error('[agent-worker] Fatal startup error:', err);
      process.exit(1);
    });
}
