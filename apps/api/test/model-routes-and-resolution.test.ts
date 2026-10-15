import assert from 'node:assert/strict';
import test from 'node:test';
import { MockModelGateway } from '@personal-ai-os/model-gateway';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryModelConfigRepository } from '../src/db/model-config-repository.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryAuditRepository } from '../src/db/audit-repository.ts';
import { ModelRouter } from '../src/services/model-router.ts';

const setupTestRig = async () => {
  const authRepo = new InMemoryAuthRepository();
  const authService = createAuthService(authRepo, 'test-secret-test-secret-test-secret-32');
  const chatRepo = new InMemoryChatRepository();
  const projectRepo = new InMemoryProjectRepository();
  const modelConfigRepo = new InMemoryModelConfigRepository();
  const auditRepo = new InMemoryAuditRepository();

  const provider = await modelConfigRepo.upsertProvider(
    '9router',
    'https://9router.ojixx.my.id/v1',
  );

  // Model A: Fast, small context, streaming, low latency (50ms)
  await modelConfigRepo.upsertModelConfig(
    provider.id,
    'provider/fast-model',
    ['chat', 'streaming'],
    32_000,
    undefined,
    true,
    {
      capabilityDetails: {
        chat: { status: 'probed', verifiedAt: new Date().toISOString() },
        streaming: { status: 'probed', verifiedAt: new Date().toISOString(), latencyMs: 50 },
        tool_calling: { status: 'unknown' },
        vision: { status: 'unknown' },
      },
      lastLatencyMs: 50,
      availabilityStatus: 'available',
    },
  );

  // Model B: Coding & tools, large context (128k), streaming & tool_calling
  await modelConfigRepo.upsertModelConfig(
    provider.id,
    'provider/coding-model',
    ['chat', 'streaming', 'tool_calling'],
    128_000,
    undefined,
    true,
    {
      capabilityDetails: {
        chat: { status: 'probed', verifiedAt: new Date().toISOString() },
        streaming: { status: 'probed', verifiedAt: new Date().toISOString(), latencyMs: 150 },
        tool_calling: { status: 'probed', verifiedAt: new Date().toISOString(), latencyMs: 160 },
        vision: { status: 'unknown' },
      },
      lastLatencyMs: 150,
      availabilityStatus: 'available',
    },
  );

  // Model C: Multimodal, vision verified, 200k context
  await modelConfigRepo.upsertModelConfig(
    provider.id,
    'provider/vision-model',
    ['chat', 'streaming', 'tool_calling', 'vision'],
    200_000,
    undefined,
    true,
    {
      capabilityDetails: {
        chat: { status: 'probed', verifiedAt: new Date().toISOString() },
        streaming: { status: 'probed', verifiedAt: new Date().toISOString(), latencyMs: 200 },
        tool_calling: { status: 'probed', verifiedAt: new Date().toISOString(), latencyMs: 210 },
        vision: { status: 'probed', verifiedAt: new Date().toISOString(), latencyMs: 250 },
      },
      lastLatencyMs: 200,
      availabilityStatus: 'available',
    },
  );

  const gateway = new MockModelGateway({
    chatResponse: 'Jawaban dari mock model gateway.',
    streamChunks: ['Halo ', 'dunia!'],
  });

  const router = new ModelRouter(modelConfigRepo, gateway);

  const app = await buildApp({
    auth: authService,
    health: { database: async () => true, redis: async () => true },
    chat: {
      chatRepo,
      router,
      modelConfigs: modelConfigRepo,
      gateway,
    },
    project: {
      projectRepo,
      chatRepo,
    },
    models: {
      auth: authService,
      modelConfigs: modelConfigRepo,
      gateway,
      providerBaseUrl: 'https://9router.ojixx.my.id/v1',
      audit: auditRepo,
    },
    approval: {
      approvalRepo: {
        listPending: async () => [],
        getById: async () => null,
        getByTaskId: async () => null,
        getByFingerprint: async () => null,
        create: async () => {
          throw new Error('Not implemented');
        },
        updateStatus: async () => null,
      },
      auditRepo,
    },
  });

  return { app, authService, chatRepo, projectRepo, modelConfigRepo, auditRepo, router, gateway };
};

test('Resolution Hierarchy: Message choice > Conversation preference > User default > Auto', async () => {
  const { router } = await setupTestRig();

  // 1. All three specified: Message choice wins
  const res1 = await router.resolveModel({
    preferredModel: 'provider/vision-model',
    conversationModel: 'provider/coding-model',
    userDefaultModel: 'provider/fast-model',
  });
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.primary.model, 'provider/vision-model');
  }

  // 2. Message choice omitted: Conversation preference wins
  const res2 = await router.resolveModel({
    conversationModel: 'provider/coding-model',
    userDefaultModel: 'provider/fast-model',
  });
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.primary.model, 'provider/coding-model');
  }

  // 3. Message and Conversation omitted: User default wins
  const res3 = await router.resolveModel({
    userDefaultModel: 'provider/fast-model',
  });
  assert.equal(res3.ok, true);
  if (res3.ok) {
    assert.equal(res3.primary.model, 'provider/fast-model');
  }

  // 4. All omitted: Auto policy takes effect
  const res4 = await router.resolveModel({
    mode: 'fast',
  });
  assert.equal(res4.ok, true);
  if (res4.ok) {
    assert.equal(res4.primary.model, 'provider/fast-model');
  }
});

test('Auto policy dynamically resolves mode without hardcoded model names', async () => {
  const { router, modelConfigRepo } = await setupTestRig();

  // Mode: coding -> should prefer model with tool_calling + larger context
  const codingRes = await router.resolveModel({ mode: 'coding' });
  assert.equal(codingRes.ok, true);
  if (codingRes.ok) {
    assert.equal(codingRes.primary.model, 'provider/vision-model'); // 200k context with tool_calling
  }

  // Mode: fast -> should prefer lowest latency (provider/fast-model has 50ms)
  const fastRes = await router.resolveModel({ mode: 'fast' });
  assert.equal(fastRes.ok, true);
  if (fastRes.ok) {
    assert.equal(fastRes.primary.model, 'provider/fast-model');
  }

  // Configure table policy override for mode 'fast'
  await modelConfigRepo.setRoutingPolicy('fast', 'provider/coding-model');
  const overriddenFast = await router.resolveModel({ mode: 'fast' });
  assert.equal(overriddenFast.ok, true);
  if (overriddenFast.ok) {
    assert.equal(overriddenFast.primary.model, 'provider/coding-model');
  }

  // Environment variable override takes highest precedence over table policy
  process.env.AUTO_MODEL_FAST = 'provider/vision-model';
  try {
    const envOverridden = await router.resolveModel({ mode: 'fast' });
    assert.equal(envOverridden.ok, true);
    if (envOverridden.ok) {
      assert.equal(envOverridden.primary.model, 'provider/vision-model');
    }
  } finally {
    delete process.env.AUTO_MODEL_FAST;
  }
});

test('Standardized error responses: MODEL_NOT_AVAILABLE, VISION_NOT_VERIFIED, NO_COMPATIBLE_MODEL', async () => {
  const { router } = await setupTestRig();

  // 1. MODEL_NOT_AVAILABLE
  const unavailableRes = await router.resolveModel({ preferredModel: 'nonexistent/model-x' });
  assert.equal(unavailableRes.ok, false);
  if (!unavailableRes.ok) {
    assert.equal(unavailableRes.error, 'MODEL_NOT_AVAILABLE');
    assert.match(unavailableRes.message, /tidak tersedia atau sedang nonaktif/);
  }

  // 2. VISION_NOT_VERIFIED
  const visionNotVerified = await router.resolveModel({
    preferredModel: 'provider/fast-model', // does NOT have vision capability
    requiresVision: true,
  });
  assert.equal(visionNotVerified.ok, false);
  if (!visionNotVerified.ok) {
    assert.equal(visionNotVerified.error, 'VISION_NOT_VERIFIED');
    assert.match(visionNotVerified.message, /belum diverifikasi/);
  }

  // 3. NO_COMPATIBLE_MODEL: exceeding context window of all models
  const noCompatible = await router.resolveModel({ estimatedTokens: 500_000 });
  assert.equal(noCompatible.ok, false);
  if (!noCompatible.ok) {
    assert.equal(noCompatible.error, 'NO_COMPATIBLE_MODEL');
    assert.match(noCompatible.message, /Tidak ada model aktif yang memenuhi kriteria/);
  }
});

test('HTTP GET /v1/models returns enriched descriptors with status, latency, and flags', async () => {
  const { app, authService } = await setupTestRig();
  const alice = await authService.register('alice@models.com', 'secret-pass-1234');
  await authService.updateUserPreferences(alice.user.id, {
    defaultModel: 'provider/coding-model',
  });

  const res = await app.inject({
    method: 'GET',
    url: '/v1/models',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body) as {
    source: string;
    models: Array<{
      id: string;
      capabilities: string[];
      capabilityDetails?: Record<string, { status: string }>;
      contextWindow: number;
      isDefault: boolean;
      availabilityStatus: string;
      lastLatencyMs?: number;
    }>;
  };

  assert.equal(data.source, 'persisted');
  assert.equal(data.models.length, 3);

  const codingModel = data.models.find((m) => m.id === 'provider/coding-model');
  assert.ok(codingModel);
  assert.equal(codingModel.isDefault, true); // User default reflected
  assert.equal(codingModel.contextWindow, 128_000);
  assert.equal(codingModel.availabilityStatus, 'available');
  assert.equal(codingModel.lastLatencyMs, 150);
  assert.equal(codingModel.capabilityDetails?.['tool_calling']?.status, 'probed');
  assert.equal(codingModel.capabilityDetails?.['vision']?.status, 'unknown');
});

test('HTTP POST /v1/models/refresh probes capabilities and records audit log', async () => {
  const { app, authService, auditRepo, gateway } = await setupTestRig();
  const bob = await authService.register('bob@models.com', 'secret-pass-1234');

  // Configure mock gateway with 2 models to probe
  gateway.options.models = [
    {
      provider: '9router',
      model: 'refreshed/chat-only',
      capabilities: ['chat'],
      contextWindow: 8192,
    },
    {
      provider: '9router',
      model: 'refreshed/multimodal',
      capabilities: ['chat', 'streaming', 'tool_calling', 'vision'],
      contextWindow: 64_000,
    },
  ];

  const res = await app.inject({
    method: 'POST',
    url: '/v1/models/refresh',
    headers: { authorization: `Bearer ${bob.accessToken}` },
    payload: {},
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body) as { source: string; refreshedAt: string; models: unknown[] };
  assert.equal(data.source, 'live');
  assert.ok(data.refreshedAt);

  // Verify audit log recorded catalog refresh
  const auditLogs = await auditRepo.listAuditLogs(bob.user.id);
  const refreshLog = auditLogs.find((l) => l.action === 'model_catalog.refreshed');
  assert.ok(refreshLog);
  assert.equal(refreshLog.resourceType, 'model_catalog');
});

test('User preferences endpoint GET & PATCH /v1/users/me/preferences and audit logging', async () => {
  const { app, authService, auditRepo } = await setupTestRig();
  const carol = await authService.register('carol@models.com', 'secret-pass-1234');

  // 1. Initial preferences
  const getRes1 = await app.inject({
    method: 'GET',
    url: '/v1/users/me/preferences',
    headers: { authorization: `Bearer ${carol.accessToken}` },
  });
  assert.equal(getRes1.statusCode, 200);
  const getBody1 = JSON.parse(getRes1.body);
  assert.equal(getBody1.defaultModel, null);
  assert.equal(getBody1.defaultMode, 'auto');

  // 2. Reject inactive/non-existent model
  const patchInvalid = await app.inject({
    method: 'PATCH',
    url: '/v1/users/me/preferences',
    headers: { authorization: `Bearer ${carol.accessToken}` },
    payload: { defaultModel: 'nonexistent/model-xyz' },
  });
  assert.equal(patchInvalid.statusCode, 400);
  const errBody = JSON.parse(patchInvalid.body);
  assert.equal(errBody.error.code, 'MODEL_NOT_AVAILABLE');

  // 3. Update valid preferences
  const patchValid = await app.inject({
    method: 'PATCH',
    url: '/v1/users/me/preferences',
    headers: { authorization: `Bearer ${carol.accessToken}` },
    payload: { defaultModel: 'provider/coding-model', defaultMode: 'coding' },
  });
  assert.equal(patchValid.statusCode, 200);
  const patchBody = JSON.parse(patchValid.body);
  assert.equal(patchBody.defaultModel, 'provider/coding-model');
  assert.equal(patchBody.defaultMode, 'coding');

  // 4. Verify audit log was written
  const auditLogs = await auditRepo.listAuditLogs(carol.user.id);
  const prefLog = auditLogs.find((l) => l.action === 'user.preference.updated');
  assert.ok(prefLog);
  assert.equal(prefLog.resourceType, 'user_preference');
  assert.equal((prefLog.metadata as Record<string, unknown>).defaultModel, 'provider/coding-model');
});

test('Conversation model preference update and audit log in PATCH /v1/conversations/:id', async () => {
  const { app, authService, projectRepo, chatRepo, auditRepo } = await setupTestRig();
  const dave = await authService.register('dave@models.com', 'secret-pass-1234');
  const project = await projectRepo.createProject(dave.user.id, 'Dave Project');
  const conversationId = await chatRepo.getOrCreateConversation(dave.user.id, project.id);

  const res = await app.inject({
    method: 'PATCH',
    url: `/v1/conversations/${conversationId}`,
    headers: { authorization: `Bearer ${dave.accessToken}` },
    payload: { model: 'provider/coding-model', mode: 'coding' },
  });

  assert.equal(res.statusCode, 200);
  const conv = await chatRepo.getConversation(dave.user.id, conversationId);
  assert.equal(conv?.model, 'provider/coding-model');
  assert.equal(conv?.mode, 'coding');

  const auditLogs = await auditRepo.listAuditLogs(dave.user.id);
  const convAudit = auditLogs.find((l) => l.action === 'conversation.model.updated');
  assert.ok(convAudit);
  assert.equal(convAudit.resourceId, conversationId);
});

test('HTTP POST /v1/chat includes resolvedModel and fallbackUsed in response', async () => {
  const { app, authService } = await setupTestRig();
  const eva = await authService.register('eva@models.com', 'secret-pass-1234');

  const res = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    headers: { authorization: `Bearer ${eva.accessToken}` },
    payload: {
      content: 'Halo AI!',
      model: 'provider/fast-model',
    },
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    conversationId: string;
    resolvedModel: string;
    fallbackUsed: boolean;
    mode: string;
  };
  assert.equal(body.resolvedModel, 'provider/fast-model');
  assert.equal(body.fallbackUsed, false);
});
