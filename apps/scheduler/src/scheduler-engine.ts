import { randomUUID } from 'node:crypto';
import { CronParser } from './cron-parser.ts';
import {
  type MissedRunPolicy,
  type ScheduledRunExecution,
  type ScheduleJob,
  type ScheduleStatus,
  type ScheduleStorage,
  type ScheduleType,
  SchedulerError,
  type TaskPayload,
  MAX_ACTIVE_SCHEDULES_PER_USER,
  MIN_RECURRING_INTERVAL_MINUTES,
} from './types.ts';

export type TaskDispatcher = (execution: ScheduledRunExecution) => Promise<void>;

export interface RegisterScheduleInput {
  id?: string | undefined;
  userId: string;
  projectId?: string | undefined;
  name: string;
  type: ScheduleType;
  runAt?: string | undefined;
  cronExpression?: string | undefined;
  timezone?: string | undefined;
  missedRunPolicy?: MissedRunPolicy | undefined;
  taskPayload: TaskPayload;
}

export interface UpdateScheduleInput {
  name?: string | undefined;
  cronExpression?: string | undefined;
  runAt?: string | undefined;
  timezone?: string | undefined;
  missedRunPolicy?: MissedRunPolicy | undefined;
  taskPayload?: TaskPayload | undefined;
}

export class SchedulerEngine {
  private readonly jobs = new Map<string, ScheduleJob>();
  private readonly dispatchedKeys = new Set<string>(); // Idempotency set
  private readonly inFlightJobs = new Set<string>(); // Concurrency lock per job
  private readonly dispatcher: TaskDispatcher;
  private readonly storage?: ScheduleStorage | undefined;

  constructor(options?: {
    dispatcher?: TaskDispatcher | undefined;
    storage?: ScheduleStorage | undefined;
  }) {
    this.dispatcher = options?.dispatcher ?? (async () => {});
    this.storage = options?.storage;
  }

  async init(): Promise<void> {
    await this.syncFromStorage();
  }

  async syncFromStorage(): Promise<void> {
    if (this.storage) {
      const persistedJobs = await this.storage.loadJobs();
      for (const job of persistedJobs) {
        this.jobs.set(job.id, job);
      }
    }
  }

  registerSchedule(input: RegisterScheduleInput): ScheduleJob {
    const id = input.id ?? randomUUID();
    const now = new Date();
    const timezone = input.timezone ?? 'Asia/Jakarta';
    const missedRunPolicy = input.missedRunPolicy ?? 'skip';

    // 1. Batasi jumlah jadwal aktif per pengguna
    const activeJobs = this.listJobs({ userId: input.userId, status: 'active' });
    if (activeJobs.length >= MAX_ACTIVE_SCHEDULES_PER_USER) {
      throw new SchedulerError(
        `Batas kuota maksimal ${MAX_ACTIVE_SCHEDULES_PER_USER} jadwal aktif telah tercapai untuk pengguna ini.`,
      );
    }

    if (input.type === 'one_off') {
      if (!input.runAt) {
        throw new SchedulerError('One-off schedule requires runAt timestamp');
      }
      const runDate = new Date(input.runAt);
      if (isNaN(runDate.getTime())) {
        throw new SchedulerError(`Invalid runAt timestamp: "${input.runAt}"`);
      }
    } else if (input.type === 'recurring') {
      if (!input.cronExpression) {
        throw new SchedulerError('Recurring schedule requires cronExpression');
      }
      // Validate cron expression structure and minimum interval
      CronParser.parse(input.cronExpression);
      CronParser.validateMinimumInterval(
        input.cronExpression,
        MIN_RECURRING_INTERVAL_MINUTES,
        timezone,
      );
    }

    let nextRunAt: string | undefined;
    if (input.type === 'one_off') {
      nextRunAt = new Date(input.runAt!).toISOString();
    } else {
      nextRunAt = CronParser.getNextRun(input.cronExpression!, now, timezone).toISOString();
    }

    const job: ScheduleJob = {
      id,
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      runAt: input.runAt,
      cronExpression: input.cronExpression,
      timezone,
      status: 'active',
      missedRunPolicy,
      taskPayload: input.taskPayload,
      nextRunAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.jobs.set(id, job);
    if (this.storage) {
      void this.storage.saveJob(job).catch(() => {});
    }
    return job;
  }

  getJob(id: string): ScheduleJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(filter?: {
    userId?: string | undefined;
    status?: ScheduleStatus | undefined;
  }): ScheduleJob[] {
    let list = Array.from(this.jobs.values());
    if (filter?.userId) {
      list = list.filter((j) => j.userId === filter.userId);
    }
    if (filter?.status) {
      list = list.filter((j) => j.status === filter.status);
    }
    return list;
  }

  pauseSchedule(id: string): ScheduleJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new SchedulerError(`Schedule with id "${id}" not found`);
    }
    job.status = 'paused';
    job.updatedAt = new Date().toISOString();
    if (this.storage) {
      void this.storage.updateJob(job).catch(() => {});
    }
    return job;
  }

  resumeSchedule(id: string, now = new Date()): ScheduleJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new SchedulerError(`Schedule with id "${id}" not found`);
    }
    job.status = 'active';
    job.updatedAt = now.toISOString();

    // Recalculate next run if it expired during pause
    if (job.type === 'recurring' && job.cronExpression) {
      job.nextRunAt = CronParser.getNextRun(job.cronExpression, now, job.timezone).toISOString();
    } else if (job.type === 'one_off' && job.nextRunAt && new Date(job.nextRunAt) < now) {
      // One-off that lapsed during pause
      if (job.missedRunPolicy === 'skip') {
        job.status = 'cancelled';
      }
    }

    if (this.storage) {
      void this.storage.updateJob(job).catch(() => {});
    }
    return job;
  }

  cancelSchedule(id: string): ScheduleJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new SchedulerError(`Schedule with id "${id}" not found`);
    }
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    if (this.storage) {
      void this.storage.updateJob(job).catch(() => {});
    }
    return job;
  }

  updateLastBrief(id: string, brief: string): ScheduleJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new SchedulerError(`Schedule with id "${id}" not found`);
    }
    job.lastBrief = brief;
    job.updatedAt = new Date().toISOString();
    if (this.storage) {
      void this.storage.updateJob(job).catch(() => {});
    }
    return job;
  }

  updateSchedule(id: string, updates: UpdateScheduleInput, now = new Date()): ScheduleJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new SchedulerError(`Schedule with id "${id}" not found`);
    }

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (!trimmed) {
        throw new SchedulerError('Field name tidak boleh kosong');
      }
      job.name = trimmed;
    }

    if (updates.timezone !== undefined) {
      job.timezone = updates.timezone.trim() || 'Asia/Jakarta';
    }

    if (updates.missedRunPolicy !== undefined) {
      job.missedRunPolicy = updates.missedRunPolicy;
    }

    if (updates.taskPayload !== undefined) {
      job.taskPayload = updates.taskPayload;
    }

    if (job.type === 'recurring') {
      if (updates.cronExpression !== undefined) {
        const cron = updates.cronExpression.trim();
        CronParser.parse(cron);
        CronParser.validateMinimumInterval(cron, MIN_RECURRING_INTERVAL_MINUTES, job.timezone);
        job.cronExpression = cron;
      }
      if (job.status === 'active' && job.cronExpression) {
        job.nextRunAt = CronParser.getNextRun(job.cronExpression, now, job.timezone).toISOString();
      }
    } else if (job.type === 'one_off') {
      if (updates.runAt !== undefined) {
        const runDate = new Date(updates.runAt);
        if (isNaN(runDate.getTime())) {
          throw new SchedulerError(`Invalid runAt timestamp: "${updates.runAt}"`);
        }
        if (runDate.getTime() <= now.getTime()) {
          throw new SchedulerError('Waktu eksekusi runAt harus berada di masa depan');
        }
        job.runAt = runDate.toISOString();
        if (job.status === 'active') {
          job.nextRunAt = job.runAt;
        }
      }
    }

    job.updatedAt = now.toISOString();
    if (this.storage) {
      void this.storage.updateJob(job).catch(() => {});
    }
    return job;
  }

  /**
   * Main execution loop/tick. Examines all active schedules against `now`.
   * Handles idempotency, locking, and missed-run policies.
   */
  async tick(now = new Date()): Promise<ScheduledRunExecution[]> {
    const executed: ScheduledRunExecution[] = [];

    for (const job of this.jobs.values()) {
      if (job.status !== 'active' || !job.nextRunAt) {
        continue;
      }

      const nextRunDate = new Date(job.nextRunAt);
      if (nextRunDate > now) {
        // Not due yet
        continue;
      }

      // Concurrency lock: prevent simultaneous overlapping executions for same job
      if (this.inFlightJobs.has(job.id)) {
        continue;
      }

      this.inFlightJobs.add(job.id);
      try {
        if (job.type === 'one_off') {
          // ONE-OFF JOB
          const idempotencyKey = `sched:${job.id}:${job.nextRunAt}`;
          if (!this.dispatchedKeys.has(idempotencyKey)) {
            this.dispatchedKeys.add(idempotencyKey);
            const execution: ScheduledRunExecution = {
              idempotencyKey,
              jobId: job.id,
              userId: job.userId,
              projectId: job.projectId,
              scheduledTime: job.nextRunAt,
              dispatchedAt: now.toISOString(),
              taskPayload: job.taskPayload,
            };
            await this.dispatcher(execution);
            executed.push(execution);
          }
          job.lastRunAt = now.toISOString();
          job.status = 'completed';
          job.nextRunAt = undefined;
          job.updatedAt = now.toISOString();
        } else {
          // RECURRING JOB - check for missed runs
          const scheduledSlot = nextRunDate;
          const policy = job.missedRunPolicy;

          // Check if there are missed executions between scheduledSlot and now
          // (meaning nextRunDate was significantly earlier than now)
          const missedSlots: Date[] = [scheduledSlot];
          let cursor = scheduledSlot;

          // Calculate subsequent missed slots if any
          const maxCatchUpRuns = 25; // Safety bound against unbounded catch-up storm
          while (true) {
            try {
              const nextSlot = CronParser.getNextRun(job.cronExpression!, cursor, job.timezone);
              if (nextSlot <= now && missedSlots.length < maxCatchUpRuns) {
                missedSlots.push(nextSlot);
                cursor = nextSlot;
              } else {
                break;
              }
            } catch {
              break;
            }
          }

          if (missedSlots.length > 1) {
            // MISSED RUN OCCURRED
            if (policy === 'skip') {
              // Discard past missed runs, advance to next future occurrence
              const futureRun = CronParser.getNextRun(job.cronExpression!, now, job.timezone);
              job.nextRunAt = futureRun.toISOString();
              job.updatedAt = now.toISOString();
            } else if (policy === 'run_once') {
              // Dispatch exactly 1 execution for the latest missed slot
              const latestSlot = missedSlots[missedSlots.length - 1]!;
              const idempotencyKey = `sched:${job.id}:${latestSlot.toISOString()}`;
              if (!this.dispatchedKeys.has(idempotencyKey)) {
                this.dispatchedKeys.add(idempotencyKey);
                const execution: ScheduledRunExecution = {
                  idempotencyKey,
                  jobId: job.id,
                  userId: job.userId,
                  projectId: job.projectId,
                  scheduledTime: latestSlot.toISOString(),
                  dispatchedAt: now.toISOString(),
                  taskPayload: job.taskPayload,
                };
                await this.dispatcher(execution);
                executed.push(execution);
              }
              job.lastRunAt = now.toISOString();
              const futureRun = CronParser.getNextRun(job.cronExpression!, now, job.timezone);
              job.nextRunAt = futureRun.toISOString();
              job.updatedAt = now.toISOString();
            } else if (policy === 'catch_up') {
              // Dispatch each missed slot sequentially
              for (const slot of missedSlots) {
                const idempotencyKey = `sched:${job.id}:${slot.toISOString()}`;
                if (!this.dispatchedKeys.has(idempotencyKey)) {
                  this.dispatchedKeys.add(idempotencyKey);
                  const execution: ScheduledRunExecution = {
                    idempotencyKey,
                    jobId: job.id,
                    userId: job.userId,
                    projectId: job.projectId,
                    scheduledTime: slot.toISOString(),
                    dispatchedAt: now.toISOString(),
                    taskPayload: job.taskPayload,
                  };
                  await this.dispatcher(execution);
                  executed.push(execution);
                }
              }
              job.lastRunAt = now.toISOString();
              const futureRun = CronParser.getNextRun(job.cronExpression!, now, job.timezone);
              job.nextRunAt = futureRun.toISOString();
              job.updatedAt = now.toISOString();
            }
          } else {
            // NORMAL SINGLE RUN
            const idempotencyKey = `sched:${job.id}:${scheduledSlot.toISOString()}`;
            if (!this.dispatchedKeys.has(idempotencyKey)) {
              this.dispatchedKeys.add(idempotencyKey);
              const execution: ScheduledRunExecution = {
                idempotencyKey,
                jobId: job.id,
                userId: job.userId,
                projectId: job.projectId,
                scheduledTime: scheduledSlot.toISOString(),
                dispatchedAt: now.toISOString(),
                taskPayload: job.taskPayload,
              };
              await this.dispatcher(execution);
              executed.push(execution);
            }
            job.lastRunAt = now.toISOString();
            const futureRun = CronParser.getNextRun(job.cronExpression!, now, job.timezone);
            job.nextRunAt = futureRun.toISOString();
            job.updatedAt = now.toISOString();
          }
        }
        if (this.storage) {
          await this.storage.updateJob(job);
        }
      } finally {
        this.inFlightJobs.delete(job.id);
      }
    }

    return executed;
  }
}
