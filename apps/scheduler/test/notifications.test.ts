import assert from 'node:assert/strict';
import test from 'node:test';
import { MockFcmProvider } from '../src/fcm-provider.ts';
import { NotificationEngine } from '../src/notification-engine.ts';

test('NotificationEngine: generates correct deep links for approvals, tasks, and blockers', () => {
  // 1. Approval deep link
  const approvalLink = NotificationEngine.buildDeepLink('approval_required', {
    approvalId: 'appr-999',
  });
  assert.equal(approvalLink, 'personal-ai://approvals/appr-999');

  // 2. Task completed deep link
  const taskLink = NotificationEngine.buildDeepLink('task_completed', {
    taskId: 'task-777',
  });
  assert.equal(taskLink, 'personal-ai://tasks/task-777');

  // 3. Blocker deep link
  const blockerLink = NotificationEngine.buildDeepLink('blocker', {
    taskId: 'task-888',
  });
  assert.equal(blockerLink, 'personal-ai://tasks/task-888');
});

test('NotificationEngine: deduplicates rapid duplicate notifications within window', async () => {
  const fcm = new MockFcmProvider();
  const engine = new NotificationEngine({ fcmProvider: fcm, dedupeWindowMs: 5000 });

  const input = {
    userId: 'user-1',
    type: 'task_completed' as const,
    title: 'Task Selesai',
    body: 'Task #123 telah selesai dijalankan',
    data: { taskId: 't-123' },
    deviceToken: 'token-abc',
  };

  // 1. First dispatch delivers
  const notif1 = await engine.dispatchNotification(input);
  assert.equal(notif1.deliveryState, 'delivered');
  assert.equal(fcm.sentMessages.length, 1);

  // 2. Immediate duplicate dispatch returns existing and does NOT spam FCM
  const notif2 = await engine.dispatchNotification(input);
  assert.equal(notif2.id, notif1.id);
  assert.equal(fcm.sentMessages.length, 1);
});

test('NotificationEngine: respects user category preferences and quiet hours', async () => {
  const fcm = new MockFcmProvider();
  const engine = new NotificationEngine({ fcmProvider: fcm });

  engine.setUserPreferences('user-quiet', {
    enabled: true,
    channels: { push: true, websocket: true },
    quietHours: {
      enabled: true,
      start: '22:00',
      end: '07:00',
      timezone: 'UTC',
    },
    categories: {
      approvalRequired: true,
      taskCompleted: false, // User disabled taskCompleted notifications
      taskFailed: true,
      blocker: true,
    },
  });

  // 1. Category disabled -> marked as skipped
  const skippedNotif = await engine.dispatchNotification({
    userId: 'user-quiet',
    type: 'task_completed',
    title: 'Task Done',
    body: 'Finished background sync',
    data: { taskId: 't-99' },
    deviceToken: 'tok-1',
  });
  assert.equal(skippedNotif.deliveryState, 'skipped');
  assert.equal(fcm.sentMessages.length, 0);

  // 2. Urgent approval notification still goes through even during quiet hours
  const urgentNotif = await engine.dispatchNotification({
    userId: 'user-quiet',
    type: 'approval_required',
    title: 'Approval Required',
    body: 'Deploy to production requires your confirmation',
    data: { approvalId: 'appr-1' },
    deviceToken: 'tok-1',
  });
  assert.equal(urgentNotif.deliveryState, 'delivered');
  assert.equal(fcm.sentMessages.length, 1);
});

test('NotificationEngine: handles delivery states and retries with backoff on transient failure', async () => {
  const fcm = new MockFcmProvider();
  fcm.failureMode = 'transient_fail_then_succeed';
  fcm.failuresBeforeSuccess = 2; // Fails attempts 1 & 2, succeeds on attempt 3

  const engine = new NotificationEngine({
    fcmProvider: fcm,
    maxRetryAttempts: 3,
  });

  const notif = await engine.dispatchNotification({
    userId: 'user-retry',
    type: 'blocker',
    title: 'Task Terhenti',
    body: 'Windows Agent offline',
    data: { taskId: 't-300' },
    deviceToken: 'device-token-retry',
  });

  // Should succeed on attempt 3
  assert.equal(notif.deliveryState, 'delivered');
  assert.equal(notif.attempts, 3);
  assert.ok(notif.deliveredAt);

  // Mark as read
  const readNotif = engine.markAsRead(notif.id);
  assert.equal(readNotif?.deliveryState, 'read');
  assert.ok(readNotif?.readAt);
});

test('NotificationEngine: caps retry loop and transitions to failed state on persistent failure', async () => {
  const fcm = new MockFcmProvider();
  fcm.failureMode = 'always_fail';

  const engine = new NotificationEngine({
    fcmProvider: fcm,
    maxRetryAttempts: 3,
  });

  const notif = await engine.dispatchNotification({
    userId: 'user-fail',
    type: 'task_failed',
    title: 'Task Gagal',
    body: 'Build timeout',
    data: { taskId: 't-fail' },
    deviceToken: 'device-token-broken',
  });

  // Exactly capped at maxAttempts: 3 (Rule 10)
  assert.equal(notif.deliveryState, 'failed');
  assert.equal(notif.attempts, 3);
  assert.match(notif.lastError ?? '', /503 Service Unavailable/i);
});
