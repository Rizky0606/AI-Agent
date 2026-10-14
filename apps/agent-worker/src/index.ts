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
import {
  artifactWriteAuditEntry,
  createDatabase,
  SqlApprovalRepository,
  SqlAuditRepository,
  SqlTaskRepository,
} from '@personal-ai-os/api/db';
import { BullMqTaskQueue, RedisTaskEventBroadcaster, TASK_QUEUE_NAME } from '@personal-ai-os/api/services';
import {
  MockModelGateway,
  type ModelGateway,
  NineRouterGateway,
} from '@personal-ai-os/model-gateway';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { RemoteRuntimeAdapter, RuntimeManager } from '@personal-ai-os/agent-core';
import {
  ArtifactManager,
  BrowserController,
  createDefaultToolRegistry,
  DiskArtifactStorage,
  type ToolRegistry,
} from '@personal-ai-os/tools';
import {
  McpHub,
  parseMcpServerDefinitions,
  StdioMcpServerAdapter,
} from '@personal-ai-os/mcp';
import { PlaywrightRunner } from './browser/playwright-runner.ts';
import { HttpDeviceDispatcher } from './device-dispatcher.ts';

export * from './task-executor.ts';
export * from './device-dispatcher.ts';

export interface WorkerConfig {
  redisUrl?: string | undefined;
  concurrency?: number | undefined;
  queueName?: string | undefined;
  taskRepo: TaskRepository;
  broadcaster: EventPublisher;
  executorOptions?: TaskExecutorOptions | undefined;
}

export const createAgentWorker = (
  config: WorkerConfig,
): {
  executor: TaskExecutor;
  worker?: Worker | undefined;
  queue?: BullMqTaskQueue | undefined;
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
  const queueName = config.queueName ?? TASK_QUEUE_NAME;
  const queue = new BullMqTaskQueue(redis, { queueName });
  const worker = new Worker(
    queueName,
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
    queue,
    close: async () => {
      await worker.close();
      await queue.close();
      await redis.quit();
    },
  };
};

export const resolveDatabaseUrl = (): string | undefined => {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) return undefined;
  const user = process.env.POSTGRES_USER ?? 'personal_ai_os';
  const db = process.env.POSTGRES_DB ?? 'personal_ai_os';
  const host = process.env.POSTGRES_HOST ?? 'postgres';
  const port = process.env.POSTGRES_PORT ?? '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
};

export interface HealthProbe {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
}

/**
 * Refreshes the Docker health file only after both probes answer. A worker that lost Postgres
 * or Redis leaves the file stale, so `docker-compose.yml` marks the container unhealthy.
 * Probe errors are reported, never thrown: a transient outage must not kill the worker.
 */
export const refreshHealthFile = async (
  healthFile: string,
  probe: HealthProbe,
): Promise<boolean> => {
  try {
    await probe.database();
    await probe.redis();
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'agent-worker',
        event: 'healthcheck_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  }

  try {
    writeFileSync(healthFile, Date.now().toString());
  } catch {
    // Best effort
  }
  return true;
};

export const startWorkerProcess = async (): Promise<{
  close: () => Promise<void>;
  worker?: Worker | undefined;
  executor: TaskExecutor;
  healthProbe: HealthProbe;
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
  const auditRepo = new SqlAuditRepository(db);
  const broadcaster = new RedisTaskEventBroadcaster({ redisUrl });

  // Dedicated fail-fast connection (same options as the API health client) so a dead Redis
  // rejects the probe instead of queueing commands forever.
  const healthRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true });
  healthRedis.on('error', () => {
    // Reported by the health probe; the listener keeps ioredis from raising an unhandled error event
  });

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
  const guard = new SecuredCapabilityGuard(new PermissionEngine(), {
    approvalValidator: approvalRepo,
    auditLogger: auditRepo,
  });

  // Browser tooling is opt-in: it needs the Playwright Chromium download, so a worker
  // without it keeps running with the HTTP-only toolset.
  const browserController = process.env.BROWSER_TOOL_ENABLED === 'false'
    ? undefined
    : new BrowserController({
        runner: new PlaywrightRunner(),
        artifactManager: new ArtifactManager({
          storage: new DiskArtifactStorage(
            process.env.ARTIFACTS_DIR ?? resolve(process.cwd(), 'data/artifacts'),
          ),
          auditSink: (record) => auditRepo.log(artifactWriteAuditEntry(record)),
        }),
        maxConcurrency: Number(process.env.BROWSER_MAX_CONCURRENCY ?? 1),
      });

  const registry = createDefaultToolRegistry({ guard, browserController });
  const mcpHub = new McpHub();
  const mcpAdapters = await registerMcpServers(mcpHub, registry);

  // The Windows agent dials the API, so the worker reaches a device through the API's internal
  // routes. Without the shared service token the dispatcher stays unset and device tasks fail
  // closed instead of pretending a command ran.
  const internalToken = process.env.RUNTIME_BRIDGE_TOKEN;
  const deviceDispatcher = internalToken
    ? new HttpDeviceDispatcher({
        baseUrl: process.env.API_INTERNAL_URL ?? 'http://api:3000',
        token: internalToken,
      })
    : undefined;

  const workerHandle = createAgentWorker({
    redisUrl,
    concurrency: workerConcurrency,
    taskRepo,
    broadcaster,
    executorOptions: {
      approvalCreator,
      modelGateway,
      defaultModel: process.env.DEFAULT_CHAT_MODEL,
      runtimeManager,
      preferredRuntimeId: runtimePreferred,
      guard,
      registry,
      deviceDispatcher,
    },
  });

  // Recover interrupted / dangling tasks after worker startup. The queue is mandatory here:
  // without it the recovered task is never re-enqueued and hangs in 'running' forever.
  const workerQueue = workerHandle.queue;
  if (!workerQueue) throw new Error('Worker queue is required to recover interrupted tasks.');
  try {
    const recovered = await workerHandle.executor.recoverInterruptedTasks(workerQueue);
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
    await browserController?.close();
    await Promise.all(mcpAdapters.map((adapter) => adapter.close()));
    await broadcaster.close(true);
    await sqlClient.end({ timeout: 5 });
    healthRedis.disconnect();
  };

  return {
    close: closeAll,
    worker: workerHandle.worker,
    executor: workerHandle.executor,
    healthProbe: {
      database: () => sqlClient`select 1`,
      redis: () => healthRedis.ping(),
    },
  };
};

/**
 * Launches every server named by `MCP_SERVERS` and registers its allowlisted tools.
 *
 * One misconfigured server must not take the worker down with it, so failures are
 * logged and skipped. The returned adapters own child processes and must be closed.
 */
export const registerMcpServers = async (
  hub: McpHub,
  registry: ToolRegistry,
): Promise<StdioMcpServerAdapter[]> => {
  const definitions = parseMcpServerDefinitions(process.env.MCP_SERVERS);
  const adapters: StdioMcpServerAdapter[] = [];

  for (const { config, launch, capability } of definitions) {
    const adapter = new StdioMcpServerAdapter({
      serverId: config.id,
      command: launch.command,
      args: launch.args,
      env: launch.env,
      cwd: launch.cwd,
      capability,
      onDiagnostic: (line) => {
        console.warn(JSON.stringify({ service: 'agent-worker', event: 'mcp_diagnostic', serverId: config.id, line }));
      },
    });

    try {
      const toolDefs = await hub.registerServer(config, adapter);
      for (const toolDef of toolDefs) registry.registerTool(toolDef);
      adapters.push(adapter);
      console.log(
        JSON.stringify({
          service: 'agent-worker',
          event: 'mcp_registered',
          serverId: config.id,
          tools: toolDefs.map((tool) => tool.name),
        }),
      );
    } catch (err) {
      await adapter.close().catch(() => {});
      console.error(
        JSON.stringify({
          service: 'agent-worker',
          event: 'mcp_registration_failed',
          serverId: config.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return adapters;
};

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
      // Refresh only when Postgres and Redis both answer; otherwise the stale file makes
      // the Docker healthcheck fail instead of reporting a disconnected worker as healthy.
      void refreshHealthFile(healthFile, handle.healthProbe);

      // Keep process event loop alive indefinitely while waiting for jobs
      keepAliveInterval = setInterval(() => {
        void refreshHealthFile(healthFile, handle.healthProbe);
      }, 15_000);
    })
    .catch((err) => {
      console.error('[agent-worker] Fatal startup error:', err);
      process.exit(1);
    });
}
