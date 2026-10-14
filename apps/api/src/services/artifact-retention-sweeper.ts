import type { TaskStatus } from '@personal-ai-os/shared';
import type { ArtifactManager } from '@personal-ai-os/tools';

/** Statuses after which a task never runs again, so its artifacts can be reclaimed. */
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'cancelled']);

/** Default lifetime of an `ephemeral` artifact. */
export const DEFAULT_EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ArtifactRetentionSweepDeps {
  artifactManager: Pick<ArtifactManager, 'listAllArtifacts' | 'deleteArtifact'>;
  /** Resolves a task's status for its owner; `null` when the task row no longer exists. */
  getTaskStatus: (ownerId: string, taskId: string) => Promise<TaskStatus | null>;
  /** Whether the owning project still exists. */
  projectExists: (ownerId: string, projectId: string) => Promise<boolean>;
  /** Injected clock, so expiry is testable without waiting. */
  now?: number | undefined;
  /** How long an `ephemeral` artifact lives. */
  ephemeralTtlMs?: number | undefined;
}

export interface ArtifactRetentionSweepResult {
  scanned: number;
  deleted: number;
  /** Artifacts whose deletion failed; retried on the next sweep. */
  failed: string[];
}

/**
 * Deletes every artifact whose retention policy has expired:
 * `ephemeral` past its TTL, `task_duration` once its task is terminal (or gone),
 * `project_lifetime` once its project is gone. `permanent` artifacts are never deleted.
 */
export async function sweepExpiredArtifacts(
  deps: ArtifactRetentionSweepDeps,
): Promise<ArtifactRetentionSweepResult> {
  const now = deps.now ?? Date.now();
  const ephemeralTtlMs = deps.ephemeralTtlMs ?? DEFAULT_EPHEMERAL_TTL_MS;
  const artifacts = await deps.artifactManager.listAllArtifacts();
  const failed: string[] = [];
  let deleted = 0;

  for (const artifact of artifacts) {
    switch (artifact.retention) {
      case 'permanent':
        continue;
      case 'ephemeral':
        if (now < Date.parse(artifact.createdAt) + ephemeralTtlMs) continue;
        break;
      case 'task_duration': {
        if (!artifact.taskId) continue;
        const status = await deps.getTaskStatus(artifact.ownerId, artifact.taskId);
        if (status && !TERMINAL_TASK_STATUSES.has(status)) continue;
        break;
      }
      case 'project_lifetime': {
        if (!artifact.projectId) continue;
        if (await deps.projectExists(artifact.ownerId, artifact.projectId)) continue;
        break;
      }
    }

    try {
      await deps.artifactManager.deleteArtifact(artifact.id, artifact.ownerId);
      deleted += 1;
    } catch (err: unknown) {
      failed.push(artifact.id);
      console.error(
        JSON.stringify({
          service: 'api',
          event: 'artifact_retention_delete_failed',
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return { scanned: artifacts.length, deleted, failed };
}
