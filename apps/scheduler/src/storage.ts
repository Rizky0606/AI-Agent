import type postgres from 'postgres';
import {
  type DeliveryState,
  type MissedRunPolicy,
  type NotificationData,
  type NotificationRecord,
  type NotificationStorage,
  type NotificationType,
  type ScheduleJob,
  type ScheduleStatus,
  type ScheduleStorage,
  type ScheduleType,
  type TaskPayload,
} from './types.ts';

const mapRowToJob = (row: Record<string, unknown>): ScheduleJob => {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    projectId: row['project_id'] ? String(row['project_id']) : undefined,
    name: String(row['name']),
    type: row['type'] as ScheduleType,
    runAt: row['run_at'] ? new Date(row['run_at'] as string | Date).toISOString() : undefined,
    cronExpression: row['cron_expression'] ? String(row['cron_expression']) : undefined,
    timezone: String(row['timezone'] ?? 'UTC'),
    status: row['status'] as ScheduleStatus,
    missedRunPolicy: row['missed_run_policy'] as MissedRunPolicy,
    taskPayload: (row['task_payload'] ?? {}) as TaskPayload,
    lastRunAt: row['last_run_at']
      ? new Date(row['last_run_at'] as string | Date).toISOString()
      : undefined,
    nextRunAt: row['next_run_at']
      ? new Date(row['next_run_at'] as string | Date).toISOString()
      : undefined,
    createdAt: new Date(row['created_at'] as string | Date).toISOString(),
    updatedAt: new Date(row['updated_at'] as string | Date).toISOString(),
  };
};

const mapRowToNotification = (row: Record<string, unknown>): NotificationRecord => {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    type: row['type'] as NotificationType,
    title: String(row['title']),
    body: String(row['body']),
    data: (row['data'] ?? {}) as NotificationData,
    deliveryState: row['delivery_state'] as DeliveryState,
    attempts: Number(row['attempts'] ?? 0),
    maxAttempts: Number(row['max_attempts'] ?? 3),
    deepLink: String(row['deep_link'] ?? ''),
    lastError: row['last_error'] ? String(row['last_error']) : undefined,
    deliveredAt: row['delivered_at']
      ? new Date(row['delivered_at'] as string | Date).toISOString()
      : undefined,
    readAt: row['read_at'] ? new Date(row['read_at'] as string | Date).toISOString() : undefined,
    createdAt: new Date(row['created_at'] as string | Date).toISOString(),
  };
};

export class PostgresScheduleStorage implements ScheduleStorage {
  private readonly sql: postgres.Sql;

  constructor(sql: postgres.Sql) {
    this.sql = sql;
  }

  async loadJobs(): Promise<ScheduleJob[]> {
    const rows = await this.sql`
      SELECT id, user_id, project_id, name, type, run_at, cron_expression,
             timezone, status, missed_run_policy, task_payload, last_run_at,
             next_run_at, created_at, updated_at
      FROM schedules
    `;
    return rows.map((r) => mapRowToJob(r as Record<string, unknown>));
  }

  async saveJob(job: ScheduleJob): Promise<void> {
    const runAt = job.runAt ? new Date(job.runAt) : null;
    const lastRunAt = job.lastRunAt ? new Date(job.lastRunAt) : null;
    const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
    const createdAt = new Date(job.createdAt);
    const updatedAt = new Date(job.updatedAt);

    await this.sql`
      INSERT INTO schedules (
        id, user_id, project_id, name, type, run_at, cron_expression,
        timezone, status, missed_run_policy, task_payload, last_run_at,
        next_run_at, created_at, updated_at
      ) VALUES (
        ${job.id}, ${job.userId}, ${job.projectId ?? null}, ${job.name},
        ${job.type}, ${runAt}, ${job.cronExpression ?? null},
        ${job.timezone}, ${job.status}, ${job.missedRunPolicy},
        ${this.sql.json(job.taskPayload as never)}, ${lastRunAt},
        ${nextRunAt}, ${createdAt}, ${updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        run_at = EXCLUDED.run_at,
        cron_expression = EXCLUDED.cron_expression,
        timezone = EXCLUDED.timezone,
        status = EXCLUDED.status,
        missed_run_policy = EXCLUDED.missed_run_policy,
        task_payload = EXCLUDED.task_payload,
        last_run_at = EXCLUDED.last_run_at,
        next_run_at = EXCLUDED.next_run_at,
        updated_at = EXCLUDED.updated_at
    `;
  }

  async updateJob(job: ScheduleJob): Promise<void> {
    return this.saveJob(job);
  }

  async deleteJob(id: string): Promise<void> {
    await this.sql`DELETE FROM schedules WHERE id = ${id}`;
  }

  async getJob(id: string): Promise<ScheduleJob | null> {
    const [row] = await this.sql`
      SELECT id, user_id, project_id, name, type, run_at, cron_expression,
             timezone, status, missed_run_policy, task_payload, last_run_at,
             next_run_at, created_at, updated_at
      FROM schedules
      WHERE id = ${id}
      LIMIT 1
    `;
    return row ? mapRowToJob(row as Record<string, unknown>) : null;
  }
}

export class PostgresNotificationStorage implements NotificationStorage {
  private readonly sql: postgres.Sql;

  constructor(sql: postgres.Sql) {
    this.sql = sql;
  }

  async saveNotification(record: NotificationRecord): Promise<void> {
    const deliveredAt = record.deliveredAt ? new Date(record.deliveredAt) : null;
    const readAt = record.readAt ? new Date(record.readAt) : null;
    const createdAt = new Date(record.createdAt);

    await this.sql`
      INSERT INTO notifications (
        id, user_id, type, title, body, data, delivery_state,
        attempts, max_attempts, deep_link, last_error,
        delivered_at, read_at, created_at
      ) VALUES (
        ${record.id}, ${record.userId}, ${record.type}, ${record.title},
        ${record.body}, ${this.sql.json(record.data as never)}, ${record.deliveryState},
        ${record.attempts}, ${record.maxAttempts}, ${record.deepLink},
        ${record.lastError ?? null}, ${deliveredAt}, ${readAt}, ${createdAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        delivery_state = EXCLUDED.delivery_state,
        attempts = EXCLUDED.attempts,
        last_error = EXCLUDED.last_error,
        delivered_at = EXCLUDED.delivered_at,
        read_at = EXCLUDED.read_at
    `;
  }

  async updateNotification(record: NotificationRecord): Promise<void> {
    const deliveredAt = record.deliveredAt ? new Date(record.deliveredAt) : null;
    const readAt = record.readAt ? new Date(record.readAt) : null;

    await this.sql`
      UPDATE notifications
      SET
        delivery_state = ${record.deliveryState},
        attempts = ${record.attempts},
        last_error = ${record.lastError ?? null},
        delivered_at = ${deliveredAt},
        read_at = ${readAt}
      WHERE id = ${record.id}
    `;
  }

  async getNotification(id: string): Promise<NotificationRecord | null> {
    const [row] = await this.sql`
      SELECT id, user_id, type, title, body, data, delivery_state,
             attempts, max_attempts, deep_link, last_error,
             delivered_at, read_at, created_at
      FROM notifications
      WHERE id = ${id}
      LIMIT 1
    `;
    return row ? mapRowToNotification(row as Record<string, unknown>) : null;
  }

  async listNotifications(userId: string): Promise<NotificationRecord[]> {
    const rows = await this.sql`
      SELECT id, user_id, type, title, body, data, delivery_state,
             attempts, max_attempts, deep_link, last_error,
             delivered_at, read_at, created_at
      FROM notifications
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return rows.map((r) => mapRowToNotification(r as Record<string, unknown>));
  }
}
