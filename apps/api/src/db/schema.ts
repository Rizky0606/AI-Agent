import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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
    // Null for accounts that only ever signed in through a provider.
    passwordHash: text('password_hash'),
    defaultModel: varchar('default_model', { length: 200 }),
    defaultMode: varchar('default_mode', { length: 16 }).default('auto'),
    ...created,
  },
  (table) => [uniqueIndex('users_email_uq').on(table.email)],
);

export const userIdentities = pgTable(
  'user_identities',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    ...created,
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.subject] }),
    index('user_identities_user_id_idx').on(table.userId),
  ],
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
    pushToken: text('push_token'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('devices_user_idx').on(table.userId),
    // Identity is the key, not the name: two machines may share a hostname, and one key must not
    // claim devices under two accounts.
    uniqueIndex('devices_public_key_uq')
      .on(table.publicKey)
      .where(sql`public_key IS NOT NULL`),
    uniqueIndex('devices_push_token_uq')
      .on(table.pushToken)
      .where(sql`push_token IS NOT NULL`),
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
    mode: varchar('mode', { length: 16 }).default('auto').notNull(),
    model: varchar('model', { length: 200 }),
    workspaceId: text('workspace_id'),
    parentConversationId: uuid('parent_conversation_id'),
    compactedSummary: text('compacted_summary'),
    lastEventId: text('last_event_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('conversations_scope_idx').on(table.userId, table.projectId),
    index('conversations_parent_idx').on(table.parentConversationId),
  ],
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
    parentMessageId: uuid('parent_message_id'),
    isActiveBranch: boolean('is_active_branch').default(true).notNull(),
    branchIndex: integer('branch_index').default(0).notNull(),
    role: varchar('role', { length: 32 }).notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    ...created,
  },
  (table) => [
    index('messages_scope_idx').on(table.userId, table.conversationId),
    index('messages_created_idx').on(table.conversationId, table.createdAt),
    index('messages_parent_idx').on(table.conversationId, table.parentMessageId),
    index('messages_active_idx').on(table.conversationId, table.isActiveBranch),
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
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    parentTaskId: uuid('parent_task_id'),
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
    index('tasks_conversation_idx').on(table.userId, table.conversationId),
    index('tasks_parent_idx').on(table.userId, table.parentTaskId),
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
    capabilityDetails: jsonb('capability_details'),
    contextWindow: integer('context_window'),
    costMetadata: jsonb('cost_metadata'),
    enabled: boolean('enabled').default(true).notNull(),
    isRecommended: boolean('is_recommended').default(false).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    availabilityStatus: varchar('availability_status', { length: 32 }).default('available').notNull(),
    lastLatencyMs: integer('last_latency_ms'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    uniqueIndex('model_configs_provider_model_uq').on(table.providerId, table.model),
    index('model_configs_enabled_idx').on(table.enabled),
  ],
);

export const modelRoutingPolicies = pgTable(
  'model_routing_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mode: varchar('mode', { length: 32 }).notNull(),
    modelName: varchar('model_name', { length: 200 }),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('model_routing_policies_mode_uq').on(table.mode),
    index('model_routing_policies_mode_idx').on(table.mode),
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
    resourceId: varchar('resource_id', { length: 512 }),
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
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastOutcome: varchar('last_outcome', { length: 32 }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    uniqueIndex('skills_name_uq').on(table.name),
    index('skills_is_enabled_idx').on(table.isEnabled),
  ],
);

export const projectSkills = pgTable(
  'project_skills',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    skillName: varchar('skill_name', { length: 120 }).notNull(),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.skillName] }),
    index('project_skills_project_idx').on(table.projectId),
    index('project_skills_skill_name_idx').on(table.skillName),
  ],
);

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: varchar('id', { length: 120 }).primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    transport: varchar('transport', { length: 32 }).notNull(),
    command: varchar('command', { length: 255 }),
    args: jsonb('args'),
    url: varchar('url', { length: 500 }),
    allowedCapabilities: jsonb('allowed_capabilities').notNull(),
    riskLevel: varchar('risk_level', { length: 32 }).default('MEDIUM').notNull(),
    status: varchar('status', { length: 32 }).default('connected').notNull(),
    approvalId: uuid('approval_id').references(() => approvals.id, { onDelete: 'set null' }),
    isApproved: boolean('is_approved').default(false).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('mcp_servers_status_idx').on(table.status),
    index('mcp_servers_transport_idx').on(table.transport),
  ],
);

export const mcpCallLogs = pgTable(
  'mcp_call_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serverId: varchar('server_id', { length: 120 }).notNull(),
    toolName: varchar('tool_name', { length: 120 }).notNull(),
    arguments: jsonb('arguments'),
    durationMs: integer('duration_ms').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    error: text('error'),
    ...created,
  },
  (table) => [
    index('mcp_call_logs_server_tool_idx').on(table.serverId, table.toolName),
    index('mcp_call_logs_created_idx').on(table.createdAt),
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
    lastBrief: text('last_brief'),
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
export type SkillRow = typeof skills.$inferSelect;
export type ProjectSkillRow = typeof projectSkills.$inferSelect;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type McpCallLogRow = typeof mcpCallLogs.$inferSelect;
export type SkillRevisionRow = typeof skillRevisions.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
export type ModelConfigRow = typeof modelConfigs.$inferSelect;
export type ModelRoutingPolicyRow = typeof modelRoutingPolicies.$inferSelect;

export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    scope: text('scope').default('general').notNull(),
    language: varchar('language', { length: 16 }).default('id').notNull(),
    depth: varchar('depth', { length: 32 }).default('standard').notNull(),
    status: varchar('status', { length: 32 }).default('queued').notNull(),
    budgetConfig: jsonb('budget_config').notNull(),
    budgetUsed: jsonb('budget_used').default({}).notNull(),
    plan: jsonb('plan'),
    checkpoint: jsonb('checkpoint'),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('research_runs_user_idx').on(table.userId),
    index('research_runs_project_idx').on(table.projectId),
    index('research_runs_status_idx').on(table.status),
    index('research_runs_created_idx').on(table.createdAt),
  ],
);

export const researchSources = pgTable(
  'research_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    sourceId: varchar('source_id', { length: 32 }).notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    domain: varchar('domain', { length: 255 }).notNull(),
    credibilityScore: real('credibility_score').default(0.5).notNull(),
    fetchStatus: varchar('fetch_status', { length: 32 }).default('pending').notNull(),
    contentHash: varchar('content_hash', { length: 64 }),
    snippet: text('snippet'),
    ...created,
  },
  (table) => [
    index('research_sources_run_idx').on(table.runId),
    uniqueIndex('research_sources_run_source_uq').on(table.runId, table.sourceId),
  ],
);

export const researchEvidence = pgTable(
  'research_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    sourceId: varchar('source_id', { length: 32 }).notNull(),
    statement: text('statement').notNull(),
    claimType: varchar('claim_type', { length: 32 }).default('sourced_fact').notNull(),
    quote: text('quote'),
    confidence: real('confidence').default(0.8).notNull(),
    verified: boolean('verified').default(false).notNull(),
    ...created,
  },
  (table) => [
    index('research_evidence_run_idx').on(table.runId),
    index('research_evidence_source_idx').on(table.runId, table.sourceId),
  ],
);

export const researchReports = pgTable(
  'research_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    confidenceBySection: jsonb('confidence_by_section').default({}).notNull(),
    gaps: jsonb('gaps').default([]).notNull(),
    limitations: jsonb('limitations').default([]).notNull(),
    summary: text('summary').notNull(),
    ...created,
  },
  (table) => [
    uniqueIndex('research_reports_run_uq').on(table.runId),
  ],
);

export type ResearchRunRow = typeof researchRuns.$inferSelect;
export type ResearchSourceRow = typeof researchSources.$inferSelect;
export type ResearchEvidenceRow = typeof researchEvidence.$inferSelect;
export type ResearchReportRow = typeof researchReports.$inferSelect;

export const compareRuns = pgTable(
  'compare_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    blindMode: boolean('blind_mode').default(false).notNull(),
    status: varchar('status', { length: 32 }).default('running').notNull(),
    winnerModelId: varchar('winner_model_id', { length: 128 }),
    revealed: boolean('revealed').default(false).notNull(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
    synthesisStatus: varchar('synthesis_status', { length: 32 }).default('none').notNull(),
    synthesisModel: varchar('synthesis_model', { length: 128 }),
    synthesisContent: text('synthesis_content'),
    synthesisUsage: jsonb('synthesis_usage').default({}).notNull(),
    tokenBudget: integer('token_budget').default(4000).notNull(),
    totalTokensUsed: integer('total_tokens_used').default(0).notNull(),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('compare_runs_user_idx').on(table.userId),
    index('compare_runs_project_idx').on(table.projectId),
    index('compare_runs_status_idx').on(table.status),
    index('compare_runs_created_idx').on(table.createdAt),
  ],
);

export const compareResults = pgTable(
  'compare_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => compareRuns.id, { onDelete: 'cascade' }),
    modelId: varchar('model_id', { length: 128 }).notNull(),
    modelAlias: varchar('model_alias', { length: 32 }).notNull(),
    columnIndex: integer('column_index').notNull(),
    content: text('content').default('').notNull(),
    status: varchar('status', { length: 32 }).default('pending').notNull(),
    error: text('error'),
    latencyMs: integer('latency_ms'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    cost: real('cost'),
    isWinner: boolean('is_winner').default(false).notNull(),
    ...created,
  },
  (table) => [
    index('compare_results_run_idx').on(table.runId),
    uniqueIndex('compare_results_run_col_uq').on(table.runId, table.columnIndex),
  ],
);

export type CompareRunRow = typeof compareRuns.$inferSelect;
export type CompareResultRow = typeof compareResults.$inferSelect;

export const promptTemplates = pgTable(
  'prompt_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    variables: jsonb('variables').$type<string[]>().default([]).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...created,
  },
  (table) => [
    index('prompt_templates_user_idx').on(table.userId),
    uniqueIndex('prompt_templates_user_name_uq').on(table.userId, table.name),
  ],
);

export type PromptTemplateRow = typeof promptTemplates.$inferSelect;
export type NewPromptTemplateRow = typeof promptTemplates.$inferInsert;

export const skillProposals = pgTable(
  'skill_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    skillName: varchar('skill_name', { length: 120 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    proposedManifest: jsonb('proposed_manifest').notNull(),
    promptInstructions: text('prompt_instructions'),
    changeType: varchar('change_type', { length: 32 }).default('new_skill').notNull(),
    targetSkillName: varchar('target_skill_name', { length: 120 }),
    diff: text('diff'),
    status: varchar('status', { length: 32 }).default('pending').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    ...created,
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('skill_proposals_user_idx').on(table.userId),
    index('skill_proposals_status_idx').on(table.status),
    index('skill_proposals_skill_name_idx').on(table.skillName),
  ],
);

export type SkillProposalRow = typeof skillProposals.$inferSelect;
export type NewSkillProposalRow = typeof skillProposals.$inferInsert;

export const channelPairings = pgTable(
  'channel_pairings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 32 }).default('telegram').notNull(),
    channelChatId: varchar('channel_chat_id', { length: 128 }).notNull(),
    channelUsername: varchar('channel_username', { length: 128 }),
    status: varchar('status', { length: 32 }).default('active').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    pairedAt: timestamp('paired_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...created,
  },
  (table) => [
    index('channel_pairings_user_idx').on(table.userId),
    uniqueIndex('channel_pairings_channel_chat_uq').on(table.channel, table.channelChatId),
  ],
);

export type ChannelPairingRow = typeof channelPairings.$inferSelect;
export type NewChannelPairingRow = typeof channelPairings.$inferInsert;


