import type { RiskLevel } from '@personal-ai-os/permissions';

export type ScheduleType = 'one_off' | 'recurring';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type MissedRunPolicy = 'skip' | 'run_once' | 'catch_up';

export interface TaskPayload {
  kind: string;
  input: Record<string, unknown>;
  priority?: number | undefined;
}

export interface ScheduleJob {
  id: string;
  userId: string;
  projectId?: string | undefined;
  name: string;
  type: ScheduleType;
  runAt?: string | undefined; // ISO string for one-off
  cronExpression?: string | undefined; // Cron expression for recurring
  timezone: string; // e.g. 'Asia/Jakarta', 'UTC'
  status: ScheduleStatus;
  missedRunPolicy: MissedRunPolicy;
  taskPayload: TaskPayload;
  lastRunAt?: string | undefined;
  nextRunAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledRunExecution {
  idempotencyKey: string;
  jobId: string;
  userId?: string | undefined;
  projectId?: string | undefined;
  scheduledTime: string;
  dispatchedAt: string;
  taskPayload: TaskPayload;
}

export type EventSource = 'internal' | 'external';

export interface EventEnvelope {
  id: string;
  source: string; // e.g. 'internal:task_monitor', 'external:github_webhook'
  type: string; // e.g. 'task.completed', 'task.failed', 'approval.required'
  timestamp: string; // ISO string
  payload: Record<string, unknown>;
  signature?: string | undefined;
  dedupKey?: string | undefined;
}

export interface EventSubscriptionRule {
  id: string;
  name: string;
  eventType: string; // Supports exact match or wildcard prefix e.g. 'task.*'
  sourcePattern?: string | undefined;
  targetAction: {
    action: string;
    resource: string;
    scope: string;
    riskLevel: RiskLevel;
  };
  createTaskPayload: (event: EventEnvelope) => TaskPayload;
}

export interface EventProcessingResult {
  eventId: string;
  accepted: boolean;
  duplicate: boolean;
  matchedRules: string[];
  dispatchedTasks: Array<{
    ruleId: string;
    permissionDecision: 'allow' | 'require_approval' | 'deny';
    taskId?: string | undefined;
    approvalRequired?: boolean | undefined;
    reason?: string | undefined;
  }>;
}

export type NotificationType =
  'approval_required' | 'task_completed' | 'task_failed' | 'blocker' | 'system_alert';

export type DeliveryState = 'pending' | 'sending' | 'delivered' | 'failed' | 'read' | 'skipped';

export interface NotificationData {
  type: NotificationType;
  taskId?: string | undefined;
  approvalId?: string | undefined;
  deepLink?: string | undefined;
  urgency?: 'high' | 'normal' | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  deliveryState: DeliveryState;
  attempts: number;
  maxAttempts: number;
  deepLink: string;
  lastError?: string | undefined;
  nextRetryAt?: string | undefined;
  createdAt: string;
  deliveredAt?: string | undefined;
  readAt?: string | undefined;
}

export interface NotificationPreferences {
  enabled: boolean;
  channels: {
    push: boolean;
    websocket: boolean;
  };
  quietHours?:
    | {
        enabled: boolean;
        start: string; // "HH:MM" 24h e.g. "22:00"
        end: string; // "HH:MM" 24h e.g. "07:00"
        timezone: string;
      }
    | undefined;
  categories: {
    approvalRequired: boolean;
    taskCompleted: boolean;
    taskFailed: boolean;
    blocker: boolean;
  };
}

export interface FcmPushPayload {
  title: string;
  body: string;
  data: {
    type: string;
    deepLink: string;
    taskId?: string | undefined;
    approvalId?: string | undefined;
    [key: string]: string | undefined;
  };
}

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventValidationError';
  }
}

export class EventPermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventPermissionDeniedError';
  }
}

export interface ScheduleStorage {
  loadJobs(): Promise<ScheduleJob[]>;
  saveJob(job: ScheduleJob): Promise<void>;
  updateJob(job: ScheduleJob): Promise<void>;
  deleteJob?(id: string): Promise<void>;
}

export interface NotificationStorage {
  saveNotification(notification: NotificationRecord): Promise<void>;
  updateNotification(notification: NotificationRecord): Promise<void>;
  getNotification(id: string): Promise<NotificationRecord | null>;
  listNotifications(userId: string): Promise<NotificationRecord[]>;
  getUserPreferences(userId: string): Promise<NotificationPreferences | null>;
  saveUserPreferences(userId: string, preferences: NotificationPreferences): Promise<void>;
}
