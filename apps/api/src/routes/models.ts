import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ActiveModelRecord, ModelConfigRepository } from '../db/model-config-repository.ts';
import type { ModelGateway, ModelDescriptor, ModelCapability } from '@personal-ai-os/model-gateway';
import { probeCatalog } from '@personal-ai-os/model-gateway';
import type { AuditRepository } from '../db/audit-repository.ts';

export type ModelRouteDependencies = {
  auth: AuthService;
  modelConfigs: ModelConfigRepository;
  gateway: ModelGateway;
  providerBaseUrl: string;
  audit?: AuditRepository | undefined;
};

const authenticate = async (request: FastifyRequest, auth: AuthService) => {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AuthError('UNAUTHENTICATED', 'authentication required');
  return auth.authenticate(header.slice(7).trim());
};

const formatDescriptor = (model: ActiveModelRecord, userDefaultModel?: string | null) => ({
  id: model.model,
  provider: model.providerName,
  capabilities: model.capabilities,
  capabilityDetails: model.capabilityDetails,
  contextWindow: model.contextWindow,
  costMetadata: model.costMetadata,
  isRecommended: model.isRecommended ?? false,
  isDefault: userDefaultModel ? model.model === userDefaultModel : (model.isDefault ?? false),
  availabilityStatus: model.availabilityStatus ?? 'available',
  lastLatencyMs: model.lastLatencyMs,
  lastVerifiedAt: model.lastVerifiedAt ? model.lastVerifiedAt.toISOString() : undefined,
});

const catalogError = (request: FastifyRequest) => ({
  error: {
    code: 'MODEL_CATALOG_UNAVAILABLE',
    message: 'No active models available',
    requestId: request.id,
  },
});

export const registerModelRoutes = (app: FastifyInstance, deps: ModelRouteDependencies): void => {
  // 1. GET /v1/models - Enriched catalog with verified capabilities, contextWindow, recommended/isDefault, availability, latency
  app.get('/v1/models', async (request, reply) => {
    const user = await authenticate(request, deps.auth);
    const persisted = await deps.modelConfigs.listActiveModels();

    if (persisted.length === 0) {
      try {
        const live = await deps.gateway.listModels();
        if (live.length > 0) {
          return reply.send({
            source: 'live',
            models: live.map((m) => ({
              id: m.model,
              provider: m.provider,
              capabilities: m.capabilities,
              capabilityDetails: m.capabilityDetails,
              contextWindow: m.contextWindow,
              costMetadata: m.costMetadata,
              isRecommended: false,
              isDefault: user.defaultModel ? m.model === user.defaultModel : false,
              availabilityStatus: 'available',
              lastLatencyMs: m.latencyMs,
              lastVerifiedAt: m.lastVerifiedAt,
            })),
          });
        }
      } catch {
        // Fall through to 503
      }
      return reply.code(503).send(catalogError(request));
    }

    return reply.send({
      source: 'persisted',
      models: persisted.map((m) => formatDescriptor(m, user.defaultModel)),
    });
  });

  // 2. POST /v1/models/refresh - Probe capabilities with concurrency limit and rate limit
  app.post(
    '/v1/models/refresh',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            probe: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, deps.auth);
      let live: readonly ModelDescriptor[];
      try {
        live = await deps.gateway.listModels();
      } catch {
        const persisted = await deps.modelConfigs.listActiveModels();
        if (persisted.length === 0) return reply.code(503).send(catalogError(request));
        return reply.send({
          source: 'persisted',
          models: persisted.map((m) => formatDescriptor(m, user.defaultModel)),
        });
      }

      if (live.length === 0) {
        const persisted = await deps.modelConfigs.listActiveModels();
        if (persisted.length === 0) return reply.code(503).send(catalogError(request));
        return reply.send({
          source: 'persisted',
          models: persisted.map((m) => formatDescriptor(m, user.defaultModel)),
        });
      }

      // Execute capability probing with rate limit (100ms) and bounded concurrency (2)
      const probeResults = await probeCatalog(deps.gateway, live, {
        concurrency: 2,
        delayMs: 100,
      });

      for (const descriptor of live) {
        if (!descriptor.model.trim() || !descriptor.provider.trim()) continue;
        const provider = await deps.modelConfigs.upsertProvider(
          descriptor.provider,
          deps.providerBaseUrl,
        );

        const probe = probeResults.get(descriptor.model);
        const provenCapabilities: ModelCapability[] = probe
          ? probe.capabilities
          : (descriptor.capabilities as ModelCapability[]);

        await deps.modelConfigs.upsertModelConfig(
          provider.id,
          descriptor.model,
          [...provenCapabilities],
          descriptor.contextWindow,
          descriptor.costMetadata ? { ...descriptor.costMetadata } : undefined,
          true,
          {
            capabilityDetails: probe?.capabilityDetails,
            isRecommended: descriptor.isRecommended ?? false,
            isDefault: descriptor.isDefault ?? false,
            availabilityStatus: probe?.availabilityStatus ?? 'available',
            lastLatencyMs: probe?.latencyMs,
            lastVerifiedAt: probe ? new Date(probe.probedAt) : new Date(),
          },
        );
      }

      // Audit log catalog refresh
      if (deps.audit) {
        await deps.audit.log({
          userId: user.id,
          action: 'model_catalog.refreshed',
          resourceType: 'model_catalog',
          resourceId: '9router',
          decision: 'allow',
          metadata: {
            discoveredCount: live.length,
            probedCount: probeResults.size,
            refreshedAt: new Date().toISOString(),
          },
        });
      }

      const refreshed = await deps.modelConfigs.listActiveModels();
      return reply.send({
        source: 'live',
        refreshedAt: new Date().toISOString(),
        models: refreshed.map((m) => formatDescriptor(m, user.defaultModel)),
      });
    },
  );

  // 3. User model preferences: GET & PATCH /v1/users/me/preferences
  app.get('/v1/users/me/preferences', async (request, reply) => {
    const user = await authenticate(request, deps.auth);
    return reply.send({
      defaultModel: user.defaultModel ?? null,
      defaultMode: user.defaultMode ?? 'auto',
    });
  });

  app.patch(
    '/v1/users/me/preferences',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            defaultModel: { type: ['string', 'null'], maxLength: 200 },
            defaultMode: {
              type: 'string',
              enum: ['auto', 'fast', 'coding', 'complex', 'research'],
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, deps.auth);
      const body = request.body as {
        defaultModel?: string | null;
        defaultMode?: 'auto' | 'fast' | 'coding' | 'complex' | 'research';
      };

      if (body.defaultModel !== undefined && body.defaultModel !== null) {
        const activeModels = await deps.modelConfigs.listActiveModels();
        if (!activeModels.some((m) => m.model === body.defaultModel)) {
          return reply.code(400).send({
            error: {
              code: 'MODEL_NOT_AVAILABLE',
              message:
                'Model yang dipilih tidak tersedia atau sedang nonaktif. Silakan pilih model lain atau gunakan mode Otomatis.',
              requestId: request.id,
            },
          });
        }
      }

      const updated = await deps.auth.updateUserPreferences(user.id, {
        defaultModel: body.defaultModel,
        defaultMode: body.defaultMode,
      });

      if (deps.audit) {
        await deps.audit.log({
          userId: user.id,
          action: 'user.preference.updated',
          resourceType: 'user_preference',
          resourceId: user.id,
          decision: 'allow',
          metadata: {
            defaultModel: updated.defaultModel ?? null,
            defaultMode: updated.defaultMode ?? 'auto',
          },
        });
      }

      return reply.send({
        defaultModel: updated.defaultModel ?? null,
        defaultMode: updated.defaultMode ?? 'auto',
      });
    },
  );
};
