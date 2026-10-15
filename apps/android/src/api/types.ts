export type { TaskRecord, TaskEventEnvelope, TaskStatus } from '@personal-ai-os/shared';
import type { TaskRecord } from '@personal-ai-os/shared';
export type TaskItem = TaskRecord;

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

