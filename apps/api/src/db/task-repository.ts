import crypto from 'node:crypto';
import {
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskEventType,
  type TaskModel,
  TaskStateMachine,
  type TaskStatus,
} from '@personal-ai-os/shared';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Database } from './client.ts';
import { taskEvents, tasks } from './schema.ts';

export type TaskRecord = TaskModel;

export interface CreateTaskParams {
  userId: string;
  projectId: string;
  kind: string;
  payload: Record<string, unknown>;
  conversationId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  priority?: number | undefined;
  maxAttempts?: number | undefined;
}

export interface TaskRepository {
  createTask(params: CreateTaskParams): Promise<{ task: TaskRecord; isDuplicate: boolean }>;
  getTask(userId: string, taskId: string): Promise<TaskRecord | null>;
  listTasks(
    userId: string,
    filter?: { projectId?: string | undefined; conversationId?: string | undefined },
  ): Promise<TaskRecord[]>;
  updateTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    updates?: Partial<TaskRecord>,
  ): Promise<TaskRecord>;
  updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord>;
  createTaskEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventType,
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope>;
  getTaskEvents(
    userId: string,
    taskId: string,
    options?: { afterEventId?: string | undefined; limit?: number | undefined },
  ): Promise<TaskEventEnvelope[]>;
  getDanglingRunningTasks(): Promise<TaskRecord[]>;
  claimTaskForRecovery?(taskId: string): Promise<boolean>;
  releaseTaskRecovery?(taskId: string): Promise<void>;
}

export class SqlTaskRepository implements TaskRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createTask(params: CreateTaskParams): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    // 1. Check idempotency
    if (params.idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.userId, params.userId), eq(tasks.idempotencyKey, params.idempotencyKey)),
        )
        .limit(1);

      if (existing) {
        return { task: this.mapRow(existing), isDuplicate: true };
      }
    }

    // 2. Insert new task
    const [created] = await this.db
      .insert(tasks)
      .values({
        userId: params.userId,
        projectId: params.projectId,
        status: 'queued',
        kind: params.kind,
        payload: params.payload,
        conversationId: params.conversationId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        priority: params.priority ?? 0,
        maxAttempts: params.maxAttempts ?? 3,
        attempt: 0,
        progress: 0,
      })
      .returning();

    if (!created) throw new Error('Failed to create task');
    return { task: this.mapRow(created), isDuplicate: false };
  }

  async getTask(userId: string, taskId: string): Promise<TaskRecord | null> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);

    if (!row) return null;
    return this.mapRow(row);
  }

  async listTasks(
    userId: string,
    filter?: { projectId?: string | undefined; conversationId?: string | undefined },
  ): Promise<TaskRecord[]> {
    const conditions = [eq(tasks.userId, userId)];
    if (filter?.projectId) {
      conditions.push(eq(tasks.projectId, filter.projectId));
    }
    if (filter?.conversationId) {
      conditions.push(eq(tasks.conversationId, filter.conversationId));
    }

    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt));

    return rows.map((r) => this.mapRow(r));
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    updates?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const current = await this.getTask(userId, taskId);
    if (!current) throw new Error(`Task ${taskId} not found`);

    TaskStateMachine.assertTransition(current.status, nextStatus);

    const patch: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: new Date(),
    };

    if (nextStatus === 'running' && !current.startedAt) {
      patch.startedAt = new Date();
    }
    if (TaskStateMachine.isTerminal(nextStatus) || nextStatus === 'failed') {
      patch.finishedAt = new Date();
    }
    if (updates?.error !== undefined) {
      patch.error = updates.error;
    }
    if (updates?.attempt !== undefined) {
      patch.attempt = updates.attempt;
    }
    if (updates?.checkpoint !== undefined) {
      patch.checkpoint = updates.checkpoint;
    }
    if (updates?.artifacts !== undefined) {
      patch.artifacts = updates.artifacts;
    }
    if (updates?.progress !== undefined) {
      patch.progress = updates.progress;
    }

    const [updated] = await this.db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();

    if (!updated) throw new Error(`Failed to update task ${taskId}`);
    return this.mapRow(updated);
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const patch: Record<string, unknown> = {
      progress,
      updatedAt: new Date(),
    };
    if (checkpoint) {
      patch.checkpoint = checkpoint;
    }

    const [updated] = await this.db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();

    if (!updated) throw new Error(`Failed to update task progress ${taskId}`);
    return this.mapRow(updated);
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventType,
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const [created] = await this.db
      .insert(taskEvents)
      .values({
        taskId,
        userId,
        eventType,
        payload,
      })
      .returning();

    if (!created) throw new Error('Failed to create task event');
    return {
      id: created.id,
      taskId: created.taskId,
      userId: created.userId,
      eventType: created.eventType as TaskEventType,
      payload: created.payload as Record<string, unknown>,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async getTaskEvents(
    userId: string,
    taskId: string,
    options?: { afterEventId?: string | undefined; limit?: number | undefined },
  ): Promise<TaskEventEnvelope[]> {
    const conditions = [eq(taskEvents.taskId, taskId), eq(taskEvents.userId, userId)];

    if (options?.afterEventId) {
      // Find timestamp of afterEventId
      const [anchor] = await this.db
        .select({ createdAt: taskEvents.createdAt })
        .from(taskEvents)
        .where(and(eq(taskEvents.id, options.afterEventId), eq(taskEvents.taskId, taskId)))
        .limit(1);

      if (anchor) {
        conditions.push(gt(taskEvents.createdAt, anchor.createdAt));
      }
    }

    const query = this.db
      .select()
      .from(taskEvents)
      .where(and(...conditions))
      .orderBy(taskEvents.createdAt);

    const rows = options?.limit ? await query.limit(options.limit) : await query;

    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      userId: r.userId,
      eventType: r.eventType as TaskEventType,
      payload: r.payload as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getDanglingRunningTasks(): Promise<TaskRecord[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(
        or(
          eq(tasks.status, 'running'),
          eq(tasks.status, 'planning'),
          eq(tasks.status, 'queued'),
        ),
      );

    return rows.map((r) => this.mapRow(r));
  }

  async claimTaskForRecovery(taskId: string): Promise<boolean> {
    try {
      const now = new Date();
      const leaseExpiry = new Date(now.getTime() + 5 * 60 * 1000);
      const [updated] = await this.db
        .update(tasks)
        .set({ leaseExpiresAt: leaseExpiry, updatedAt: now })
        .where(
          and(
            eq(tasks.id, taskId),
            or(isNull(tasks.leaseExpiresAt), lt(tasks.leaseExpiresAt, now)),
          ),
        )
        .returning();

      return Boolean(updated);
    } catch {
      return false;
    }
  }

  async releaseTaskRecovery(taskId: string): Promise<void> {
    try {
      await this.db
        .update(tasks)
        .set({ leaseExpiresAt: null, updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
    } catch {
      // Best effort
    }
  }

  private mapRow(row: typeof tasks.$inferSelect): TaskRecord {
    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      status: row.status as TaskStatus,
      kind: row.kind,
      payload: row.payload as Record<string, unknown>,
      conversationId: row.conversationId,
      progress: row.progress,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      priority: row.priority,
      idempotencyKey: row.idempotencyKey,
      leaseExpiresAt: row.leaseExpiresAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      error: row.error,
      checkpoint: (row.checkpoint as TaskCheckpoint | null) ?? null,
      artifacts: (row.artifacts as unknown[] | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class InMemoryTaskRepository implements TaskRepository {
  private tasks = new Map<string, TaskRecord>();
  private events: TaskEventEnvelope[] = [];
  private recoveryLocks = new Set<string>();

  async createTask(params: CreateTaskParams): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    if (params.idempotencyKey) {
      const existing = [...this.tasks.values()].find(
        (t) => t.userId === params.userId && t.idempotencyKey === params.idempotencyKey,
      );
      if (existing) {
        return { task: { ...existing }, isDuplicate: true };
      }
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const record: TaskRecord = {
      id,
      userId: params.userId,
      projectId: params.projectId,
      status: 'queued',
      kind: params.kind,
      payload: params.payload,
      conversationId: params.conversationId ?? null,
      progress: 0,
      attempt: 0,
      maxAttempts: params.maxAttempts ?? 3,
      priority: params.priority ?? 0,
      idempotencyKey: params.idempotencyKey ?? null,
      error: null,
      checkpoint: null,
      artifacts: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, record);
    return { task: { ...record }, isDuplicate: false };
  }

  async getTask(userId: string, taskId: string): Promise<TaskRecord | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) return null;
    return { ...task };
  }

  async listTasks(
    userId: string,
    filter?: { projectId?: string | undefined; conversationId?: string | undefined },
  ): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter(
        (t) =>
          t.userId === userId &&
          (!filter?.projectId || t.projectId === filter.projectId) &&
          (!filter?.conversationId || t.conversationId === filter.conversationId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((t) => ({ ...t }));
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    nextStatus: TaskStatus,
    updates?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      throw new Error(`Task ${taskId} not found`);
    }

    TaskStateMachine.assertTransition(task.status, nextStatus);

    task.status = nextStatus;
    task.updatedAt = new Date();

    if (nextStatus === 'running' && !task.startedAt) {
      task.startedAt = new Date();
    }
    if (TaskStateMachine.isTerminal(nextStatus) || nextStatus === 'failed') {
      task.finishedAt = new Date();
    }
    if (updates?.error !== undefined) task.error = updates.error;
    if (updates?.attempt !== undefined) task.attempt = updates.attempt;
    if (updates?.checkpoint !== undefined) task.checkpoint = updates.checkpoint;
    if (updates?.artifacts !== undefined) task.artifacts = updates.artifacts;
    if (updates?.progress !== undefined) task.progress = updates.progress;

    return { ...task };
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.progress = progress;
    task.updatedAt = new Date();
    if (checkpoint) {
      task.checkpoint = checkpoint;
    }
    return { ...task };
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventType,
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const event: TaskEventEnvelope = {
      id: crypto.randomUUID(),
      taskId,
      userId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return { ...event };
  }

  async getTaskEvents(
    userId: string,
    taskId: string,
    options?: { afterEventId?: string | undefined; limit?: number | undefined },
  ): Promise<TaskEventEnvelope[]> {
    let matched = this.events.filter((e) => e.taskId === taskId && e.userId === userId);

    if (options?.afterEventId) {
      const idx = matched.findIndex((e) => e.id === options.afterEventId);
      if (idx !== -1) {
        matched = matched.slice(idx + 1);
      }
    }

    if (options?.limit) {
      matched = matched.slice(0, options.limit);
    }

    return matched.map((e) => ({ ...e }));
  }

  async claimTaskForRecovery(taskId: string): Promise<boolean> {
    if (this.recoveryLocks.has(taskId)) {
      return false;
    }
    const task = this.tasks.get(taskId);
    if (!task) return false;
    const now = new Date();
    if (task.leaseExpiresAt && task.leaseExpiresAt > now) {
      return false;
    }
    this.recoveryLocks.add(taskId);
    task.leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    return true;
  }

  async releaseTaskRecovery(taskId: string): Promise<void> {
    this.recoveryLocks.delete(taskId);
    const task = this.tasks.get(taskId);
    if (task) {
      task.leaseExpiresAt = null;
    }
  }

  async getDanglingRunningTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((t) => t.status === 'running' || t.status === 'planning' || t.status === 'queued')
      .map((t) => ({ ...t }));
  }
}
