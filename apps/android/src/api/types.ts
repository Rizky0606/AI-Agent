import type { TaskRecord, TaskEventEnvelope, TaskStatus } from '@personal-ai-os/shared';
export type { TaskRecord, TaskEventEnvelope, TaskStatus };
export type TaskItem = TaskRecord;

export type RuntimeId = 'auto' | 'omp' | 'hermes' | 'native';

export interface RuntimeDescriptor {
  id: 'omp' | 'hermes' | 'native';
  name: string;
  version: string;
  status: 'ready' | 'offline';
  healthText: string;
  capabilities: string[];
}

export interface User {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface Device {
  id: string;
  name: string;
  platform: 'android' | 'windows' | 'web';
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  compactedSummary?: string | null | undefined;
}

export interface MessageAttachment {
  type: 'image' | 'file';
  url: string;
  mimeType: string;
  name?: string | undefined;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[] | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  cancelled?: boolean | undefined;
  parentMessageId?: string | null | undefined;
  isActiveBranch?: boolean | undefined;
  branchIndex?: number | undefined;
  branchCount?: number | undefined;
  siblingMessageIds?: string[] | undefined;
}

export interface PromptTemplate {
  id: string;
  userId: string;
  name: string;
  title?: string | null | undefined;
  content: string;
  description?: string | null | undefined;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ApprovalRecord {
  id: string;
  userId: string;
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  consequence: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decisionReason?: string | null | undefined;
  approverId?: string | null | undefined;
  fingerprint: string;
  expiresAt: string;
  decidedAt?: string | null | undefined;
  createdAt: string;
}

export type ApprovalRequest = ApprovalRecord;

export interface ArtifactItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  checksum?: string | undefined;
  version?: number | undefined;
  projectId?: string | null | undefined;
  conversationId?: string | null | undefined;
  taskId?: string | null | undefined;
  createdAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface ArtifactPreview {
  content: string;
  truncated: boolean;
}

/** Body of `GET /ready`, the endpoint that actually reports dependency health. */
export interface ReadyResponse {
  status: 'ready' | 'not_ready';
  checks: {
    database: boolean;
    redis: boolean;
  };
}

export interface HealthResponse {
  status: 'ready' | 'not_ready';
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
}

export type ChatMode = 'auto' | 'fast' | 'coding' | 'complex' | 'research';

export interface CapabilityDetail {
  status: 'probed' | 'declared' | 'unknown';
  latencyMs?: number | undefined;
  verifiedAt?: string | undefined;
}

export interface ModelDescriptor {
  id: string;
  name?: string | undefined;
  provider: string;
  capabilities: string[];
  capabilityDetails?: Record<string, CapabilityDetail> | undefined;
  contextWindow?: number | undefined;
  costMetadata?: Record<string, unknown> | undefined;
  isRecommended?: boolean | undefined;
  isDefault?: boolean | undefined;
  availabilityStatus?: 'available' | 'degraded' | 'unavailable' | undefined;
  lastLatencyMs?: number | null | undefined;
}

export interface UserPreferences {
  defaultModel: string | null;
  defaultMode: 'fast' | 'coding' | 'complex' | 'research';
}

export interface ModelCatalogResponse {
  source: 'live' | 'persisted';
  models: ModelDescriptor[];
}

export interface MemoryItem {
  id: string;
  userId: string;
  projectId?: string | null | undefined;
  type: 'preference' | 'decision' | 'knowledge' | 'session' | 'project' | 'task';
  content: string;
  scope: string;
  provenance: string;
  retention: string;
  metadata?: Record<string, unknown> | undefined;
  isProposal?: boolean | undefined;
  status?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult {
  data: Array<{
    memory: MemoryItem;
    score: number;
    searchMode?: 'semantic' | 'text_fallback' | undefined;
  }>;
  semanticSearchActive: boolean;
  searchMode: 'semantic' | 'text_fallback';
  status: 'active' | 'inactive';
  notice?: string | undefined;
}

export interface ScheduleJobRecord {
  id: string;
  userId: string;
  projectId?: string | null | undefined;
  name: string;
  type: 'one_off' | 'recurring';
  runAt?: string | null | undefined;
  cronExpression?: string | null | undefined;
  timezone: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  missedRunPolicy: 'skip' | 'run_once' | 'catch_up';
  taskPayload: {
    kind: string;
    input: Record<string, unknown>;
    priority?: number | undefined;
  };
  lastRunAt?: string | null | undefined;
  nextRunAt?: string | null | undefined;
  lastBrief?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  name: string;
  type: 'one_off' | 'recurring';
  projectId?: string | undefined;
  runAt?: string | undefined;
  cronExpression?: string | undefined;
  timezone?: string | undefined;
  missedRunPolicy?: 'skip' | 'run_once' | 'catch_up' | undefined;
  taskPayload: {
    kind: string;
    input: Record<string, unknown>;
    priority?: number | undefined;
  };
}

export interface SkillProposalRecord {
  id: string;
  userId: string;
  taskId?: string | null | undefined;
  skillName: string;
  title: string;
  description: string;
  proposedManifest: Record<string, unknown>;
  promptInstructions?: string | null | undefined;
  changeType: 'new_skill' | 'improvement';
  targetSkillName?: string | null | undefined;
  diff?: string | null | undefined;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillProposalInput {
  skillName: string;
  title: string;
  description: string;
  proposedManifest: Record<string, unknown>;
  promptInstructions?: string | undefined;
  changeType?: 'new_skill' | 'improvement' | undefined;
  targetSkillName?: string | undefined;
  taskId?: string | undefined;
}


