import type {
  TaskCheckpoint,
  TaskEventEnvelope,
  TaskEventType,
  TaskModel,
  TaskStatus,
} from './types.ts';

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
}
