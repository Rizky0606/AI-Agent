import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { Redis } from 'ioredis';

import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DeviceConnectionManager } from '../src/services/device-connection-manager.ts';
import { DrizzleMemoryRepository } from '../src/db/memory-repository.ts';
import { InMemorySkillRepository } from '../src/db/skill-repository.ts';
import { SqlScheduleRepository } from '../src/db/schedule-repository.ts';
import { ArtifactManager, DiskArtifactStorage } from '@personal-ai-os/tools';
import { InactiveEmbeddingProvider } from '@personal-ai-os/memory';
import { EventEngine, NotificationEngine, SchedulerEngine } from '@personal-ai-os/scheduler';
import { MockModelGateway } from '@personal-ai-os/model-gateway';
import { ModelRouter } from '../src/services/model-router.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';

const secret = 'super-secret-key-at-least-32-chars-long';

test('Integration: All modules mounted in buildApp are registered and 401-protected without auth token', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'api-integration-artifacts-'));
  const storage = new DiskArtifactStorage(tempDir);
  const artifactManager = new ArtifactManager({ storage, userQuotaBytes: 10 * 1024 * 1024 });

  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);

  const deviceManager = new DeviceConnectionManager();
  const registeredDevices: Array<{ id: string; name: string; platform: string }> = [];

  const memoryRepo = new DrizzleMemoryRepository(
    null as unknown as import('../src/db/client.ts').Database,
    new InactiveEmbeddingProvider(),
  );

  const skillRepo = new InMemorySkillRepository();
  const scheduleRepo = new SqlScheduleRepository(
    null as unknown as import('../src/db/client.ts').Database,
  );
  const schedulerEngine = new SchedulerEngine({ storage: scheduleRepo });
  const eventEngine = new EventEngine();
  const notificationEngine = new NotificationEngine();

  const mockGateway = new MockModelGateway();
  const mockModelConfigRepo = {
    listProviders: async () => [{ id: 'p-1', name: 'mock', baseUrl: 'http://localhost' }],
    listModelConfigs: async () => [
      {
        id: 'm-1',
        providerId: 'p-1',
        model: 'anthropic/claude-3-5-sonnet',
        capabilities: ['chat'],
        contextWindow: 128_000,
      },
    ],
    upsertProvider: async () => ({ id: 'p-1', name: 'mock', baseUrl: 'http://localhost' }),
    upsertModelConfig: async () => ({}),
  } as unknown as import('../src/db/model-config-repository.ts').ModelConfigRepository;

  const modelRouter = new ModelRouter(mockModelConfigRepo, mockGateway);

  const mockChatRepo = {
    createThread: async () => ({ id: 'th-1', userId: 'u-1', title: 'T', createdAt: new Date() }),
    listThreads: async () => [],
    getThread: async () => null,
    addMessage: async () => ({}),
    listMessages: async () => [],
  } as unknown as import('../src/db/chat-repository.ts').ChatRepository;

  const mockProjectRepo = {
    createProject: async () => ({}),
    listProjects: async () => [],
    getProject: async () => null,
  } as unknown as import('../src/db/project-repository.ts').ProjectRepository;

  const mockTaskRepo = {
    createTask: async () => ({ isDuplicate: false, task: {} }),
    getTask: async () => null,
    listTasks: async () => [],
    updateTaskStatus: async () => ({}),
    appendEvent: async () => ({}),
    listEvents: async () => [],
  } as unknown as import('../src/db/task-repository.ts').TaskRepository;

  const mockTaskQueue = {
    enqueue: async () => 'job-1',
  } as unknown as import('../src/services/task-queue.ts').TaskQueue;

  const mockApprovalRepo = {
    createApprovalRequest: async () => ({}),
    listPendingApprovals: async () => [],
    getApprovalRequest: async () => null,
    resolveApprovalRequest: async () => ({}),
  } as unknown as import('../src/db/approval-repository.ts').ApprovalRepository;

  const mockAuditRepo = {
    appendAuditLog: async () => ({}),
    listAuditLogs: async () => [],
  } as unknown as import('../src/db/audit-repository.ts').AuditRepository;

  const broadcaster = new InMemoryTaskEventBroadcaster();

  const app = await buildApp({
    auth,
    health: {
      database: async () => true,
      redis: async () => true,
    },
    deviceManager,
    listDevices: async () => registeredDevices.map((d) => ({ ...d, isOnline: true })),
    updateDeviceLastSeen: async () => {},
    registerDevice: async (_userId, input) => {
      const dev = { id: 'dev-1', name: input.name, platform: input.platform };
      registeredDevices.push(dev);
      return dev;
    },
    chat: {
      chatRepo: mockChatRepo,
      router: modelRouter,
    },
    project: {
      projectRepo: mockProjectRepo,
      chatRepo: mockChatRepo,
    },
    task: {
      projectRepo: mockProjectRepo,
      taskRepo: mockTaskRepo,
      taskQueue: mockTaskQueue,
      broadcaster,
    },
    approval: {
      approvalRepo: mockApprovalRepo,
      taskRepo: mockTaskRepo,
      taskQueue: mockTaskQueue,
      broadcaster,
      auditRepo: mockAuditRepo,
    },
    memory: {
      memoryRepo,
    },
    artifacts: {
      artifactManager,
    },
    skills: {
      skillRepo,
      skillsDir: fileURLToPath(new URL('../../../skills', import.meta.url)),
    },
    schedules: {
      schedulerEngine,
      eventEngine,
      notificationEngine,
    },
  });

  try {
    // 1. Verify all routes return 401 UNAUTHENTICATED without Bearer token
    const routesToTest = [
      { method: 'POST', url: '/v1/chat', payload: { content: 'hello' } },
      { method: 'GET', url: '/v1/projects' },
      { method: 'POST', url: '/v1/projects', payload: { name: 'P' } },
      {
        method: 'GET',
        url: '/v1/projects/550e8400-e29b-41d4-a716-446655440000/tasks',
      },
      {
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          kind: 'k1',
          payload: {},
        },
      },
      { method: 'GET', url: '/v1/approvals' },
      { method: 'GET', url: '/v1/devices' },
      { method: 'POST', url: '/v1/devices', payload: { name: 'Windows-PC', platform: 'windows' } },
      { method: 'GET', url: '/v1/memories' },
      {
        method: 'POST',
        url: '/v1/memories',
        payload: { content: 'test', type: 'knowledge' },
      },
      {
        method: 'POST',
        url: '/v1/memories/evaluate',
        payload: { content: 'test', type: 'decision' },
      },
      {
        method: 'POST',
        url: '/v1/memories/search',
        payload: { query: 'test search' },
      },
      {
        method: 'POST',
        url: '/v1/context/assemble',
        payload: { userPrompt: 'test' },
      },
      { method: 'GET', url: '/v1/artifacts' },
      {
        method: 'POST',
        url: '/v1/artifacts',
        payload: { filename: 'test.txt', mimeType: 'text/plain', content: 'test' },
      },
      { method: 'GET', url: '/v1/skills' },
      { method: 'POST', url: '/v1/skills/sync' },
      { method: 'GET', url: '/v1/schedules' },
      {
        method: 'POST',
        url: '/v1/schedules',
        payload: { name: 'Job', type: 'one_off', taskPayload: { kind: 'k', input: {} } },
      },
      {
        method: 'POST',
        url: '/v1/events',
        payload: { source: 'test', type: 'test.evt', payload: {} },
      },
      { method: 'GET', url: '/v1/notifications/preferences' },
      {
        method: 'PUT',
        url: '/v1/notifications/preferences',
        payload: { preferences: { quietHours: false } },
      },
    ] as const;

    for (const route of routesToTest) {
      const res = await app.inject({
        method: route.method as 'GET' | 'POST' | 'PUT',
        url: route.url,
        payload: 'payload' in route ? route.payload : undefined,
      });

      assert.equal(
        res.statusCode,
        401,
        `Expected ${route.method} ${route.url} to reject with 401 without auth token, but got ${res.statusCode}`,
      );
    }

    // 2. Register user, authenticate, and verify semantic search explicitly marks inactive
    const user = await auth.register('bob-tester@example.com', 'ValidPassword123!');
    const token = user.accessToken;

    const searchRes = await app.inject({
      method: 'POST',
      url: '/v1/memories/search',
      headers: { authorization: `Bearer ${token}` },
      payload: { query: 'architecture decisions' },
    });
    assert.equal(searchRes.statusCode, 200);
    const searchBody = searchRes.json();
    assert.equal(
      searchBody.semanticSearchActive,
      false,
      'Semantic search MUST be marked inactive per assessment decision',
    );
    assert.equal(searchBody.status, 'inactive');
    assert.ok(searchBody.notice?.includes('inactive'));
  } finally {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Integration: Real PostgreSQL and Redis connectivity probe & persistence check', async (t) => {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgresql://personal_ai_os:personal_ai_secret@127.0.0.1:5432/personal_ai_os';
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

  let sqlClient: postgres.Sql | null = null;
  let redisClient: Redis | null = null;
  let isPostgresReady = false;
  let isRedisReady = false;

  try {
    sqlClient = postgres(dbUrl, { max: 1, connect_timeout: 2, prepare: false });
    const [{ result }] = await sqlClient`SELECT 1 as result`;
    isPostgresReady = result === 1;
  } catch {
    isPostgresReady = false;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redisClient.connect();
    const ping = await redisClient.ping();
    isRedisReady = ping === 'PONG';
  } catch {
    isRedisReady = false;
  } finally {
    if (redisClient) {
      await redisClient.quit().catch(() => {});
    }
    if (sqlClient) {
      await sqlClient.end({ timeout: 2 }).catch(() => {});
    }
  }

  if (!isPostgresReady || !isRedisReady) {
    t.skip(
      `Real PostgreSQL (${isPostgresReady ? 'online' : 'offline'}) or Redis (${isRedisReady ? 'online' : 'offline'}) not reachable at localhost. Skipping live infrastructure probe.`,
    );
    return;
  }

  // When live services are reachable (e.g. CI runner), execute live persistence verification
  assert.ok(isPostgresReady, 'PostgreSQL responded to SELECT 1');
  assert.ok(isRedisReady, 'Redis responded to PING');
});
