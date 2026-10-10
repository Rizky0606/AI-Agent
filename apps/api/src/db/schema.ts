import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

const created = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    ...created,
  },
  (table) => [uniqueIndex('users_email_uq').on(table.email)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    platform: varchar('platform', { length: 32 }).notNull(),
    publicKey: text('public_key'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('devices_user_idx').on(table.userId),
    uniqueIndex('devices_user_name_uq').on(table.userId, table.name),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    ...created,
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_uq').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    ...created,
  },
  (table) => [
    index('projects_user_idx').on(table.userId),
    uniqueIndex('projects_user_name_uq').on(table.userId, table.name),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }),
    ...created,
  },
  (table) => [index('conversations_scope_idx').on(table.userId, table.projectId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    ...created,
  },
  (table) => [
    index('messages_scope_idx').on(table.userId, table.conversationId),
    index('messages_created_idx').on(table.conversationId, table.createdAt),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 80 }).notNull(),
    payload: jsonb('payload').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    progress: integer('progress').default(0).notNull(),
    attempt: integer('attempt').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    priority: integer('priority').default(0).notNull(),
    error: text('error'),
    checkpoint: jsonb('checkpoint'),
    artifacts: jsonb('artifacts'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('tasks_scope_status_idx').on(table.userId, table.projectId, table.status),
    uniqueIndex('tasks_user_idempotency_uq').on(table.userId, table.idempotencyKey),
    uniqueIndex('tasks_scope_uq').on(table.id, table.userId),
  ],
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    payload: jsonb('payload').notNull(),
    ...created,
  },
  (table) => [index('task_events_scope_idx').on(table.userId, table.taskId, table.createdAt)],
);

export const modelProviders = pgTable(
  'model_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    baseUrl: varchar('base_url', { length: 500 }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    ...created,
  },
  (table) => [uniqueIndex('model_providers_name_uq').on(table.name)],
);

export const modelConfigs = pgTable(
  'model_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => modelProviders.id, { onDelete: 'cascade' }),
    model: varchar('model', { length: 200 }).notNull(),
    capabilities: jsonb('capabilities').notNull(),
    contextWindow: integer('context_window'),
    costMetadata: jsonb('cost_metadata'),
    enabled: boolean('enabled').default(true).notNull(),
    ...created,
  },
  (table) => [
    uniqueIndex('model_configs_provider_model_uq').on(table.providerId, table.model),
    index('model_configs_enabled_idx').on(table.enabled),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 120 }).notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: uuid('resource_id'),
    decision: varchar('decision', { length: 32 }),
    traceId: varchar('trace_id', { length: 128 }),
    metadata: jsonb('metadata'),
    ...created,
  },
  (table) => [
    index('audit_logs_user_created_idx').on(table.userId, table.createdAt),
    index('audit_logs_project_created_idx').on(table.projectId, table.createdAt),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 120 }).notNull(),
    resource: varchar('resource', { length: 255 }).notNull(),
    scope: varchar('scope', { length: 120 }).notNull(),
    riskLevel: varchar('risk_level', { length: 32 }).notNull(),
    consequence: text('consequence').notNull(),
    status: varchar('status', { length: 32 }).default('pending').notNull(),
    decisionReason: text('decision_reason'),
    approverId: uuid('approver_id').references(() => users.id, { onDelete: 'set null' }),
    fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('approvals_user_status_idx').on(table.userId, table.status),
    index('approvals_task_idx').on(table.taskId),
    index('approvals_fingerprint_idx').on(table.fingerprint),
  ],
);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).notNull(),
    content: text('content').notNull(),
    scope: varchar('scope', { length: 120 }).notNull(),
    provenance: varchar('provenance', { length: 64 }).notNull(),
    metadata: jsonb('metadata'),
    retention: varchar('retention', { length: 32 }).default('permanent').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('memories_user_idx').on(table.userId),
    index('memories_user_project_idx').on(table.userId, table.projectId),
    index('memories_user_type_idx').on(table.userId, table.type),
    index('memories_user_scope_idx').on(table.userId, table.scope),
    index('memories_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    size: integer('size').notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    version: integer('version').default(1).notNull(),
    storageKey: text('storage_key').notNull(),
    retention: varchar('retention', { length: 32 }).default('project_lifetime').notNull(),
    accessPolicy: varchar('access_policy', { length: 32 }).default('owner_only').notNull(),
    metadata: jsonb('metadata'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('artifacts_owner_idx').on(table.ownerId),
    index('artifacts_project_idx').on(table.projectId),
    index('artifacts_task_idx').on(table.taskId),
    index('artifacts_created_idx').on(table.createdAt),
  ],
);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    description: text('description').notNull(),
    manifest: jsonb('manifest').notNull(),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    scope: varchar('scope', { length: 80 }).default('system').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    uniqueIndex('skills_name_uq').on(table.name),
    index('skills_is_enabled_idx').on(table.isEnabled),
  ],
);

export const skillRevisions = pgTable(
  'skill_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    skillName: varchar('skill_name', { length: 120 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    manifest: jsonb('manifest').notNull(),
    ...created,
  },
  (table) => [
    index('skill_revisions_name_idx').on(table.skillName),
    index('skill_revisions_name_version_idx').on(table.skillName, table.version),
  ],
);

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    runAt: timestamp('run_at', { withTimezone: true }),
    cronExpression: varchar('cron_expression', { length: 100 }),
    timezone: varchar('timezone', { length: 80 }).default('UTC').notNull(),
    status: varchar('status', { length: 32 }).default('active').notNull(),
    missedRunPolicy: varchar('missed_run_policy', { length: 32 }).default('skip').notNull(),
    taskPayload: jsonb('task_payload').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('schedules_user_idx').on(table.userId),
    index('schedules_status_idx').on(table.status),
    index('schedules_next_run_idx').on(table.nextRunAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    deliveryState: varchar('delivery_state', { length: 32 }).default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    deepLink: varchar('deep_link', { length: 255 }),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('notifications_user_idx').on(table.userId),
    index('notifications_delivery_state_idx').on(table.deliveryState),
    index('notifications_created_idx').on(table.createdAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [uniqueIndex('notification_preferences_user_uq').on(table.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type SkillRevisionRow = typeof skillRevisions.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
