import { and, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { schedules, type ScheduleRow } from './schema.ts';
import type {
  MissedRunPolicy,
  ScheduleJob,
  ScheduleStatus,
  ScheduleStorage,
  ScheduleType,
  TaskPayload,
} from '@personal-ai-os/scheduler';

export interface ScheduleRepository extends ScheduleStorage {
  getJob(id: string): Promise<ScheduleJob | null>;
  listJobs(filter?: { userId?: string; status?: ScheduleStatus }): Promise<ScheduleJob[]>;
  deleteJob(id: string): Promise<void>;
}

export class SqlScheduleRepository implements ScheduleRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private mapRowToJob(row: ScheduleRow): ScheduleJob {
    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId ?? undefined,
      name: row.name,
      type: row.type as ScheduleType,
      runAt: row.runAt ? row.runAt.toISOString() : undefined,
      cronExpression: row.cronExpression ?? undefined,
      timezone: row.timezone,
      status: row.status as ScheduleStatus,
      missedRunPolicy: row.missedRunPolicy as MissedRunPolicy,
      taskPayload: row.taskPayload as TaskPayload,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : undefined,
      nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : undefined,
      lastBrief: row.lastBrief ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async loadJobs(): Promise<ScheduleJob[]> {
    if (!this.db) return [];
    try {
      const rows = await this.db.select().from(schedules);
      return rows.map((r) => this.mapRowToJob(r));
    } catch {
      return [];
    }
  }

  async saveJob(job: ScheduleJob): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .insert(schedules)
        .values({
          id: job.id,
          userId: job.userId,
          projectId: job.projectId ?? null,
          name: job.name,
          type: job.type,
          runAt: job.runAt ? new Date(job.runAt) : null,
          cronExpression: job.cronExpression ?? null,
          timezone: job.timezone,
          status: job.status,
          missedRunPolicy: job.missedRunPolicy,
          taskPayload: job.taskPayload,
          lastRunAt: job.lastRunAt ? new Date(job.lastRunAt) : null,
          nextRunAt: job.nextRunAt ? new Date(job.nextRunAt) : null,
          lastBrief: job.lastBrief ?? null,
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt),
        })
        .onConflictDoUpdate({
          target: schedules.id,
          set: {
            name: job.name,
            type: job.type,
            runAt: job.runAt ? new Date(job.runAt) : null,
            cronExpression: job.cronExpression ?? null,
            timezone: job.timezone,
            status: job.status,
            missedRunPolicy: job.missedRunPolicy,
            taskPayload: job.taskPayload,
            lastRunAt: job.lastRunAt ? new Date(job.lastRunAt) : null,
            nextRunAt: job.nextRunAt ? new Date(job.nextRunAt) : null,
            lastBrief: job.lastBrief ?? null,
            updatedAt: new Date(job.updatedAt),
          },
        });
    } catch {
      // In-memory / graceful fallback if DB is not ready
    }
  }

  async updateJob(job: ScheduleJob): Promise<void> {
    return this.saveJob(job);
  }

  async deleteJob(id: string): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.delete(schedules).where(eq(schedules.id, id));
    } catch {
      // Ignore deletion errors on disconnected database
    }
  }

  async getJob(id: string): Promise<ScheduleJob | null> {
    if (!this.db) return null;
    try {
      const [row] = await this.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
      return row ? this.mapRowToJob(row) : null;
    } catch {
      return null;
    }
  }

  async listJobs(filter?: { userId?: string; status?: ScheduleStatus }): Promise<ScheduleJob[]> {
    if (!this.db) return [];
    try {
      const conditions = [];
      if (filter?.userId) conditions.push(eq(schedules.userId, filter.userId));
      if (filter?.status) conditions.push(eq(schedules.status, filter.status));
      const rows =
        conditions.length > 0
          ? await this.db
              .select()
              .from(schedules)
              .where(and(...conditions))
          : await this.db.select().from(schedules);
      return rows.map((r) => this.mapRowToJob(r));
    } catch {
      return [];
    }
  }
}
