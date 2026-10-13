import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ActiveModelRecord, ModelConfigRepository } from '../db/model-config-repository.ts';
import type { ModelGateway, ModelDescriptor } from '@personal-ai-os/model-gateway';

export type ModelRouteDependencies = {
  auth: AuthService;
  modelConfigs: ModelConfigRepository;
  gateway: ModelGateway;
  providerBaseUrl: string;
};

const authenticate = async (request: FastifyRequest, auth: AuthService) => {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AuthError('UNAUTHENTICATED', 'authentication required');
  return auth.authenticate(header.slice(7).trim());
};

const persistedDescriptor = (model: ActiveModelRecord) => ({
  id: model.model,
  provider: model.providerName,
  capabilities: model.capabilities,
  contextWindow: model.contextWindow,
  costMetadata: model.costMetadata,
});

const liveDescriptor = (model: ModelDescriptor) => ({
  id: model.model,
  provider: model.provider,
  capabilities: model.capabilities,
  contextWindow: model.contextWindow,
  costMetadata: model.costMetadata,
  latencyMs: model.latencyMs,
});

const catalogError = (request: FastifyRequest) => ({
  error: {
    code: 'MODEL_CATALOG_UNAVAILABLE',
    message: 'No active models available',
    requestId: request.id,
  },
});

export const registerModelRoutes = (app: FastifyInstance, deps: ModelRouteDependencies): void => {
  app.get('/v1/models', async (request, reply) => {
    await authenticate(request, deps.auth);
    const persisted = await deps.modelConfigs.listActiveModels();
    try {
      const live = await deps.gateway.listModels();
      if (live.length > 0) return reply.send({ source: 'live', models: live.map(liveDescriptor) });
    } catch {
      // Continue with the last persisted catalog when the gateway is unavailable.
    }
    if (persisted.length === 0) return reply.code(503).send(catalogError(request));
    return reply.send({ source: 'persisted', models: persisted.map(persistedDescriptor) });
  });

  app.post(
    '/v1/models/refresh',
    {
      schema: {
        body: { type: 'object', additionalProperties: false },
      },
    },
    async (request, reply) => {
      await authenticate(request, deps.auth);
      let live: readonly ModelDescriptor[];
      try {
        live = await deps.gateway.listModels();
      } catch {
        const persisted = await deps.modelConfigs.listActiveModels();
        if (persisted.length === 0) return reply.code(503).send(catalogError(request));
        return reply.send({ source: 'persisted', models: persisted.map(persistedDescriptor) });
      }
      if (live.length === 0) {
        const persisted = await deps.modelConfigs.listActiveModels();
        if (persisted.length === 0) return reply.code(503).send(catalogError(request));
        return reply.send({ source: 'persisted', models: persisted.map(persistedDescriptor) });
      }

      for (const descriptor of live) {
        if (!descriptor.model.trim() || !descriptor.provider.trim()) continue;
        const provider = await deps.modelConfigs.upsertProvider(
          descriptor.provider,
          deps.providerBaseUrl,
        );
        await deps.modelConfigs.upsertModelConfig(
          provider.id,
          descriptor.model,
          [...descriptor.capabilities],
          descriptor.contextWindow,
          descriptor.costMetadata ? { ...descriptor.costMetadata } : undefined,
        );
      }
      return reply.send({
        source: 'live',
        refreshedAt: new Date().toISOString(),
        models: live.map(liveDescriptor),
      });
    },
  );
};
