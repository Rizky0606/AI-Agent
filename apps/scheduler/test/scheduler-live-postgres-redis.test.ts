import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { PermissionEngine } from '@personal-ai-os/permissions';
import {
  CronParser,
  DisabledFcmProvider,
  EventEngine,
  NotificationEngine,
  PostgresNotificationStorage,
  createFcmProviderFromEnv,
  resolveDatabaseUrl,
  resolveRedisUrl,
  startSchedulerProcess,
} from '../src/index.ts';

const databaseUrl = resolveDatabaseUrl();
const redisUrl = resolveRedisUrl();

let isPostgresAvailable = false;
let isRedisAvailable = false;
let testSql: postgres.Sql | undefined;
let testRedis: Redis | undefined;

const testUserId = randomUUID();
const testProjectId = randomUUID();

before(async () => {
  try {
    testSql = postgres(databaseUrl, { max: 2, connect_timeout: 3 });
    const res = await testSql`SELECT 1 as ok`;
    if (res[0]?.ok === 1) {
      isPostgresAvailable = true;
    }
  } catch (err) {
    console.warn('[test] Postgres not reachable for live scheduler tests:', err);
  }

  try {
    testRedis = new Redis(redisUrl, { connectTimeout: 3000, maxRetriesPerRequest: null });
    const ping = await testRedis.ping();
    if (ping === 'PONG') {
      isRedisAvailable = true;
    }
  } catch (err) {
    console.warn('[test] Redis not reachable for live scheduler tests:', err);
  }

  if (isPostgresAvailable && testSql) {
    // Seed test user and project for foreign keys
    await testSql`
      INSERT INTO users (id, email, password_hash)
      VALUES (${testUserId}, ${`user-${testUserId}@scheduler-test.local`}, 'hash')
      ON CONFLICT DO NOTHING
    `;
    await testSql`
      INSERT INTO projects (id, user_id, name)
      VALUES (${testProjectId}, ${testUserId}, 'Scheduler Live Test Project')
      ON CONFLICT DO NOTHING
    `;
  }
});

after(async () => {
  if (isPostgresAvailable && testSql) {
    try {
      await testSql`DELETE FROM notifications WHERE user_id = ${testUserId}`;
      await testSql`DELETE FROM tasks WHERE user_id = ${testUserId}`;
      await testSql`DELETE FROM schedules WHERE user_id = ${testUserId}`;
      await testSql`DELETE FROM projects WHERE id = ${testProjectId}`;
      await testSql`DELETE FROM users WHERE id = ${testUserId}`;
      await testSql.end({ timeout: 5 });
    } catch {
      // Cleanup best effort
    }
  }
  if (testRedis) {
    try {
      await testRedis.quit();
    } catch {
      // Cleanup best effort
    }
  }
});

test('Live Postgres & Redis: Recurring schedule executes exactly once per slot and enqueues to shared BullMQ queue', async (t) => {
  if (!isPostgresAvailable || !isRedisAvailable || !testSql || !testRedis) {
    t.skip('Live PostgreSQL and Redis required for this test');
    return;
  }

  const handle = await startSchedulerProcess({
    databaseUrl,
    redisUrl,
    autoStartLoop: false,
  });

  try {
    const jobName = `Live Recurring Test ${Date.now()}`;
    const targetSlot = new Date('2026-10-10T14:00:00.000Z');

    const job = handle.schedulerEngine.registerSchedule({
      userId: testUserId,
      projectId: testProjectId,
      name: jobName,
      type: 'recurring',
      cronExpression: '0 14 * * *', // Every day at 14:00 UTC
      timezone: 'UTC',
      missedRunPolicy: 'skip',
      taskPayload: {
        kind: 'system-backup',
        input: { target: 'database', userId: testUserId, projectId: testProjectId },
        priority: 5,
      },
    });

    // Manually set nextRunAt to targetSlot to test execution
    job.nextRunAt = targetSlot.toISOString();
    await handle.scheduleStorage.saveJob(job);

    // 1. Tick at due time -> Executes exactly once
    const now1 = new Date('2026-10-10T14:00:01.000Z');
    const runs1 = await handle.tick(now1);

    assert.equal(runs1.length, 1);
    const expectedIdempotencyKey = `sched:${job.id}:${targetSlot.toISOString()}`;
    assert.equal(runs1[0]?.idempotencyKey, expectedIdempotencyKey);

    // Verify task is persisted in PostgreSQL tasks table
    const [taskInDb] = await testSql`
      SELECT id, user_id, project_id, status, kind, idempotency_key, priority
      FROM tasks
      WHERE user_id = ${testUserId} AND idempotency_key = ${expectedIdempotencyKey}
      LIMIT 1
    `;
    assert.ok(taskInDb);
    assert.equal(taskInDb.kind, 'system-backup');
    assert.equal(Number(taskInDb.priority), 5);

    // Verify schedule record in PostgreSQL has updated last_run_at and next_run_at
    const [scheduleInDb] = await testSql`
      SELECT id, last_run_at, next_run_at
      FROM schedules
      WHERE id = ${job.id}
      LIMIT 1
    `;
    assert.ok(scheduleInDb?.last_run_at);
    assert.ok(scheduleInDb?.next_run_at);
    const nextSlot = CronParser.getNextRun('0 14 * * *', now1, 'UTC');
    assert.equal(new Date(scheduleInDb.next_run_at).toISOString(), nextSlot.toISOString());

    // 2. Second tick at same time -> Does NOT re-execute (no duplicate run)
    const runs2 = await handle.tick(now1);
    assert.equal(runs2.length, 0);

    // Verify task count in database remains exactly 1
    const tasksCount = await testSql`
      SELECT COUNT(*)::int as count
      FROM tasks
      WHERE user_id = ${testUserId} AND idempotency_key = ${expectedIdempotencyKey}
    `;
    assert.equal(tasksCount[0]?.count, 1);
  } finally {
    await handle.close();
  }
});

test('Live Postgres & Redis: Restarting scheduler does NOT duplicate executions for already executed slots', async (t) => {
  if (!isPostgresAvailable || !isRedisAvailable || !testSql || !testRedis) {
    t.skip('Live PostgreSQL and Redis required for this test');
    return;
  }

  const slotTime = new Date('2026-10-10T15:00:00.000Z');

  // 1. Initial scheduler instance starts, creates schedule, and executes slot
  const handle1 = await startSchedulerProcess({
    databaseUrl,
    redisUrl,
    autoStartLoop: false,
  });

  let scheduleId: string;
  try {
    const job = handle1.schedulerEngine.registerSchedule({
      userId: testUserId,
      projectId: testProjectId,
      name: 'Restart Idempotency Test',
      type: 'recurring',
      cronExpression: '0 15 * * *', // Daily at 15:00 UTC
      timezone: 'UTC',
      missedRunPolicy: 'skip',
      taskPayload: {
        kind: 'restart-check',
        input: { userId: testUserId, projectId: testProjectId },
      },
    });
    scheduleId = job.id;
    job.nextRunAt = slotTime.toISOString();
    await handle1.scheduleStorage.saveJob(job);

    const now = new Date('2026-10-10T15:00:01.000Z');
    const runs = await handle1.tick(now);
    assert.equal(runs.length, 1);
  } finally {
    // 2. Simulate process crash / restart: shutdown instance 1
    await handle1.close();
  }

  // 3. New scheduler process boots up from cold start, loading from PostgreSQL
  const handle2 = await startSchedulerProcess({
    databaseUrl,
    redisUrl,
    autoStartLoop: false,
  });

  try {
    // Verify schedule was restored from PostgreSQL in active state with next slot
    const loadedJob = handle2.schedulerEngine.getJob(scheduleId);
    assert.ok(loadedJob);
    assert.equal(loadedJob.status, 'active');

    // 4. Tick immediately after restart at the same time:
    // MUST NOT execute duplicate run!
    const restartNow = new Date('2026-10-10T15:00:05.000Z');
    const duplicateRuns = await handle2.tick(restartNow);
    assert.equal(duplicateRuns.length, 0);

    // 5. Even if nextRunAt was forced back to the past slot (simulating crash before schedule DB update),
    // the DB-level idempotency key prevents re-enqueueing duplicate tasks!
    await handle2.scheduleStorage.saveJob({
      ...loadedJob,
      nextRunAt: slotTime.toISOString(),
    });
    loadedJob.nextRunAt = slotTime.toISOString();

    const runsAfterSimulatedCrash = await handle2.tick(restartNow);
    assert.equal(runsAfterSimulatedCrash.length, 1);

    // Database task count for this idempotency key must be exactly 1
    const tasksCount = await testSql`
      SELECT COUNT(*)::int as count
      FROM tasks
      WHERE user_id = ${testUserId} AND idempotency_key = ${runsAfterSimulatedCrash[0]?.idempotencyKey}
    `;
    assert.equal(tasksCount[0]?.count, 1);
  } finally {
    await handle2.close();
  }
});

test('Live Postgres: Notification Engine persists delivery states in PostgreSQL and enforces bounded retries', async (t) => {
  if (!isPostgresAvailable || !testSql) {
    t.skip('Live PostgreSQL required for this test');
    return;
  }

  const notificationStorage = new PostgresNotificationStorage(testSql);

  // FCM provider with disabled status (unconfigured FCM_SERVICE_ACCOUNT_JSON)
  const disabledFcm = new DisabledFcmProvider(
    'FCM_SERVICE_ACCOUNT_JSON missing: push delivery disabled for testing',
  );

  const engine = new NotificationEngine({
    fcmProvider: disabledFcm,
    storage: notificationStorage,
    maxRetryAttempts: 3,
  });

  const testTaskId = randomUUID();
  const notif = await engine.dispatchNotification({
    userId: testUserId,
    type: 'approval_required',
    title: 'Persetujuan Diperlukan',
    body: 'Aksi HIGH risk membutuhkan persetujuan Anda',
    data: {
      taskId: testTaskId,
      approvalId: 'appr-live-123',
    },
    deviceToken: 'device-token-fcm-test',
  });

  // Since FCM is disabled, provider returns unrecoverable error and transitions to failed state without infinite loop
  assert.equal(notif.deliveryState, 'failed');
  assert.equal(notif.deepLink, 'personal-ai://approvals/appr-live-123');

  // Verify delivery state is persisted in PostgreSQL notifications table
  const notifInDb = await notificationStorage.getNotification(notif.id);
  assert.ok(notifInDb);
  assert.equal(notifInDb.userId, testUserId);
  assert.equal(notifInDb.type, 'approval_required');
  assert.equal(notifInDb.deliveryState, 'failed');
  assert.equal(notifInDb.deepLink, 'personal-ai://approvals/appr-live-123');
  assert.match(notifInDb.lastError ?? '', /push delivery disabled/i);

  // Update notification state to 'read'
  await engine.markAsRead(notif.id);
  const updatedInDb = await notificationStorage.getNotification(notif.id);
  assert.equal(updatedInDb?.deliveryState, 'read');
  assert.ok(updatedInDb?.readAt);
});

test('Live Postgres: FCM provider honors FCM_SERVICE_ACCOUNT_JSON and disables safely if missing without silent mock', () => {
  // 1. When FCM_SERVICE_ACCOUNT_JSON is unset
  const oldEnv = process.env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    delete process.env.FCM_SERVICE_ACCOUNT_PATH;

    const provider = createFcmProviderFromEnv();
    assert.ok(provider instanceof DisabledFcmProvider);
    assert.match(provider.reason, /tidak dikonfigurasi/i);
  } finally {
    if (oldEnv) process.env.FCM_SERVICE_ACCOUNT_JSON = oldEnv;
  }
});

test('EventEngine: validates envelopes, deduplicates duplicate events, and enforces Permission Engine on event-triggered tasks', async () => {
  const permissionEngine = new PermissionEngine();
  const createdTasks: Array<{ ruleId: string; decision: string }> = [];

  const engine = new EventEngine({
    permissionEngine,
    taskDispatcher: async ({ ruleId, decision }) => {
      createdTasks.push({ ruleId, decision: decision.decision });
      return `task-${Date.now()}`;
    },
  });

  // Rule 1: Safe Low-Risk
  engine.registerRule({
    id: 'rule-low-audit',
    name: 'Audit on task complete',
    eventType: 'task.completed',
    targetAction: {
      action: 'fs:read',
      resource: 'workspace://audit',
      scope: 'workspace',
      riskLevel: 'LOW',
    },
    createTaskPayload: () => ({ kind: 'audit', input: {} }),
  });

  // Rule 2: High Risk deploy action -> requires approval per Permission Engine
  engine.registerRule({
    id: 'rule-high-deploy',
    name: 'Deploy on webhook trigger',
    eventType: 'webhook.trigger',
    targetAction: {
      action: 'deploy:production',
      resource: 'server://production',
      scope: 'production',
      riskLevel: 'HIGH',
    },
    createTaskPayload: () => ({ kind: 'deploy', input: {} }),
  });

  // 1. Process Low-Risk event
  const res1 = await engine.processEvent({
    id: 'evt-audit-1',
    source: 'internal:pipeline',
    type: 'task.completed',
    timestamp: new Date().toISOString(),
    payload: { ok: true },
  });
  assert.equal(res1.accepted, true);
  assert.equal(res1.dispatchedTasks[0]?.permissionDecision, 'allow');
  assert.equal(res1.dispatchedTasks[0]?.approvalRequired, false);

  // 2. Duplicate event within dedupe window is rejected
  const resDuplicate = await engine.processEvent({
    id: 'evt-audit-1',
    source: 'internal:pipeline',
    type: 'task.completed',
    timestamp: new Date().toISOString(),
    payload: { ok: true },
  });
  assert.equal(resDuplicate.accepted, false);
  assert.equal(resDuplicate.duplicate, true);

  // 3. Process Critical-Risk event -> Permission Engine enforces require_approval
  const resCritical = await engine.processEvent({
    id: 'evt-crit-1',
    source: 'external:webhook',
    type: 'webhook.trigger',
    timestamp: new Date().toISOString(),
    payload: { cmd: 'reboot' },
  });
  assert.equal(resCritical.accepted, true);
  assert.equal(resCritical.dispatchedTasks[0]?.permissionDecision, 'require_approval');
  assert.equal(resCritical.dispatchedTasks[0]?.approvalRequired, true);
});
