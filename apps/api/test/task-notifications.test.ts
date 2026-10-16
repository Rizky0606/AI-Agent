import assert from 'node:assert/strict';
import test from 'node:test';
import { MockFcmProvider, NotificationEngine } from '@personal-ai-os/scheduler';
import type { NotificationPreferences, NotificationRecord } from '@personal-ai-os/scheduler';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { createTaskNotificationListener } from '../src/services/task-notifications.ts';

interface RecordingStorage {
  records: Map<string, NotificationRecord>;
  preferences: Map<string, NotificationPreferences>;
  save(record: NotificationRecord): void;
  waitForRecord(predicate: (record: NotificationRecord) => boolean): Promise<NotificationRecord>;
}

const createStorage = (): RecordingStorage => {
  const records = new Map<string, NotificationRecord>();
  const preferences = new Map<string, NotificationPreferences>();
  const waiters: Array<{
    predicate: (record: NotificationRecord) => boolean;
    resolve: (record: NotificationRecord) => void;
  }> = [];

  const store = (record: NotificationRecord): void => {
    records.set(record.id, { ...record });
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index];
      if (waiter?.predicate(record)) {
        waiters.splice(index, 1);
        waiter.resolve(record);
      }
    }
  };

  return {
    records,
    preferences,
    save: store,
    waitForRecord: (predicate) => {
      for (const record of records.values()) {
        if (predicate(record)) return Promise.resolve(record);
      }
      const { promise, resolve } = Promise.withResolvers<NotificationRecord>();
      waiters.push({ predicate, resolve });
      return promise;
    },
  };
};

const buildEngine = (
  storage: RecordingStorage,
  options?: { deviceTokens?: string[] | undefined; fcmProvider?: MockFcmProvider | undefined },
): NotificationEngine =>
  new NotificationEngine({
    fcmProvider: options?.fcmProvider ?? { sendPushNotification: async () => ({ success: true }) },
    resolveDeviceTokens: async () => options?.deviceTokens ?? [],
    storage: {
      saveNotification: async (record: NotificationRecord) => {
        storage.save(record);
      },
      updateNotification: async (record: NotificationRecord) => {
        storage.save(record);
      },
      getNotification: async (id: string) => storage.records.get(id) ?? null,
      listNotifications: async (userId: string) =>
        Array.from(storage.records.values()).filter((r) => r.userId === userId),
      getUserPreferences: async (userId: string) => storage.preferences.get(userId) ?? null,
      saveUserPreferences: async (userId: string, preferences: NotificationPreferences) => {
        storage.preferences.set(userId, preferences);
      },
    },
  });

test('Task events become notification rows for terminal outcomes only', async () => {
  const storage = createStorage();
  const broadcaster = new InMemoryTaskEventBroadcaster();
  const failures: unknown[] = [];
  broadcaster.subscribe(
    createTaskNotificationListener({
      notificationEngine: buildEngine(storage),
      onError: (err) => failures.push(err),
    }),
  );

  broadcaster.publish({
    id: 'evt-1',
    taskId: 'task-1',
    userId: 'user-1',
    eventType: 'task.progress',
    payload: { progress: 50 },
    createdAt: new Date().toISOString(),
  });
  broadcaster.publish({
    id: 'evt-2',
    taskId: 'task-1',
    userId: 'user-1',
    eventType: 'task.completed',
    payload: { result: 'Perintah selesai dengan exit code 0' },
    createdAt: new Date().toISOString(),
  });

  const record = await storage.waitForRecord(
    (candidate) => candidate.type === 'task_completed' && candidate.deliveryState === 'delivered',
  );
  assert.equal(storage.records.size, 1, 'hanya hasil akhir yang boleh menghasilkan notifikasi');
  assert.equal(record.userId, 'user-1');
  assert.equal(record.body, 'Perintah selesai dengan exit code 0');
  assert.equal(record.deepLink, 'personal-ai://tasks/task-1');
  assert.equal(record.deliveryState, 'delivered');
  assert.deepEqual(failures, []);
});

test('Approval and failure events carry the deep link that opens the right screen', async () => {
  const storage = createStorage();
  const broadcaster = new InMemoryTaskEventBroadcaster();
  broadcaster.subscribe(
    createTaskNotificationListener({
      notificationEngine: buildEngine(storage),
      onError: (err) => {
        throw err;
      },
    }),
  );

  broadcaster.publish({
    id: 'evt-3',
    taskId: 'task-2',
    userId: 'user-2',
    eventType: 'task.waiting_approval',
    payload: { approvalId: 'appr-9', consequence: 'Menghapus direktori kerja' },
    createdAt: new Date().toISOString(),
  });
  broadcaster.publish({
    id: 'evt-4',
    taskId: 'task-3',
    userId: 'user-2',
    eventType: 'task.failed',
    payload: { error: 'Runtime menolak perintah' },
    createdAt: new Date().toISOString(),
  });

  const approval = await storage.waitForRecord((candidate) => candidate.type === 'approval_required');
  const failure = await storage.waitForRecord((candidate) => candidate.type === 'task_failed');
  assert.equal(approval.deepLink, 'personal-ai://approvals/appr-9');
  assert.equal(approval.body, 'Menghapus direktori kerja');
  assert.equal(failure.body, 'Runtime menolak perintah');
  assert.equal(failure.deepLink, 'personal-ai://tasks/task-3');
});

test('Push delivery uses tokens from the device registry, not a fabricated one', async () => {
  const storage = createStorage();
  const fcm = new MockFcmProvider();
  const engine = buildEngine(storage, { deviceTokens: ['device-token-from-db'], fcmProvider: fcm });

  const record = await engine.dispatchNotification({
    userId: 'user-3',
    type: 'task_completed',
    title: 'Task selesai',
    body: 'Selesai',
    data: { taskId: 'task-4' },
  });

  assert.equal(record.deliveryState, 'delivered');
  assert.equal(fcm.sentMessages.length, 1);
  assert.equal(fcm.sentMessages[0]?.deviceToken, 'device-token-from-db');
});
