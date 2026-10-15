import type {
  CapabilityProbeResult,
  ModelDescriptor,
  ModelGateway,
} from './types.ts';

export type ProbeCatalogOptions = {
  concurrency?: number | undefined;
  delayMs?: number | undefined;
  signal?: AbortSignal | undefined;
};

/**
 * Executes model capability probes across a catalog with bounded concurrency
 * and rate-limiting delays to prevent overwhelming the provider.
 * Unproven capabilities remain 'unknown', NEVER assumed 'true'.
 */
export async function probeCatalog(
  gateway: ModelGateway,
  models: readonly string[] | readonly ModelDescriptor[],
  options: ProbeCatalogOptions = {},
): Promise<Map<string, CapabilityProbeResult>> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 100);
  const results = new Map<string, CapabilityProbeResult>();

  const modelIds = models.map((m) => (typeof m === 'string' ? m : m.model));
  if (modelIds.length === 0) return results;

  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < modelIds.length) {
      if (options.signal?.aborted) break;
      const targetModel = modelIds[currentIndex++];
      if (!targetModel) continue;

      try {
        if (typeof gateway.probeModel === 'function') {
          const probeOpts = options.signal ? { signal: options.signal } : undefined;
          const res = await gateway.probeModel(targetModel, probeOpts);
          results.set(targetModel, res);
        } else {
          const now = new Date().toISOString();
          results.set(targetModel, {
            model: targetModel,
            capabilities: ['chat'],
            capabilityDetails: {
              chat: { capability: 'chat', status: 'declared', verifiedAt: now },
              streaming: {
                capability: 'streaming',
                status: 'unknown',
                error: 'Probe not supported on gateway',
              },
              tool_calling: {
                capability: 'tool_calling',
                status: 'unknown',
                error: 'Probe not supported on gateway',
              },
              vision: {
                capability: 'vision',
                status: 'unknown',
                error: 'Probe not supported on gateway',
              },
            },
            availabilityStatus: 'available',
            probedAt: now,
          });
        }
      } catch (err) {
        const now = new Date().toISOString();
        results.set(targetModel, {
          model: targetModel,
          capabilities: ['chat'],
          capabilityDetails: {
            chat: { capability: 'chat', status: 'declared', verifiedAt: now },
            streaming: {
              capability: 'streaming',
              status: 'unknown',
              error: err instanceof Error ? err.message : String(err),
            },
            tool_calling: {
              capability: 'tool_calling',
              status: 'unknown',
              error: err instanceof Error ? err.message : String(err),
            },
            vision: {
              capability: 'vision',
              status: 'unknown',
              error: err instanceof Error ? err.message : String(err),
            },
          },
          availabilityStatus: 'unavailable',
          probedAt: now,
        });
      }

      if (delayMs > 0 && currentIndex < modelIds.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const workerCount = Math.min(concurrency, modelIds.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}
