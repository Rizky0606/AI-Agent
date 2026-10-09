import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  type EventPublisher,
  PLACEHOLDER_WORKER_LABEL,
  TaskExecutor,
  type TaskJobData,
} from './task-executor.ts';
import type { TaskRepository } from '@personal-ai-os/shared';

export * from './task-executor.ts';

export interface WorkerConfig {
  redisUrl?: string | undefined;
  concurrency?: number | undefined;
  taskRepo: TaskRepository;
  broadcaster: EventPublisher;
}

export const createAgentWorker = (
  config: WorkerConfig,
): {
  executor: TaskExecutor;
  worker?: Worker | undefined;
  close: () => Promise<void>;
} => {
  const executor = new TaskExecutor(config.taskRepo, config.broadcaster);
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

// Standalone execution if started directly via process
if (process.argv[1]?.endsWith('agent-worker/src/index.ts')) {
  const shutdown = (): void => process.exit(0);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(
    JSON.stringify({
      service: 'agent-worker',
      status: 'initialized',
      note: PLACEHOLDER_WORKER_LABEL,
    }),
  );
}
