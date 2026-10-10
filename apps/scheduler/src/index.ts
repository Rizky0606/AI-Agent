import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { PermissionEngine } from '@personal-ai-os/permissions';
import { EventEngine } from './event-engine.ts';
import { createFcmProviderFromEnv, type FcmProvider } from './fcm-provider.ts';
import { NotificationEngine } from './notification-engine.ts';
import { SchedulerEngine, type TaskDispatcher } from './scheduler-engine.ts';
import { PostgresNotificationStorage, PostgresScheduleStorage } from './storage.ts';
import type { NotificationStorage, ScheduledRunExecution, ScheduleStorage } from './types.ts';

export * from './types.ts';
export * from './cron-parser.ts';
export * from './scheduler-engine.ts';
export * from './event-engine.ts';
export * from './notification-engine.ts';
export * from './fcm-provider.ts';
export * from './storage.ts';

export interface SchedulerProcessOptions {
  databaseUrl?: string | undefined;
  redisUrl?: string | undefined;
  tickIntervalMs?: number | undefined;
  autoStartLoop?: boolean | undefined;
  fcmProvider?: FcmProvider | undefined;
  taskDispatcher?: TaskDispatcher | undefined;
}

export interface SchedulerProcessHandle {
  schedulerEngine: SchedulerEngine;
  eventEngine: EventEngine;
  notificationEngine: NotificationEngine;
  scheduleStorage: ScheduleStorage;
  notificationStorage: NotificationStorage;
  taskQueue: Queue;
  sql: postgres.Sql;
  redis: Redis;
  tick: (now?: Date) => Promise<ScheduledRunExecution[]>;
  close: () => Promise<void>;
}

export const resolveDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const user = process.env.POSTGRES_USER ?? 'personal_ai_os';
    const password = process.env.POSTGRES_PASSWORD ?? 'personal_ai_secret';
    const db = process.env.POSTGRES_DB ?? 'personal_ai_os';
    const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
    const port = process.env.POSTGRES_PORT ?? '5432';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  return url;
};

export const resolveRedisUrl = (): string => {
  return process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
};

export const startSchedulerProcess = async (
  options?: SchedulerProcessOptions,
): Promise<SchedulerProcessHandle> => {
  const databaseUrl = options?.databaseUrl ?? resolveDatabaseUrl();
  const redisUrl = options?.redisUrl ?? resolveRedisUrl();
  const tickIntervalMs =
    options?.tickIntervalMs ?? Number(process.env.SCHEDULER_TICK_INTERVAL_MS ?? 1000);

  const sql = postgres(databaseUrl, { max: 5 });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // Connect to the shared BullMQ queue (personal-ai-os-tasks)
  const taskQueue = new Queue('personal-ai-os-tasks', {
    connection: redis as never,
  });

  const scheduleStorage = new PostgresScheduleStorage(sql);
  const notificationStorage = new PostgresNotificationStorage(sql);

  // Default dispatcher: persists task with idempotencyKey to PostgreSQL and enqueues to BullMQ
  const defaultDispatcher: TaskDispatcher = async (execution: ScheduledRunExecution) => {
    const userId =
      execution.userId ?? (execution.taskPayload.input['userId'] as string | undefined);
    const projectId =
      execution.projectId ??
      (execution.taskPayload.input['projectId'] as string | undefined) ??
      null;

    if (!userId) {
      console.error(
        `[scheduler] Cannot enqueue task without userId for schedule job ${execution.jobId}`,
      );
      return;
    }

    // 1. Idempotency Check & Persistence in PostgreSQL tasks table
    const [existing] = await sql`
      SELECT id, user_id, project_id, status, kind, attempt, max_attempts
      FROM tasks
      WHERE user_id = ${userId} AND idempotency_key = ${execution.idempotencyKey}
      LIMIT 1
    `;

    let taskId: string;
    let isDuplicate = false;

    if (existing) {
      taskId = String(existing['id']);
      isDuplicate = true;
      console.log(
        `[scheduler] Slot ${execution.scheduledTime} already created (task ${taskId}, idempotency: ${execution.idempotencyKey})`,
      );
    } else {
      taskId = randomUUID();
      const priority = Number(execution.taskPayload.priority ?? 0);
      await sql`
        INSERT INTO tasks (
          id, user_id, project_id, status, kind, payload,
          idempotency_key, priority, attempt, max_attempts, progress,
          created_at, updated_at
        ) VALUES (
          ${taskId}, ${userId}, ${projectId}, 'queued', ${execution.taskPayload.kind},
          ${sql.json(execution.taskPayload.input as never)}, ${execution.idempotencyKey},
          ${priority}, 0, 3, 0,
          now(), now()
        )
      `;
    }

    // 2. Only enqueue to BullMQ queue if NOT duplicate
    if (!isDuplicate) {
      await taskQueue.add(
        execution.taskPayload.kind,
        {
          taskId,
          userId,
          projectId: projectId ?? '',
          kind: execution.taskPayload.kind,
          attempt: 0,
          maxAttempts: 3,
        },
        {
          jobId: taskId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          priority: Number(execution.taskPayload.priority ?? 0),
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      console.log(
        `[scheduler] Enqueued task ${taskId} (kind: ${execution.taskPayload.kind}) to personal-ai-os-tasks`,
      );
    }
  };

  const dispatcher = options?.taskDispatcher ?? defaultDispatcher;
  const schedulerEngine = new SchedulerEngine({
    storage: scheduleStorage,
    dispatcher,
  });

  await schedulerEngine.init();

  const fcmProvider = options?.fcmProvider ?? createFcmProviderFromEnv();
  const notificationEngine = new NotificationEngine({
    fcmProvider,
    storage: notificationStorage,
  });

  const eventEngine = new EventEngine({
    permissionEngine: new PermissionEngine(),
  });

  let loopInterval: NodeJS.Timeout | undefined;
  let isClosing = false;

  if (options?.autoStartLoop !== false) {
    let tickCounter = 0;
    loopInterval = setInterval(() => {
      if (isClosing) return;
      void (async () => {
        try {
          tickCounter++;
          // Periodically reload jobs from database to catch API additions
          if (tickCounter % 5 === 0) {
            await schedulerEngine.syncFromStorage();
          }
          await schedulerEngine.tick(new Date());
        } catch (tickErr) {
          console.error('[scheduler] Error in scheduler tick loop:', tickErr);
        }
      })();
    }, tickIntervalMs);
  }

  const closeAll = async (): Promise<void> => {
    if (isClosing) return;
    isClosing = true;
    if (loopInterval) {
      clearInterval(loopInterval);
    }
    await taskQueue.close();
    await redis.quit();
    await sql.end({ timeout: 5 });
  };

  return {
    schedulerEngine,
    eventEngine,
    notificationEngine,
    scheduleStorage,
    notificationStorage,
    taskQueue,
    sql,
    redis,
    tick: async (now?: Date) => schedulerEngine.tick(now),
    close: closeAll,
  };
};

const isMainModule = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    const executedPath = resolve(process.argv[1]);
    return currentFilePath === executedPath;
  } catch {
    return process.argv[1].endsWith('scheduler/src/index.ts');
  }
};

if (isMainModule()) {
  let keepAliveInterval: NodeJS.Timeout | undefined;

  startSchedulerProcess()
    .then((handle) => {
      let isShuttingDown = false;
      const healthFile = process.env.HEALTHCHECK_FILE ?? '/tmp/healthy';

      const shutdown = async (signal: string): Promise<void> => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        try {
          unlinkSync(healthFile);
        } catch {
          // Ignore
        }
        console.log(`[scheduler] Received ${signal}. Shutting down gracefully...`);
        try {
          await handle.close();
          console.log('[scheduler] Graceful shutdown completed.');
          process.exit(0);
        } catch (err) {
          console.error('[scheduler] Error during shutdown:', err);
          process.exit(1);
        }
      };

      process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
      });
      process.once('SIGINT', () => {
        void shutdown('SIGINT');
      });

      console.log(
        JSON.stringify({
          service: 'scheduler',
          status: 'running',
        }),
      );

      const touchHealth = () => {
        try {
          writeFileSync(healthFile, Date.now().toString());
        } catch {
          // Best effort
        }
      };
      touchHealth();

      // Keep process event loop alive indefinitely
      keepAliveInterval = setInterval(() => {
        touchHealth();
      }, 15_000);
    })
    .catch((err) => {
      console.error('[scheduler] Fatal startup error:', err);
      process.exit(1);
    });
}
