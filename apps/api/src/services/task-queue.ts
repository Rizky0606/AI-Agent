import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { TaskRecord } from '../db/task-repository.ts';

export const TASK_QUEUE_NAME = 'personal-ai-os-tasks';

export interface TaskJobData {
  taskId: string;
  userId: string;
  projectId: string;
  kind: string;
  attempt: number;
  maxAttempts: number;
  traceparent?: string | undefined;
}

export interface TaskQueue {
  enqueue(task: TaskRecord): Promise<void>;
  cancel(taskId: string): Promise<void>;
  close(): Promise<void>;
}

export class BullMqTaskQueue implements TaskQueue {
  private readonly queue: Queue;

  constructor(redis: Redis, options?: { queueName?: string | undefined }) {
    this.queue = new Queue(options?.queueName ?? TASK_QUEUE_NAME, {
      connection: redis as never,
    });
  }

  async enqueue(task: TaskRecord): Promise<void> {
    const existingJob = await this.queue.getJob(task.id);
    if (existingJob) {
      try {
        await existingJob.remove();
      } catch {
        // ignore
      }
    }

    const payloadObj = task.payload as Record<string, unknown> | null | undefined;
    const traceparent = typeof payloadObj?.traceparent === 'string' ? payloadObj.traceparent : undefined;

    await this.queue.add(
      task.kind,
      {
        taskId: task.id,
        userId: task.userId,
        projectId: task.projectId,
        kind: task.kind,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        traceparent,
      },
      {
        jobId: task.id,
        attempts: task.maxAttempts,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        priority: task.priority,
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  }

  async cancel(taskId: string): Promise<void> {
    const job = await this.queue.getJob(taskId);
    if (job) {
      await job.remove();
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class InMemoryTaskQueue implements TaskQueue {
  private readonly jobs = new Map<string, TaskJobData>();
  private handler: ((data: TaskJobData) => Promise<void>) | null = null;
  private readonly autoDispatch: boolean;

  constructor(options?: { autoDispatch?: boolean | undefined }) {
    this.autoDispatch = options?.autoDispatch ?? true;
  }

  setHandler(handler: (data: TaskJobData) => Promise<void>): void {
    this.handler = handler;
  }

  async enqueue(task: TaskRecord): Promise<void> {
    const jobData: TaskJobData = {
      taskId: task.id,
      userId: task.userId,
      projectId: task.projectId,
      kind: task.kind,
      attempt: task.attempt,
      maxAttempts: task.maxAttempts,
    };
    this.jobs.set(task.id, jobData);

    if (this.autoDispatch && this.handler) {
      // Dispatch asynchronously without blocking caller
      queueMicrotask(() => {
        if (this.jobs.has(task.id) && this.handler) {
          this.handler(jobData).catch(() => {
            // Unhandled error in simulated worker
          });
        }
      });
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.jobs.delete(taskId);
  }

  async close(): Promise<void> {
    this.jobs.clear();
    this.handler = null;
  }

  getEnqueuedJob(taskId: string): TaskJobData | undefined {
    return this.jobs.get(taskId);
  }
}
