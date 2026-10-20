import type { TaskRecord, TaskRepository } from '@personal-ai-os/shared';

export interface SubagentPlanItem {
  /** Identifier unik langkah di dalam plan (misal: "child-inspect", "child-backend") */
  id: string;
  name: string;
  goal: string;
  kind: 'coding' | 'research' | 'generic';
  /** Daftar kemampuan/tools yang diizinkan untuk child task ini (least privilege) */
  capabilityAllowlist: string[];
  assignedRuntime?: string | undefined;
  workspace?: string | undefined;
  timeoutMs?: number | undefined;
  /** Daftar ID child tasks prasyarat yang harus selesai sukses terlebih dahulu */
  dependsOn?: string[] | undefined;
  /** Apakah child task ini wajib sukses agar parent sukses (default: true) */
  required?: boolean | undefined;
  /** Payload spesifik tugas (misal filesToModify, instructions, dll.) */
  payload?: Record<string, unknown> | undefined;
}

export interface ParentTaskPayload {
  objective: string;
  successCriteria: string[];
  childPlan: SubagentPlanItem[];
  maxDelegationDepth?: number | undefined; // default: 1
  currentDepth?: number | undefined; // default: 0 untuk parent utama
  maxChildren?: number | undefined; // default: 5
  concurrencyLimit?: number | undefined; // default: 2 (konservatif VPS 2 OCPU)
  timeoutMs?: number | undefined;
  maxTokens?: number | undefined;
  maxCostUsd?: number | undefined;
  workspaceRoot?: string | undefined;
  secrets?: Record<string, string> | undefined; // Secret parent yang TIDAK boleh bocor ke child
  userProfile?: Record<string, unknown> | undefined; // Memory personal yang tidak boleh dibocorkan
}

export interface SubagentExecutionResult {
  childTaskId: string;
  planItemId: string;
  kind: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string | undefined;
  artifacts?: Array<{ id: string; title: string; content?: string }> | undefined;
  error?: string | undefined;
  isolatedWorkspace?: string | undefined;
  startedAt?: Date | null | undefined;
  finishedAt?: Date | null | undefined;
}

export interface ParentOrchestrationSummary {
  parentTaskId: string;
  status: 'completed' | 'partial_failure' | 'failed' | 'cancelled';
  totalChildren: number;
  completedChildren: number;
  failedChildren: number;
  cancelledChildren: number;
  childrenResults: SubagentExecutionResult[];
  /** Ringkasan teks child dianggap tidak tepercaya dan dicatat secara terpisah */
  untrustedSummaries: Array<{ childTaskId: string; summary: string }>;
  verifiedArtifactsCount: number;
  evaluationPassed: boolean;
  notes?: string | undefined;
  mergedDiffAvailable?: boolean | undefined;
}

export interface TaskQueueEnqueuerLike {
  enqueue(task: TaskRecord): Promise<void>;
  cancel?(taskId: string): Promise<void>;
}

export interface SubagentOrchestratorConfig {
  taskRepo: TaskRepository;
  taskQueue?: TaskQueueEnqueuerLike | undefined;
  broadcaster?: {
    publish(event: {
      id: string;
      taskId: string;
      userId: string;
      eventType: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }): unknown;
  } | undefined;
  codingWorkspaceRoot?: string | undefined;
  defaultMaxDepth?: number | undefined; // default: 1
  defaultMaxChildren?: number | undefined; // default: 5
  defaultConcurrency?: number | undefined; // default: 2 (VPS 2 OCPU / 12 GB)
}
