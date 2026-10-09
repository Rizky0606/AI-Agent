import type { ArtifactManager } from '../artifacts/artifact-manager.ts';
import type { ArtifactMetadata, ArtifactRetention } from '../artifacts/types.ts';
import type { ToolDefinition } from '../types.ts';

export interface SaveArtifactInput {
  filename: string;
  mimeType: string;
  content: string;
  retention?: ArtifactRetention | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export function createSaveArtifactTool(
  artifactManager: ArtifactManager,
): ToolDefinition<SaveArtifactInput, ArtifactMetadata> {
  return {
    name: 'save_artifact',
    description: 'Menyimpan teks atau data sebagai artefak terkelola di dalam penyimpanan artefak.',
    capability: 'artifacts:write',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'artifact:write',
    timeoutMs: 10000,
    supportsCancellation: true,
    outputLimitBytes: 16384,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { filename, mimeType, content }.' };
      }
      const rec = input as Record<string, unknown>;
      if (typeof rec.filename !== 'string' || rec.filename.trim().length === 0) {
        return { valid: false, error: 'Atribut "filename" harus berupa string non-kosong.' };
      }
      if (typeof rec.mimeType !== 'string' || rec.mimeType.trim().length === 0) {
        return { valid: false, error: 'Atribut "mimeType" harus berupa string non-kosong.' };
      }
      if (typeof rec.content !== 'string') {
        return { valid: false, error: 'Atribut "content" harus berupa string.' };
      }
      return { valid: true, data: input as SaveArtifactInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: SaveArtifactInput, context) => {
      return await artifactManager.createArtifact({
        ownerId: context.actor.id,
        projectId: context.projectId,
        taskId: context.taskId,
        conversationId: context.conversationId,
        filename: input.filename,
        mimeType: input.mimeType,
        content: input.content,
        retention: input.retention ?? 'project_lifetime',
        metadata: input.metadata,
      });
    },
  };
}
