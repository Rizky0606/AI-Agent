import type {
  CompareRunDetail,
  CompareRunSummary,
  CreateCompareRequest,
  PromoteCompareResponse,
  ResearchBudgetConfig,
  ResearchDepth,
  ResearchEvidenceItem,
  ResearchReportData,
  ResearchRunSummary,
  ResearchSourceItem,
  ResearchSubQuestionState,
  TaskEventEnvelope,
  TaskRecord,
} from '@personal-ai-os/shared';

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
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}
export interface WindowsChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  cancelled?: boolean | undefined;
  parentMessageId?: string | null | undefined;
  isActiveBranch?: boolean | undefined;
  branchIndex?: number | undefined;
  branchCount?: number | undefined;
  siblingMessageIds?: string[] | undefined;
}
export interface WindowsConversation {
  id: string;
  title: string | null;
  projectId: string;
  createdAt: string;
  compactedSummary?: string | null | undefined;
}

export interface PromptTemplateRecord {
  id: string;
  userId: string;
  name: string;
  title?: string | null;
  content: string;
  description?: string | null;
  variables: string[];
  createdAt: string;
  updatedAt: string;
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
    filters?: { projectId?: string | undefined; status?: string | undefined; conversationId?: string | undefined } | undefined,
  ): Promise<{ tasks: TaskRecord[] }> {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('projectId', filters.projectId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.conversationId) params.set('conversationId', filters.conversationId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ tasks: TaskRecord[] }>(`/v1/tasks${qs}`);
  }

  async createTask(params: {
    projectId: string;
    kind: string;
    payload?: Record<string, unknown> | undefined;
    conversationId?: string | undefined;
    priority?: number | undefined;
    idempotencyKey?: string | undefined;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    return this.request<{ task: TaskRecord; isDuplicate: boolean }>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(params),
    });
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

  // --- User Preferences ---
  async getUserPreferences(): Promise<UserPreferences> {
    return this.request<UserPreferences>('/v1/users/me/preferences');
  }

  async updateUserPreferences(prefs: {
    defaultModel?: string | null | undefined;
    defaultMode?: string | undefined;
  }): Promise<UserPreferences> {
    return this.request<UserPreferences>('/v1/users/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    });
  }

  // --- Conversations ---
  async listConversations(projectId?: string): Promise<{ conversations: WindowsConversation[] }> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return this.request<{ conversations: WindowsConversation[] }>(`/v1/conversations${query}`);
  }

  async updateConversation(
    conversationId: string,
    updates: {
      title?: string | undefined;
      model?: string | null | undefined;
      mode?: string | undefined;
    },
  ): Promise<WindowsConversation> {
    return this.request<WindowsConversation>(`/v1/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async listMessages(conversationId: string): Promise<{ messages: WindowsChatMessage[] }> {
    return this.request<{ messages: WindowsChatMessage[] }>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  // --- Prompt Templates (Sesi 27) ---
  async listPromptTemplates(): Promise<{ templates: PromptTemplateRecord[] }> {
    return this.request<{ templates: PromptTemplateRecord[] }>('/v1/prompt-templates');
  }

  async createPromptTemplate(payload: {
    name: string;
    title?: string;
    content: string;
    description?: string;
  }): Promise<{ template: PromptTemplateRecord }> {
    return this.request<{ template: PromptTemplateRecord }>('/v1/prompt-templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updatePromptTemplate(
    id: string,
    payload: {
      name?: string;
      title?: string;
      content?: string;
      description?: string;
    },
  ): Promise<{ template: PromptTemplateRecord }> {
    return this.request<{ template: PromptTemplateRecord }>(`/v1/prompt-templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deletePromptTemplate(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/v1/prompt-templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // --- Session Tree & Branching (Sesi 27) ---
  async switchMessageBranch(
    conversationId: string,
    messageId: string,
  ): Promise<{ messages: WindowsChatMessage[] }> {
    return this.request<{ messages: WindowsChatMessage[] }>(
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/switch`,
      { method: 'POST' },
    );
  }

  async deleteMessageBranch(
    conversationId: string,
    messageId: string,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    );
  }

  async exportConversation(
    conversationId: string,
    format: 'markdown' | 'html',
  ): Promise<{ format: string; filename: string; content: string }> {
    return this.request<{ format: string; filename: string; content: string }>(
      `/v1/conversations/${encodeURIComponent(conversationId)}/export?format=${encodeURIComponent(format)}`,
    );
  }

  async compactConversation(
    conversationId: string,
  ): Promise<{
    compacted: boolean;
    reason?: string;
    compactedSummary?: string;
    compactedMessageCount?: number;
  }> {
    return this.request<{
      compacted: boolean;
      reason?: string;
      compactedSummary?: string;
      compactedMessageCount?: number;
    }>(`/v1/conversations/${encodeURIComponent(conversationId)}/compact`, {
      method: 'POST',
    });
  }

  // --- Memories ---
  async listMemories(params?: { projectId?: string | undefined; type?: string | undefined; scope?: string | undefined }): Promise<{ data: MemoryItem[] }> {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.type) q.set('type', params.type);
    if (params?.scope) q.set('scope', params.scope);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request<{ data: MemoryItem[] }>(`/v1/memories${qs}`);
  }

  async searchMemories(query: string, projectId?: string | undefined): Promise<MemorySearchResult> {
    const q = new URLSearchParams({ query });
    if (projectId) q.set('projectId', projectId);
    return this.request<MemorySearchResult>(`/v1/memories/search?${q.toString()}`);
  }

  async createMemory(payload: {
    content: string;
    type: string;
    scope?: string | undefined;
    projectId?: string | undefined;
  }): Promise<{ data: MemoryItem }> {
    return this.request<{ data: MemoryItem }>('/v1/memories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateMemory(id: string, content: string): Promise<{ data: MemoryItem }> {
    return this.request<{ data: MemoryItem }>(`/v1/memories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMemory(id: string): Promise<void> {
    await this.request<void>(`/v1/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listMemoryProposals(projectId?: string | undefined): Promise<{ data: MemoryItem[] }> {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return this.request<{ data: MemoryItem[] }>(`/v1/memories/proposals${qs}`);
  }

  async approveMemoryProposal(id: string): Promise<{ data: MemoryItem; status: string }> {
    return this.request<{ data: MemoryItem; status: string }>(`/v1/memories/proposals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  async rejectMemoryProposal(id: string): Promise<{ success: boolean; status: string }> {
    return this.request<{ success: boolean; status: string }>(`/v1/memories/proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  }

  async listRuntimes(): Promise<{ runtimes: RuntimeDescriptor[] }> {
    return this.request<{ runtimes: RuntimeDescriptor[] }>('/v1/runtimes');
  }

  // --- Skills ---
  async listSkills(params?: { isEnabled?: boolean }): Promise<{ skills: SkillItem[] }> {
    const qs = params?.isEnabled !== undefined ? `?isEnabled=${params.isEnabled}` : '';
    return this.request<{ skills: SkillItem[] }>(`/v1/skills${qs}`);
  }

  async getSkillManifest(name: string): Promise<{ manifest: Record<string, unknown> }> {
    return this.request<{ manifest: Record<string, unknown> }>(`/v1/skills/${encodeURIComponent(name)}/manifest`);
  }

  async listProjectSkills(projectId: string): Promise<{ skills: SkillItem[] }> {
    return this.request<{ skills: SkillItem[] }>(`/v1/projects/${encodeURIComponent(projectId)}/skills`);
  }

  async toggleProjectSkill(
    projectId: string,
    skillName: string,
    isEnabled: boolean,
  ): Promise<{ success: boolean; skillName: string; isEnabled: boolean }> {
    return this.request<{ success: boolean; skillName: string; isEnabled: boolean }>(
      `/v1/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(skillName)}/toggle`,
      {
        method: 'POST',
        body: JSON.stringify({ isEnabled }),
      },
    );
  }

  // --- MCP ---
  async listMcpServers(): Promise<{ servers: McpServerItem[] }> {
    return this.request<{ servers: McpServerItem[] }>('/v1/mcp/servers');
  }

  async addMcpServer(payload: {
    id: string;
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    allowedCapabilities: string[];
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): Promise<{ server: McpServerItem }> {
    return this.request<{ server: McpServerItem }>('/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteMcpServer(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/v1/mcp/servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listMcpLogs(params?: { serverId?: string | undefined; limit?: number | undefined }): Promise<{ logs: McpCallLogItem[] }> {
    const q = new URLSearchParams();
    if (params?.serverId) q.set('serverId', params.serverId);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request<{ logs: McpCallLogItem[] }>(`/v1/mcp/logs${qs}`);
  }

  async getResearchConfig(): Promise<{ budgets: Record<ResearchDepth, ResearchBudgetConfig> }> {
    return this.request<{ budgets: Record<ResearchDepth, ResearchBudgetConfig> }>('/v1/research/config');
  }

  async createResearch(params: {
    projectId: string;
    query: string;
    scope?: string | undefined;
    language?: string | undefined;
    depth?: ResearchDepth | undefined;
    customBudget?: Partial<ResearchBudgetConfig> | undefined;
    requirePlanApproval?: boolean | undefined;
  }): Promise<{ run: ResearchRunSummary }> {
    return this.request<{ run: ResearchRunSummary }>('/v1/research', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getResearch(id: string): Promise<{
    run: ResearchRunSummary;
    sources: ResearchSourceItem[];
    evidence: ResearchEvidenceItem[];
    report: ResearchReportData | null;
  }> {
    return this.request<{
      run: ResearchRunSummary;
      sources: ResearchSourceItem[];
      evidence: ResearchEvidenceItem[];
      report: ResearchReportData | null;
    }>(`/v1/research/${encodeURIComponent(id)}`);
  }

  async listResearch(params?: {
    projectId?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<{ runs: ResearchRunSummary[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request<{ runs: ResearchRunSummary[]; total: number }>(`/v1/research${qs}`);
  }

  async cancelResearch(id: string): Promise<{ success: boolean; run: ResearchRunSummary }> {
    return this.request<{ success: boolean; run: ResearchRunSummary }>(
      `/v1/research/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
    );
  }

  async approveResearchPlan(
    id: string,
    plan?: { subQuestions?: ResearchSubQuestionState[] } | undefined,
  ): Promise<{ success: boolean; run: ResearchRunSummary }> {
    return this.request<{ success: boolean; run: ResearchRunSummary }>(
      `/v1/research/${encodeURIComponent(id)}/approve-plan`,
      {
        method: 'POST',
        body: JSON.stringify({ plan }),
      },
    );
  }

  async deleteResearch(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/v1/research/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // --- Compare Multi-Model (Sesi 26) ---
  async createCompare(payload: CreateCompareRequest): Promise<CompareRunSummary> {
    return this.request<CompareRunSummary>('/v1/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getCompare(id: string): Promise<CompareRunDetail> {
    return this.request<CompareRunDetail>(`/v1/compare/${encodeURIComponent(id)}`);
  }

  async listCompares(): Promise<CompareRunSummary[]> {
    const res = await this.request<{ items: CompareRunSummary[] }>('/v1/compare');
    return res.items ?? [];
  }

  async revealCompare(id: string): Promise<CompareRunDetail> {
    return this.request<CompareRunDetail>(`/v1/compare/${encodeURIComponent(id)}/reveal`, {
      method: 'POST',
    });
  }

  async selectCompareWinner(id: string, winnerModelId: string): Promise<CompareRunDetail> {
    return this.request<CompareRunDetail>(`/v1/compare/${encodeURIComponent(id)}/winner`, {
      method: 'POST',
      body: JSON.stringify({ winnerModelId }),
    });
  }

  async synthesizeCompare(id: string, synthesisModelId?: string): Promise<CompareRunDetail> {
    return this.request<CompareRunDetail>(`/v1/compare/${encodeURIComponent(id)}/synthesize`, {
      method: 'POST',
      body: JSON.stringify(synthesisModelId ? { synthesisModelId } : {}),
    });
  }

  async promoteCompare(
    id: string,
    options?: { target?: 'new' | 'existing'; conversationId?: string },
  ): Promise<PromoteCompareResponse> {
    return this.request<PromoteCompareResponse>(`/v1/compare/${encodeURIComponent(id)}/promote`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    });
  }

  async deleteCompare(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/v1/compare/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

export type RuntimeId = 'auto' | 'omp' | 'hermes' | 'native';

export interface RuntimeDescriptor {
  id: 'omp' | 'hermes' | 'native';
  name: string;
  version: string;
  status: 'ready' | 'offline';
  healthText: string;
  capabilities: string[];
}

export interface SkillPermission {
  action: string;
  resource: string;
  scope: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason: string;
}

export interface SkillItem {
  id: string;
  name: string;
  version: string;
  description: string;
  source: 'builtin' | 'workspace' | 'remote' | 'hermes';
  isEnabled: boolean;
  isReadOnly?: boolean;
  isProjectOverride?: boolean;
  requestedPermissions: SkillPermission[];
  lastUsedAt?: string | null;
  lastOutcome?: 'success' | 'failure' | null;
  lastError?: string | null;
  manifest?: Record<string, unknown>;
}

export interface McpServerItem {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  allowedCapabilities: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'connected' | 'disconnected' | 'error';
  lastConnectedAt?: string | null;
  lastError?: string | null;
  tools?: Array<{
    name: string;
    description: string;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
}

export interface McpCallLogItem {
  id: string;
  serverId: string;
  toolName: string;
  userId?: string | null;
  projectId?: string | null;
  status: 'success' | 'failure' | 'denied';
  durationMs?: number | null;
  error?: string | null;
  createdAt: string;
}

