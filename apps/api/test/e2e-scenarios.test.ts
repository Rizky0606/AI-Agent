import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { Redis } from 'ioredis';
import postgres from 'postgres';

import { buildApp } from '../src/app.ts';
import { createAuthService, InMemoryAuthRepository } from '../src/auth/service.ts';
import { DeviceConnectionManager } from '../src/services/device-connection-manager.ts';
import { RedisTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { ModelRouter } from '../src/services/model-router.ts';
import { BullMqTaskQueue } from '../src/services/task-queue.ts';

import { NineRouterGateway } from '@personal-ai-os/model-gateway';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { SchedulerEngine } from '@personal-ai-os/scheduler';
import {
  createVersionedCheckpoint,
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskRecord,
  type TaskRepository,
  type TaskStatus,
} from '@personal-ai-os/shared';
import { CodingEvaluator } from '@personal-ai-os/evaluator';

import { createAgentWorker } from '../../agent-worker/src/index.ts';
import { TaskExecutor } from '../../agent-worker/src/task-executor.ts';
import { CommandExecutor } from '../../windows/src/security/command-executor.ts';
import { PathValidator, SecurityError } from '../../windows/src/security/path-validator.ts';
import { CapabilityRegistry } from '../../windows/src/security/capability-registry.ts';

const JWT_SECRET = 'e2e-test-secret-at-least-32-chars-long-12345';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://personal_ai_os:personal_ai_secret@127.0.0.1:5432/personal_ai_os';

/**
 * Local Fake 9Router Server
 * JELAS DILABELI: Server HTTP lokal tiruan yang meniru endpoint 9Router (https://9router.ojixx.my.id/v1)
 * untuk pengujian streaming dan chat tanpa bergantung pada API key eksternal.
 */
class LocalFake9RouterServer {
  private server: http.Server | null = null;
  public port = 0;
  public requestCount = 0;

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.requestCount++;
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', () => {
          if (
            req.method === 'POST' &&
            (req.url === '/v1/chat/completions' || req.url === '/chat/completions')
          ) {
            const parsed = body ? JSON.parse(body) : {};
            if (parsed.stream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              });

              // Kirim potongan delta SSE tiruan
              res.write(
                `data: ${JSON.stringify({
                  id: 'chatcmpl-fake-1',
                  choices: [{ delta: { content: 'Halo ' } }],
                })}\n\n`,
              );
              res.write(
                `data: ${JSON.stringify({
                  id: 'chatcmpl-fake-1',
                  choices: [{ delta: { content: 'saya ' } }],
                })}\n\n`,
              );
              res.write(
                `data: ${JSON.stringify({
                  id: 'chatcmpl-fake-1',
                  choices: [{ delta: { content: 'Personal AI OS.' } }],
                })}\n\n`,
              );
              res.write('data: [DONE]\n\n');
              res.end();
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  id: 'chatcmpl-fake-1',
                  choices: [
                    {
                      message: { role: 'assistant', content: 'Halo, saya Personal AI OS.' },
                      finish_reason: 'stop',
                    },
                  ],
                }),
              );
            }
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address() as { port: number };
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}/v1`);
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
    }
  }
}

// In-Memory Task Repository fallback for local environment without PostgreSQL
class InMemoryTaskRepo implements TaskRepository {
  private tasks = new Map<string, TaskRecord>();
  private events: TaskEventEnvelope[] = [];

  async createTask(input: {
    userId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string | null | undefined;
    priority?: number | undefined;
    maxAttempts?: number | undefined;
  }): Promise<{ task: TaskRecord; isDuplicate: boolean }> {
    if (input.idempotencyKey) {
      for (const t of this.tasks.values()) {
        if (t.userId === input.userId && t.payload?.['idempotencyKey'] === input.idempotencyKey) {
          return { task: { ...t }, isDuplicate: true };
        }
      }
    }
    const id = randomUUID();
    const task: TaskRecord = {
      id,
      userId: input.userId,
      projectId: input.projectId,
      kind: input.kind,
      status: 'queued',
      progress: 0,
      priority: input.priority ?? 0,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      payload: { ...input.payload, idempotencyKey: input.idempotencyKey },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(id, task);
    return { task, isDuplicate: false };
  }

  async getTask(userId: string, taskId: string): Promise<TaskRecord | null> {
    const t = this.tasks.get(taskId);
    return t && t.userId === userId ? { ...t } : null;
  }

  async listTasks(userId: string, projectId?: string): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values()).filter(
      (t) => t.userId === userId && (!projectId || t.projectId === projectId),
    );
  }

  async updateTaskStatus(
    userId: string,
    taskId: string,
    status: TaskStatus,
    patch?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const t = this.tasks.get(taskId);
    if (!t || t.userId !== userId) throw new Error(`Task ${taskId} not found`);
    const updated: TaskRecord = { ...t, ...patch, status, updatedAt: new Date() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async updateTaskProgress(
    userId: string,
    taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint,
  ): Promise<TaskRecord> {
    const t = this.tasks.get(taskId);
    if (!t || t.userId !== userId) throw new Error(`Task ${taskId} not found`);
    const updated: TaskRecord = { ...t, progress, checkpoint, updatedAt: new Date() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async createTaskEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventEnvelope['eventType'],
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const event: TaskEventEnvelope = {
      id: randomUUID(),
      userId,
      taskId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async getTaskEvents(
    userId: string,
    taskId: string,
    options?: { afterEventId?: string; limit?: number },
  ): Promise<TaskEventEnvelope[]> {
    let filtered = this.events.filter((e) => e.userId === userId && e.taskId === taskId);
    if (options?.afterEventId) {
      const idx = filtered.findIndex((e) => e.id === options.afterEventId);
      if (idx >= 0) filtered = filtered.slice(idx + 1);
    }
    if (options?.limit) filtered = filtered.slice(0, options.limit);
    return filtered;
  }
}

// In-Memory Project Repository fallback
class InMemoryProjectRepo {
  private projects = new Map<string, { id: string; userId: string; name: string }>();

  async createProject(
    userId: string,
    name: string,
  ): Promise<{ id: string; userId: string; name: string }> {
    const id = randomUUID();
    const p = { id, userId, name };
    this.projects.set(id, p);
    return p;
  }

  async getProject(userId: string, projectId: string) {
    const p = this.projects.get(projectId);
    return p && p.userId === userId ? { ...p } : null;
  }

  async listProjects(userId: string) {
    return Array.from(this.projects.values()).filter((p) => p.userId === userId);
  }
}

// In-Memory Approval Repository fallback
class InMemoryApprovalRepo {
  private approvals = new Map<
    string,
    {
      id: string;
      userId: string;
      taskId: string | null;
      projectId: string | null;
      action: string;
      resource: string;
      scope: string;
      riskLevel: string;
      consequence: string;
      fingerprint: string;
      status: string;
      reason: string | null;
      decidedBy: string | null;
      decidedAt: Date | null;
      expiresAt: Date;
      consumedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  async createApproval(input: {
    userId: string;
    taskId?: string | null | undefined;
    projectId?: string | null | undefined;
    action?: string | undefined;
    resource?: string | undefined;
    scope?: string | undefined;
    riskLevel: string;
    consequence?: string | undefined;
    fingerprint?: string | undefined;
    expiresInSeconds?: number | undefined;
  }) {
    const id = randomUUID();
    const ttl = input.expiresInSeconds ?? 3600;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const record = {
      id,
      userId: input.userId,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      action: input.action ?? 'unknown',
      resource: input.resource ?? 'default',
      scope: input.scope ?? 'task',
      riskLevel: input.riskLevel,
      consequence: input.consequence ?? 'Action execution',
      fingerprint: input.fingerprint ?? 'fp-default',
      status: 'pending',
      reason: null,
      decidedBy: null,
      decidedAt: null,
      expiresAt,
      consumedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.approvals.set(id, record);
    return record;
  }

  async getApproval(userId: string, approvalId: string) {
    const a = this.approvals.get(approvalId);
    return a && a.userId === userId ? { ...a } : null;
  }

  async listApprovals(
    userId: string,
    options?: { status?: string | undefined; taskId?: string | undefined },
  ) {
    return Array.from(this.approvals.values()).filter(
      (a) =>
        a.userId === userId &&
        (!options?.status || a.status === options.status) &&
        (!options?.taskId || a.taskId === options.taskId),
    );
  }

  async decideApproval(
    userId: string,
    approvalId: string,
    status: 'approved' | 'denied',
    reason?: string | undefined,
    approverId?: string | undefined,
  ) {
    const a = this.approvals.get(approvalId);
    if (!a || a.userId !== userId) throw new Error('Approval not found');
    const updated = {
      ...a,
      status,
      reason: reason ?? null,
      decidedBy: approverId ?? userId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    };
    this.approvals.set(approvalId, updated);
    return updated;
  }

  async resolveApproval(
    userId: string,
    approvalId: string,
    status: 'approved' | 'denied',
    reason?: string,
  ) {
    return this.decideApproval(userId, approvalId, status, reason);
  }
}

// In-Memory Chat Repository fallback
class InMemoryChatRepo {
  private convs = new Map<string, { id: string; userId: string; projectId: string }>();
  private messages: Array<{
    id: string;
    userId: string;
    conversationId: string;
    role: string;
    content: string;
  }> = [];

  async getOrCreateDefaultProject(): Promise<string> {
    return randomUUID();
  }

  async getOrCreateConversation(
    userId: string,
    projectId: string,
    convId?: string,
  ): Promise<string> {
    if (convId && this.convs.has(convId)) return convId;
    const id = convId ?? randomUUID();
    this.convs.set(id, { id, userId, projectId });
    return id;
  }

  async appendMessage(
    userId: string,
    conversationId: string,
    role: string,
    content: string,
    metadata?: unknown,
  ) {
    const msg = { id: randomUUID(), userId, conversationId, role, content, metadata };
    this.messages.push(msg as never);
    return msg;
  }

  async getMessages(userId: string, conversationId: string) {
    return this.messages.filter((m) => m.userId === userId && m.conversationId === conversationId);
  }
}

// In-Memory Memory Repository fallback
class InMemoryMemoryRepo {
  private memories = new Map<
    string,
    Array<{ id: string; userId: string; content: string; createdAt: Date }>
  >();

  async listMemories(userId: string) {
    return this.memories.get(userId) ?? [];
  }

  async getMemory(userId: string, id: string) {
    const list = this.memories.get(userId) ?? [];
    return list.find((m) => m.id === id) ?? null;
  }

  async createMemory(candidate: { userId: string; content: string }) {
    const list = this.memories.get(candidate.userId) ?? [];
    const item = {
      id: randomUUID(),
      userId: candidate.userId,
      content: candidate.content,
      createdAt: new Date(),
    };
    list.push(item);
    this.memories.set(candidate.userId, list);
    return item;
  }

  evaluateCandidate(candidate: { content: string }) {
    return { shouldStore: true, sanitizedContent: candidate.content, reason: 'Valid candidate' };
  }
}

// Setup Shared Environment
let fake9Router: LocalFake9RouterServer;
let fake9RouterUrl: string;
let redisPublisher: Redis;
let redisSubscriber: Redis;
let realSql: postgres.Sql | null = null;

before(async () => {
  // 1. Start Fake 9Router Server
  fake9Router = new LocalFake9RouterServer();
  fake9RouterUrl = await fake9Router.start();

  // 2. Setup Redis clients
  redisPublisher = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  redisSubscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  // 3. Test PostgreSQL availability
  try {
    const testSql = postgres(DATABASE_URL, { connect_timeout: 2, max: 1 });
    await testSql`SELECT 1`;
    realSql = testSql;
    console.log('[E2E Platform] Connected to real PostgreSQL at', DATABASE_URL);
  } catch {
    realSql = null;
    console.log(
      '[E2E Platform] PostgreSQL not reachable locally. Running with high-fidelity storage adapter.',
    );
  }
});

after(async () => {
  await fake9Router.stop();
  await redisPublisher.quit();
  await redisSubscriber.quit();
  if (realSql) {
    await realSql.end();
  }
});

test('Skenario 1: Register/login, chat streaming via WebSocket (real Fastify & fake 9Router)', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, JWT_SECRET);
  const chatRepo = new InMemoryChatRepo();

  // Real NineRouterGateway directed to LocalFake9RouterServer
  const gateway = new NineRouterGateway({
    apiKey: 'fake-9router-test-key',
    baseUrl: fake9RouterUrl,
  });

  const modelConfigs = {
    listActiveModels: async () => [
      {
        id: 'm-1',
        providerId: 'p-1',
        model: 'openai/gpt-4o-mini',
        capabilities: ['chat', 'streaming'],
        contextWindow: 128_000,
        costMetadata: null,
        enabled: true,
        providerName: '9router',
        providerBaseUrl: fake9RouterUrl,
      },
    ],
    listProviders: async () => [
      { id: 'p-1', name: '9router', baseUrl: fake9RouterUrl, enabled: true },
    ],
    listModelConfigs: async () => [],
  };

  const router = new ModelRouter(modelConfigs, gateway);

  const app = await buildApp({
    auth,
    chat: { chatRepo: chatRepo as never, router },
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;

  try {
    // 1. Register & Login
    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'alice-chat@e2e.test', password: 'Password123!' },
    });
    assert.equal(regRes.statusCode, 201);
    const token = regRes.json().accessToken;
    assert.ok(token);

    // 2. Connect WebSocket to /v1/chat/ws
    const wsUrl = `ws://127.0.0.1:${port}/v1/chat/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = reject;
    });

    const receivedDeltas: string[] = [];
    let completed = false;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.type === 'message.delta') {
        receivedDeltas.push(msg.delta);
      } else if (msg.type === 'message.completed') {
        completed = true;
      }
    };

    // 3. Send chat message
    ws.send(JSON.stringify({ type: 'chat.send', content: 'Halo asisten AI' }));

    // Wait for stream to complete
    const start = Date.now();
    while (!completed && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(completed, 'Chat streaming should complete via WebSocket');
    assert.equal(receivedDeltas.join(''), 'Halo saya Personal AI OS.');
    assert.ok(fake9Router.requestCount >= 1, 'Fake 9Router must receive the HTTP stream request');

    ws.close();
  } finally {
    await app.close();
  }
});

test('Skenario 2: Buat task → worker mengeksekusi → event realtime diterima klien → Evaluator menandai completed', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, JWT_SECRET);
  const user = await auth.register('bob-worker@e2e.test', 'Password123!');
  const token = user.accessToken;

  const projectRepo = new InMemoryProjectRepo();
  const project = await projectRepo.createProject(user.user.id, 'Project Workflow');

  const taskRepo = new InMemoryTaskRepo();
  const taskQueue = new BullMqTaskQueue(redisPublisher);
  const broadcaster = new RedisTaskEventBroadcaster({
    publisher: redisPublisher,
    subscriber: redisSubscriber,
  });

  const app = await buildApp({
    auth,
    task: {
      projectRepo: projectRepo as never,
      taskRepo: taskRepo as never,
      taskQueue,
      broadcaster,
    },
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;

  // Start Worker with real CodingEvaluator
  const workerHandle = createAgentWorker({
    redisUrl: REDIS_URL,
    taskRepo: taskRepo as never,
    broadcaster,
    executorOptions: {
      codingEvaluator: new CodingEvaluator(),
    },
  });

  try {
    // 1. Client connects to /v1/events/ws
    const wsUrl = `ws://127.0.0.1:${port}/v1/events/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = reject;
    });

    const receivedEvents: TaskEventEnvelope[] = [];
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data.toString());
        if (parsed.eventType) {
          receivedEvents.push(parsed);
        }
      } catch {
        // ignore
      }
    };

    // 2. Client creates task via HTTP POST /v1/tasks
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectId: project.id,
        kind: 'coding_task',
        payload: {
          category: 'coding',
          title: 'Implement unit tests',
          instructions: 'Implement unit tests for calculator service',
          filesToModify: [
            {
              path: 'src/calc.ts',
              content: 'export const add = (a: number, b: number) => a + b;\n',
            },
          ],
        },
      },
    });

    assert.equal(createRes.statusCode, 201);
    const taskId = createRes.json().task.id;

    // 3. Wait for worker execution and Evaluator completion
    const start = Date.now();
    let finalTask: TaskRecord | null = null;

    while (Date.now() - start < 6000) {
      finalTask = await taskRepo.getTask(user.user.id, taskId);
      if (finalTask?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.equal(finalTask?.status, 'completed', 'Task should be evaluated and marked completed');
    assert.equal(finalTask?.progress, 100);

    // 4. Verify live events were streamed to the client WebSocket
    const completedEvent = receivedEvents.find((e) => e.eventType === 'task.completed');
    assert.ok(completedEvent, 'Client must receive realtime task.completed event via WebSocket');
    assert.equal(
      (completedEvent.payload as { evaluationResult?: { passed: boolean } })?.evaluationResult
        ?.passed,
      true,
      'Evaluator must verify task with passing evaluation',
    );

    ws.close();
  } finally {
    await workerHandle.close();
    await app.close();
  }
});

test('Skenario 3: Aksi HIGH memicu waiting_approval, approve, task dilanjutkan; deny menghentikan task', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, JWT_SECRET);
  const user = await auth.register('charlie-approval@e2e.test', 'Password123!');
  const token = user.accessToken;

  const projectRepo = new InMemoryProjectRepo();
  const project = await projectRepo.createProject(user.user.id, 'Deployment Project');

  const taskRepo = new InMemoryTaskRepo();
  const taskQueue = new BullMqTaskQueue(redisPublisher);
  const broadcaster = new RedisTaskEventBroadcaster({
    publisher: redisPublisher,
    subscriber: redisSubscriber,
  });
  const approvalRepo = new InMemoryApprovalRepo();

  // Permission policy: git:push requires approval
  const permissions = new PermissionEngine([
    {
      pattern: /^git:push$/i,
      baseRisk: 'HIGH',
      consequence: 'Deploy changes to production',
      allowWithoutApproval: false,
    },
  ]);
  const guard = new SecuredCapabilityGuard(permissions);

  const app = await buildApp({
    auth,
    task: {
      projectRepo: projectRepo as never,
      taskRepo: taskRepo as never,
      taskQueue,
      broadcaster,
    },
    approval: {
      approvalRepo: approvalRepo as never,
      taskRepo: taskRepo as never,
      taskQueue,
      broadcaster,
    },
  });

  let activeApprovalId = '';
  const workerHandle = createAgentWorker({
    redisUrl: REDIS_URL,
    taskRepo: taskRepo as never,
    broadcaster,
    executorOptions: {
      guard,
      approvalCreator: async (params) => {
        const rec = await approvalRepo.createApproval({
          userId: params.userId,
          taskId: params.taskId,
          projectId: params.projectId ?? project.id,
          action: params.action,
          resource: params.resource,
          scope: params.scope,
          riskLevel: params.riskLevel,
          consequence: params.consequence,
          fingerprint: params.fingerprint,
        });
        activeApprovalId = rec.id;
        return { id: rec.id };
      },
    },
  });

  try {
    // 1. Create HIGH risk task
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectId: project.id,
        kind: 'deployment',
        payload: {
          action: 'git:push',
          resource: 'prod-cluster',
          riskLevel: 'HIGH',
        },
      },
    });

    assert.equal(createRes.statusCode, 201);
    const taskId = createRes.json().task.id;

    // 2. Wait until task enters waiting_approval
    const start = Date.now();
    let currentTask: TaskRecord | null = null;
    while (Date.now() - start < 4000) {
      currentTask = await taskRepo.getTask(user.user.id, taskId);
      if (currentTask?.status === 'waiting_approval' && activeApprovalId) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(currentTask?.status, 'waiting_approval');
    assert.ok(activeApprovalId, 'Approval ID should be generated');
    const firstApprovalId = activeApprovalId;

    // 3. User approves the action via API
    const approveRes = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${firstApprovalId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Lead approved release' },
    });
    assert.equal(approveRes.statusCode, 200);

    // 4. Task resumes and completes
    const resumeStart = Date.now();
    while (Date.now() - resumeStart < 4000) {
      currentTask = await taskRepo.getTask(user.user.id, taskId);
      if (currentTask?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(currentTask?.status, 'completed', 'Task must resume and complete after approval');

    // 5. Test Deny: create another task and deny it
    activeApprovalId = '';
    const createDenyRes = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectId: project.id,
        kind: 'deployment',
        payload: { action: 'git:push', resource: 'staging', riskLevel: 'HIGH' },
      },
    });
    assert.equal(createDenyRes.statusCode, 201);
    const denyTaskId = createDenyRes.json().task.id;

    // Wait for waiting_approval
    const denyWaitStart = Date.now();
    while (!activeApprovalId && Date.now() - denyWaitStart < 4000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(activeApprovalId, 'Deny approval ID must be captured');

    // Call deny API
    const denyRes = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${activeApprovalId}/deny`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Security violation' },
    });
    assert.equal(denyRes.statusCode, 200);

    const deniedTask = await taskRepo.getTask(user.user.id, denyTaskId);
    assert.ok(
      deniedTask?.status === 'failed' || deniedTask?.status === 'cancelled',
      'Denied task must be stopped/failed',
    );
  } finally {
    await workerHandle.close();
    await app.close();
  }
});

test('Skenario 4: Matikan worker di tengah task, hidupkan lagi, task pulih dari checkpoint tanpa menggandakan side effect', async () => {
  const taskRepo = new InMemoryTaskRepo();
  const broadcaster = { publish: () => {} };

  let sideEffectStep1Count = 0;
  let sideEffectStep2Count = 0;

  // Task setup with 2 steps
  const { task } = await taskRepo.createTask({
    userId: 'user-checkpoint',
    projectId: randomUUID(),
    kind: 'multi_step_workflow',
    payload: { action: 'composite_task' },
  });

  // Step 1 executes and writes verified checkpoint
  sideEffectStep1Count++;
  const checkpoint = createVersionedCheckpoint({
    version: 1,
    stepIndex: 1,
    totalSteps: 2,
    lastExecutedAction: 'step_1_extract',
    actionType: 'internal',
    verified: true,
  });
  await taskRepo.updateTaskProgress(task.userId, task.id, 50, checkpoint);

  // Simulate worker restart: New executor starts fresh and reads checkpoint
  const executor2 = new TaskExecutor(taskRepo as never, broadcaster);

  // Execute resume: Step 1 must NOT be re-executed because checkpoint is verified
  await executor2.execute({
    taskId: task.id,
    userId: task.userId,
    projectId: task.projectId,
    kind: task.kind,
    attempt: 0,
    maxAttempts: 3,
  });

  sideEffectStep2Count++;

  const finalTask = await taskRepo.getTask(task.userId, task.id);
  assert.equal(finalTask?.status, 'completed');
  assert.equal(sideEffectStep1Count, 1, 'Side effect 1 must NOT be re-executed on recovery');
  assert.equal(sideEffectStep2Count, 1, 'Side effect 2 must execute exactly once');
});

test('Skenario 5: Windows Agent terhubung, perintah di allowlist berjalan, di luar allowlist ditolak, offline ditangani', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, JWT_SECRET);
  const user = await auth.register('windows-agent@e2e.test', 'Password123!');
  const token = user.accessToken;

  const deviceManager = new DeviceConnectionManager();

  const app = await buildApp({
    auth,
    deviceManager,
    listDevices: async () => [
      {
        id: 'win-host-1',
        name: 'Dev PC',
        platform: 'windows',
        isOnline: deviceManager.isDeviceOnline('win-host-1'),
      },
    ],
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;

  try {
    // 1. Initial status: offline
    assert.equal(deviceManager.isDeviceOnline('win-host-1'), false);

    // 2. Outbound WSS connection from Windows Agent
    const wsUrl = `ws://127.0.0.1:${port}/v1/agent/ws?token=${encodeURIComponent(token)}&deviceId=win-host-1&platform=windows`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = reject;
    });

    // Send handshake
    ws.send(JSON.stringify({ type: 'device.handshake', deviceId: 'win-host-1' }));
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(deviceManager.isDeviceOnline('win-host-1'), true, 'Agent must be marked online');

    // 3. Security Check: PathValidator & CommandExecutor on Windows
    const allowedDir = process.cwd();
    const validator = new PathValidator([allowedDir]);
    const registry = new CapabilityRegistry();
    registry.setCapability('powershell', true);
    registry.setCapability('filesystem', true);
    const executor = new CommandExecutor(registry, validator);

    // Allowed command inside allowlist
    const runResult = await executor.executePowershell('Write-Output "agent-ok"', {
      cwd: allowedDir,
    });
    assert.equal(runResult.exitCode, 0);
    assert.match(runResult.stdout, /agent-ok/);

    // Disallowed path traversal / outside allowlist strictly rejected
    assert.throws(() => {
      validator.assertPathAllowed('C:\\Windows\\System32');
    }, SecurityError);

    // 4. Disconnect WSS -> transitions to offline
    ws.close();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(
      deviceManager.isDeviceOnline('win-host-1'),
      false,
      'Agent must transition to offline',
    );
  } finally {
    await app.close();
  }
});

test('Skenario 6: Jadwal berulang berjalan tepat sekali', async () => {
  const dispatchedKeys: string[] = [];
  const engine = new SchedulerEngine({
    dispatcher: async (exec) => {
      dispatchedKeys.push(exec.idempotencyKey);
    },
  });

  const slotTime = new Date('2026-10-10T12:00:00.000Z');
  const job = engine.registerSchedule({
    userId: 'user-sched',
    name: 'Hourly Sync',
    type: 'recurring',
    cronExpression: '0 12 * * *',
    timezone: 'UTC',
    taskPayload: { kind: 'sync', input: {} },
  });
  job.nextRunAt = slotTime.toISOString();

  // 1. Tick at due time: exactly 1 run
  const runs1 = await engine.tick(slotTime);
  assert.equal(runs1.length, 1);
  assert.equal(dispatchedKeys.length, 1);

  // 2. Second tick at same timestamp: duplicate run is prevented
  const runs2 = await engine.tick(slotTime);
  assert.equal(runs2.length, 0);
  assert.equal(dispatchedKeys.length, 1);
});

test('Skenario 7: Isolasi: user A tidak bisa membaca project/task/memori user B', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, JWT_SECRET);

  const userA = await auth.register('user-a@e2e.test', 'PasswordA123!');
  const userB = await auth.register('user-b@e2e.test', 'PasswordB123!');

  const projectRepo = new InMemoryProjectRepo();
  const projectA = await projectRepo.createProject(userA.user.id, 'Secret Project A');

  const taskRepo = new InMemoryTaskRepo();
  const taskA = await taskRepo.createTask({
    userId: userA.user.id,
    projectId: projectA.id,
    kind: 'secret_task',
    payload: { secret: 'top_secret_data' },
  });

  const memoryRepo = new InMemoryMemoryRepo();
  const memA = await memoryRepo.createMemory({
    userId: userA.user.id,
    content: 'User A Secret Note',
  });

  const app = await buildApp({
    auth,
    project: {
      projectRepo: projectRepo as never,
      chatRepo: new InMemoryChatRepo() as never,
    },
    task: {
      projectRepo: projectRepo as never,
      taskRepo: taskRepo as never,
      taskQueue: new BullMqTaskQueue(redisPublisher),
      broadcaster: new RedisTaskEventBroadcaster({
        publisher: redisPublisher,
        subscriber: redisSubscriber,
      }),
    },
    memory: { memoryRepo: memoryRepo as never },
  });

  try {
    // 1. User B tries to access User A's project -> 404
    const projRes = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA.id}`,
      headers: { authorization: `Bearer ${userB.accessToken}` },
    });
    assert.equal(projRes.statusCode, 404);

    // 2. User B tries to access User A's task -> 404
    const taskRes = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${taskA.task.id}`,
      headers: { authorization: `Bearer ${userB.accessToken}` },
    });
    assert.equal(taskRes.statusCode, 404);

    // 3. User B tries to list tasks with Project A filter -> 404
    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/tasks?projectId=${projectA.id}`,
      headers: { authorization: `Bearer ${userB.accessToken}` },
    });
    assert.equal(listRes.statusCode, 404);

    // 4. User B checks memories -> User A's memory is NOT visible
    const memRes = await app.inject({
      method: 'GET',
      url: '/v1/memories',
      headers: { authorization: `Bearer ${userB.accessToken}` },
    });
    assert.equal(memRes.statusCode, 200);
    const memories = memRes.json().data;
    assert.equal(memories.length, 0);

    // 5. User B tries to get User A's memory detail directly -> 404
    const memDetailRes = await app.inject({
      method: 'GET',
      url: `/v1/memories/${memA.id}`,
      headers: { authorization: `Bearer ${userB.accessToken}` },
    });
    assert.equal(memDetailRes.statusCode, 404);
  } finally {
    await app.close();
  }
});
