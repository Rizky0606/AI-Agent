export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting_approval'
  | 'paused'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type CheckpointActionType = 'internal' | 'external_tool' | 'approval' | 'system';

export interface CheckpointAcceptanceCriterion {
  id: string;
  description: string;
  category?: string | undefined;
  required?: boolean | undefined;
  expectedEvidenceType?: string | undefined;
}

export interface TaskCheckpoint {
  version: number;
  stepIndex: number;
  totalSteps: number;
  lastExecutedAction: string;
  actionType?: CheckpointActionType | undefined;
  actionState?: Record<string, unknown> | undefined;
  timestamp: string;
  checksum?: string | undefined;
  verified?: boolean | undefined;
  verificationNotes?: string | undefined;
  acceptanceCriteria?: CheckpointAcceptanceCriterion[] | undefined;
}

export interface TaskModel {
  id: string;
  userId: string;
  projectId: string;
  status: TaskStatus;
  kind: string;
  payload: Record<string, unknown>;
  /** Chat conversation that spawned this task, when it was launched from one. */
  conversationId?: string | null | undefined;
  progress: number;
  attempt: number;
  maxAttempts: number;
  priority: number;
  idempotencyKey?: string | null | undefined;
  leaseExpiresAt?: Date | null | undefined;
  startedAt?: Date | null | undefined;
  finishedAt?: Date | null | undefined;
  error?: string | null | undefined;
  checkpoint?: TaskCheckpoint | null | undefined;
  artifacts?: Array<unknown> | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export type TaskEventType =
  | 'task.created'
  | 'task.started'
  | 'task.progress'
  | 'task.tool_call'
  | 'task.waiting_approval'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.paused'
  | 'task.resumed'
  | 'runtime.step'
  | 'research.started'
  | 'research.plan'
  | 'research.search'
  | 'research.source'
  | 'research.page_read'
  | 'research.evidence'
  | 'research.draft'
  | 'research.verify'
  | 'research.done'
  | 'research.plan_approved'
  | 'research.completed'
  | 'research.cancelled'
  | 'research.error';

export interface TaskEventEnvelope {
  id: string;
  taskId: string;
  userId: string;
  eventType: TaskEventType;
  payload: Record<string, unknown>;
  createdAt: string; // ISO date string
  replayed?: boolean | undefined;
}

export interface TaskEventBroadcaster {
  publish(event: TaskEventEnvelope): Promise<void> | void;
  subscribe(listener: (event: TaskEventEnvelope) => void): () => void;
  subscribeUser(userId: string, listener: (event: TaskEventEnvelope) => void): () => void;
  close?(): Promise<void>;
}

export * from './runtime-step-event.ts';

