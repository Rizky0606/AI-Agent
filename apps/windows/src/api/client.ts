import type { TaskEventEnvelope, TaskRecord } from '@personal-ai-os/shared';

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string | null | undefined;
}

export interface ApprovalRecord {
  id: string;
  userId: string;
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
  action: string;
  resource: string;
  scope: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  consequence: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decisionReason?: string | null | undefined;
  fingerprint: string;
  expiresAt: string;
  decidedAt?: string | null | undefined;
  createdAt: string;
}

export interface ArtifactItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  checksum?: string | undefined;
  version?: number | undefined;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  createdAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface ArtifactPreview {
  content: string;
  truncated: boolean;
}

export interface ModelDescriptor {
  id: string;
  provider: string;
  capabilities: string[];
  contextWindow?: number | undefined;
  costMetadata?: Record<string, unknown> | undefined;
}

export interface ModelCatalogResponse {
  source: 'live' | 'persisted';
  models: ModelDescriptor[];
}
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}
export interface WindowsChatMessage { id: string; conversationId: string; role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, unknown>; createdAt: string; cancelled?: boolean; }
export interface WindowsConversation { id: string; title: string | null; projectId: string; createdAt: string; }


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

export interface ApiClientOptions {
  baseUrl: () => string;
  token: () => string;
  /**
   * Renews the session after a 401 and returns the new access token, or null when the session
   * cannot be renewed (manual token, rejected refresh token). Called at most once per request.
   */
  refresh?: (() => Promise<string | null>) | undefined;
  fetchFn?: typeof fetch | undefined;
}

export const deriveWsUrl = (httpUrl: string): string =>
  httpUrl.replace(/\/+$/, '').replace(/^http(s?):/i, 'ws$1:');

export class ApiClient {
  private readonly options: ApiClientOptions;

  constructor(options: ApiClientOptions) {
    this.options = options;
  }

  get baseUrl(): string {
    return this.options.baseUrl().replace(/\/+$/, '');
  }

  get baseWsUrl(): string {
    return deriveWsUrl(this.options.baseUrl());
  }

  get token(): string {
    return this.options.token();
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const token = this.options.token();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetchFn(`${this.baseUrl}${path}`, { ...init, headers });

    // One refresh-and-retry on 401; `retry=false` on the second pass keeps this from looping.
    if (response.status === 401 && retry && this.options.refresh) {
      const refreshed = await this.options.refresh();
      if (refreshed) return this.request<T>(path, init, false);
    }

    if (response.status === 204) return undefined as T;

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(
        response.status,
        error?.code ?? response.statusText ?? 'UNKNOWN_ERROR',
        error?.message ?? `Request failed with status ${response.status}`,
      );
    }

    return body as T;
  }

  // --- Auth ---
  async exchangeLoginCode(code: string, codeVerifier: string): Promise<AuthSession> {
    return this.request<AuthSession>('/v1/auth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, codeVerifier }),
    });
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    return this.request<AuthSession>(
      '/v1/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      false,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    return this.request<void>(
      '/v1/auth/logout',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      false,
    );
  }

  // --- Projects ---
  async listProjects(): Promise<{ projects: ProjectRecord[] }> {
    return this.request<{ projects: ProjectRecord[] }>('/v1/projects');
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
    return this.request<TaskRecord>(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  async getTaskEvents(taskId: string): Promise<{ events: TaskEventEnvelope[] }> {
    return this.request<{ events: TaskEventEnvelope[] }>(
      `/v1/tasks/${encodeURIComponent(taskId)}/events`,
    );
  }

  async pauseTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${encodeURIComponent(taskId)}/pause`, {
      method: 'POST',
      body: '{}',
    });
  }

  async resumeTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${encodeURIComponent(taskId)}/resume`, {
      method: 'POST',
      body: '{}',
    });
  }

  async cancelTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      body: '{}',
    });
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

  async decideApproval(
    approvalId: string,
    decision: 'approve' | 'deny',
    reason?: string | undefined,
  ): Promise<{ approval: ApprovalRecord }> {
    return this.request<{ approval: ApprovalRecord }>(
      `/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  // --- Artifacts ---
  async listArtifacts(projectId?: string | undefined): Promise<{ artifacts: ArtifactItem[] }> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const response = await this.request<{ data: ArtifactItem[] }>(`/v1/artifacts${query}`);
    return { artifacts: response.data };
  }

  async previewArtifact(artifactId: string, maxBytes = 32_768): Promise<ArtifactPreview> {
    const response = await this.fetchArtifact(artifactId);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      content: new TextDecoder().decode(bytes.slice(0, maxBytes)),
      truncated: bytes.byteLength > maxBytes,
    };
  }

  async downloadArtifact(artifactId: string): Promise<Blob> {
    const response = await this.fetchArtifact(artifactId);
    return response.blob();
  }

  private async fetchArtifact(artifactId: string, retry = true): Promise<Response> {
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const token = this.options.token();
    const response = await fetchFn(
      `${this.baseUrl}/v1/artifacts/${encodeURIComponent(artifactId)}/download`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (response.status === 401 && retry && this.options.refresh) {
      const refreshed = await this.options.refresh();
      if (refreshed) return this.fetchArtifact(artifactId, false);
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        'ARTIFACT_FETCH_FAILED',
        `Artifact fetch failed (${response.status})`,
      );
    }
    return response;
  }

  // --- Models ---
  async listModels(): Promise<ModelCatalogResponse> {
    return this.request<ModelCatalogResponse>('/v1/models');
  }
  async listConversations(projectId?: string): Promise<{ conversations: WindowsConversation[] }> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return this.request<{ conversations: WindowsConversation[] }>(`/v1/conversations${query}`);
  }

  async listMessages(conversationId: string): Promise<{ messages: WindowsChatMessage[] }> {
    return this.request<{ messages: WindowsChatMessage[] }>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
  }
}
