import { type TokenStorage, defaultTokenStorage } from '../storage/secure-store.ts';
import { deriveWsUrl, getInitialApiUrl, getInitialWsUrl } from './config.ts';
import { GOOGLE_REDIRECT_URI } from './pkce.ts';
import {
  type ApprovalRecord,
  type ArtifactItem,
  type ArtifactPreview,
  type AuthResponse,
  type ChatMessage,
  type Conversation,
  type Device,
  type HealthResponse,
  type ModelCatalogResponse,
  type Project,
  type RefreshResponse,
  type User,
} from './types.ts';
import type { TaskEventEnvelope, TaskRecord } from '@personal-ai-os/shared';

export interface ApiClientOptions {
  storage?: TokenStorage | undefined;
  baseUrl?: string | undefined;
  baseWsUrl?: string | undefined;
  onUnauthorized?: (() => void) | undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private readonly storage: TokenStorage;
  private baseUrl: string;
  private baseWsUrl: string;
  private readonly onUnauthorized?: (() => void) | undefined;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(options?: ApiClientOptions) {
    this.storage = options?.storage ?? defaultTokenStorage;
    this.baseUrl = options?.baseUrl ? options.baseUrl.replace(/\/+$/, '') : getInitialApiUrl();
    this.baseWsUrl = options?.baseWsUrl
      ? options.baseWsUrl.replace(/\/+$/, '')
      : options?.baseUrl
        ? deriveWsUrl(this.baseUrl)
        : getInitialWsUrl();
    this.onUnauthorized = options?.onUnauthorized;
  }

  setBaseUrl(url: string, wsUrl?: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
    this.baseWsUrl = wsUrl ? wsUrl.replace(/\/+$/, '') : deriveWsUrl(this.baseUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getBaseWsUrl(): string {
    return this.baseWsUrl;
  }

  getStorage(): TokenStorage {
    return this.storage;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const token = await this.storage.getAccessToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (token && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (
      response.status === 401 &&
      !isRetry &&
      !endpoint.includes('/auth/login') &&
      !endpoint.includes('/auth/refresh')
    ) {
      const refreshedToken = await this.handleTokenRefresh();
      if (refreshedToken) {
        return this.request<T>(endpoint, options, true);
      } else {
        if (this.onUnauthorized) this.onUnauthorized();
        throw new ApiError(401, 'UNAUTHORIZED', 'Session expired. Please log in again.');
      }
    }

    if (response.status === 204) {
      return undefined as T;
    }

    let body: { error?: { code?: string; message?: string } } | null = null;
    try {
      body = (await response.json()) as { error?: { code?: string; message?: string } };
    } catch {
      body = null;
    }

    if (!response.ok) {
      const errCode = body?.error?.code ?? response.statusText ?? 'UNKNOWN_ERROR';
      const errMsg = body?.error?.message ?? `Request failed with status ${response.status}`;
      throw new ApiError(response.status, errCode, errMsg);
    }

    return body as T;
  }

  private async handleTokenRefresh(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const refreshToken = await this.storage.getRefreshToken();
        if (!refreshToken) return null;

        const refreshRes = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!refreshRes.ok) {
          await this.storage.clearTokens();
          return null;
        }

        const data = (await refreshRes.json()) as RefreshResponse;
        await this.storage.setAccessToken(data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // --- Auth & User ---
  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await this.storage.setAccessToken(res.accessToken);
    await this.storage.setRefreshToken(res.refreshToken);
    return res;
  }

  googleStartUrl(codeChallenge: string, state: string): string {
    const redirectUri = encodeURIComponent(GOOGLE_REDIRECT_URI);
    return (
      `${this.baseUrl}/v1/auth/google/start?redirect_uri=${redirectUri}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}`
    );
  }

  async exchangeLoginCode(code: string, codeVerifier: string): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/v1/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, codeVerifier }),
    });
    await this.storage.setAccessToken(res.accessToken);
    await this.storage.setRefreshToken(res.refreshToken);
    return res;
  }

  async register(email: string, password: string): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await this.storage.setAccessToken(res.accessToken);
    await this.storage.setRefreshToken(res.refreshToken);
    return res;
  }

  async logout(): Promise<void> {
    const refreshToken = await this.storage.getRefreshToken();
    if (refreshToken) {
      try {
        await this.request<void>('/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // ignore logout network failure
      }
    }
    await this.storage.clearTokens();
  }

  async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/v1/me');
  }

  async registerDevice(
    name: string,
    platform: 'android' | 'windows' | 'web' = 'android',
  ): Promise<{ device: Device }> {
    const res = await this.request<{ device: Device }>('/v1/devices', {
      method: 'POST',
      body: JSON.stringify({ name, platform }),
    });
    if (res.device?.id) {
      await this.storage.setDeviceId(res.device.id);
    }
    return res;
  }

  /**
   * Attaches this install's FCM token to a device row the caller owns, so the server can push to it.
   */
  async registerPushToken(deviceId: string, pushToken: string): Promise<void> {
    await this.request<void>(`/v1/devices/${encodeURIComponent(deviceId)}/push-token`, {
      method: 'POST',
      body: JSON.stringify({ pushToken }),
    });
  }

  // --- Projects ---
  async listProjects(): Promise<{ projects: Project[] }> {
    return this.request<{ projects: Project[] }>('/v1/projects');
  }

  async getProject(projectId: string): Promise<{ project: Project }> {
    return this.request<{ project: Project }>(`/v1/projects/${projectId}`);
  }

  async createProject(
    name: string,
    description?: string | undefined,
  ): Promise<{ project: Project }> {
    return this.request<{ project: Project }>('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async listProjectConversations(projectId: string): Promise<{ conversations: Conversation[] }> {
    return this.request<{ conversations: Conversation[] }>(
      `/v1/projects/${projectId}/conversations`,
    );
  }

  async createProjectConversation(
    projectId: string,
    title?: string | undefined,
  ): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>(`/v1/projects/${projectId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  // --- Conversations & Messages ---
  async listConversations(): Promise<{ conversations: Conversation[] }> {
    return this.request<{ conversations: Conversation[] }>('/v1/conversations');
  }

  async getConversation(conversationId: string): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>(`/v1/conversations/${conversationId}`);
  }

  async updateConversation(
    conversationId: string,
    title: string,
  ): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>(`/v1/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    return this.request<void>(`/v1/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  }

  async listMessages(conversationId: string): Promise<{ messages: ChatMessage[] }> {
    return this.request<{ messages: ChatMessage[] }>(
      `/v1/conversations/${conversationId}/messages`,
    );
  }

  async postMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata?: Record<string, unknown> | undefined,
  ): Promise<{ message: ChatMessage }> {
    return this.request<{ message: ChatMessage }>(`/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role, content, metadata }),
    });
  }

  async listModels(): Promise<ModelCatalogResponse> {
    return this.request<ModelCatalogResponse>('/v1/models');
  }

  async refreshModels(): Promise<ModelCatalogResponse> {
    return this.request<ModelCatalogResponse>('/v1/models/refresh', { method: 'POST', body: '{}' });
  }
  async listArtifacts(projectId?: string): Promise<{ artifacts: ArtifactItem[] }> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const response = await this.request<{ data: ArtifactItem[] }>(`/v1/artifacts${query}`);
    return { artifacts: response.data };
  }

  async getArtifact(artifactId: string): Promise<{ artifact: ArtifactItem }> {
    const response = await this.request<{ data: ArtifactItem }>(`/v1/artifacts/${artifactId}`);
    return { artifact: response.data };
  }

  async previewArtifact(artifactId: string, maxBytes = 32_768): Promise<ArtifactPreview> {
    const token = await this.storage.getAccessToken();
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${this.baseUrl}/v1/artifacts/${encodeURIComponent(artifactId)}/download`, { headers });
    if (!response.ok) {
      throw new ApiError(response.status, 'ARTIFACT_PREVIEW_FAILED', `Preview failed (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { content: new TextDecoder().decode(bytes.slice(0, maxBytes)), truncated: bytes.byteLength > maxBytes };
  }

  // --- Tasks ---
  async listTasks(
    filters?: { projectId?: string | undefined; status?: string | undefined } | undefined,
  ): Promise<{ tasks: TaskRecord[] }> {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('projectId', filters.projectId);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ tasks: TaskRecord[] }>(`/v1/tasks${qs}`);
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${taskId}`);
  }

  async createTask(params: {
    projectId: string;
    kind: string;
    payload?: Record<string, unknown> | undefined;
    priority?: number | undefined;
    idempotencyKey?: string | undefined;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    return this.request<{ task: TaskRecord; isDuplicate: boolean }>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async pauseTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${taskId}/pause`, { method: 'POST' });
  }

  async resumeTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${taskId}/resume`, { method: 'POST' });
  }

  async cancelTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${taskId}/cancel`, { method: 'POST' });
  }

  async getTaskEvents(taskId: string): Promise<{ events: TaskEventEnvelope[] }> {
    return this.request<{ events: TaskEventEnvelope[] }>(`/v1/tasks/${taskId}/events`);
  }

  // --- Approvals ---
  async listApprovals(
    filters?: { status?: string | undefined; taskId?: string | undefined } | undefined,
  ): Promise<{ approvals: ApprovalRecord[] }> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.taskId) params.set('taskId', filters.taskId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ approvals: ApprovalRecord[] }>(`/v1/approvals${qs}`);
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord> {
    return this.request<ApprovalRecord>(`/v1/approvals/${approvalId}`);
  }

  async approve(
    approvalId: string,
    reason?: string | undefined,
  ): Promise<{ approval: ApprovalRecord }> {
    return this.request<{ approval: ApprovalRecord }>(`/v1/approvals/${approvalId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async deny(
    approvalId: string,
    reason?: string | undefined,
  ): Promise<{ approval: ApprovalRecord }> {
    return this.request<{ approval: ApprovalRecord }>(`/v1/approvals/${approvalId}/deny`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // --- Health ---
  async checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }
}

export const defaultApiClient = new ApiClient();
