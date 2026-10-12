export type { TaskRecord, TaskEventEnvelope, TaskStatus } from '@personal-ai-os/shared';

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

export interface ArtifactItem {
  id: string;
  name: string;
  type: 'file' | 'code' | 'markdown' | 'report';
  sizeBytes?: number | undefined;
  url?: string | undefined;
  createdAt: string;
  taskId?: string | undefined;
}

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
}
