import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';
import { DeepLinkService } from '../src/services/deep-link.ts';
import { FcmService, type PushNotificationPayload } from '../src/services/fcm-service.ts';
import { useUiStore } from '../src/state/ui-store.ts';

test('Task operations: pause, resume, cancel, and progress lifecycle', async () => {
  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('task-user-token');

  let lastAction: string | null = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input.toString();

    if (url.endsWith('/v1/tasks/task-001/pause')) {
      lastAction = 'pause';
      return new Response(JSON.stringify({ id: 'task-001', status: 'paused', progress: 25 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.endsWith('/v1/tasks/task-001/resume')) {
      lastAction = 'resume';
      return new Response(JSON.stringify({ id: 'task-001', status: 'running', progress: 25 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.endsWith('/v1/tasks/task-001/cancel')) {
      lastAction = 'cancel';
      return new Response(JSON.stringify({ id: 'task-001', status: 'cancelled', progress: 25 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  };

  try {
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });

    const paused = await client.pauseTask('task-001');
    assert.equal(lastAction, 'pause');
    assert.equal(paused.status, 'paused');

    const resumed = await client.resumeTask('task-001');
    assert.equal(lastAction, 'resume');
    assert.equal(resumed.status, 'running');

    const cancelled = await client.cancelTask('task-001');
    assert.equal(lastAction, 'cancel');
    assert.equal(cancelled.status, 'cancelled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Deep link parser correctly resolves custom scheme and HTTPS URLs', () => {
  const chatLink = DeepLinkService.parseUrl('personal-ai://chat/conv-abc-123');
  assert.deepEqual(chatLink, { screen: 'Chat', conversationId: 'conv-abc-123' });

  const approvalLink = DeepLinkService.parseUrl('personal-ai://approvals/appr-xyz-789');
  assert.deepEqual(approvalLink, { screen: 'ApprovalDetail', approvalId: 'appr-xyz-789' });

  const taskLink = DeepLinkService.parseUrl('personal-ai://tasks/task-456');
  assert.deepEqual(taskLink, { screen: 'TaskDetail', taskId: 'task-456' });

  const webLink = DeepLinkService.parseUrl('https://personal-ai.app/tasks/task-789');
  assert.deepEqual(webLink, { screen: 'TaskDetail', taskId: 'task-789' });

  const unknownLink = DeepLinkService.parseUrl('personal-ai://unknown/route/123');
  assert.equal(unknownLink?.screen, 'Unknown');
});

test('FCM integration point: registers device push token and dispatches notifications', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ device: { id: 'dev-1', name: 'Android', platform: 'android' } }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      },
    );

  try {
    const storage = new InMemoryTokenStorage();
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });
    const fcm = new FcmService(client);

    let receivedPayload: PushNotificationPayload | null = null;
    const unsubscribe = fcm.onNotificationReceived((payload) => {
      receivedPayload = payload;
    });

    // 1. Register FCM token
    await fcm.registerToken('fcm-token-test-123456789');
    assert.equal(useUiStore.getState().fcmToken, 'fcm-token-test-123456789');

    // 2. Dispatch notification
    fcm.dispatchNotification({
      title: 'Persetujuan Diperlukan',
      body: 'Tugas #task-01 membutuhkan persetujuan Anda',
      data: {
        type: 'approval_required',
        approvalId: 'appr-999',
        deepLink: 'personal-ai://approvals/appr-999',
      },
    });

    assert.ok(receivedPayload);
    const payload: PushNotificationPayload = receivedPayload;
    assert.equal(payload.title, 'Persetujuan Diperlukan');
    assert.equal(payload.data?.approvalId, 'appr-999');

    // 3. Category preference filtering
    useUiStore.getState().setNotifyBlockers(false);
    receivedPayload = null;

    const blockerDispatched = fcm.dispatchNotification({
      title: 'Blocker Terjadi',
      body: 'Perangkat offline',
      data: { type: 'blocker', taskId: 't-block' },
    });
    // Should be filtered out because notifyBlockers is false
    assert.equal(blockerDispatched, false);
    assert.equal(receivedPayload, null);

    // Re-enable and verify it is received
    useUiStore.getState().setNotifyBlockers(true);
    const blockerReceived = fcm.dispatchNotification({
      title: 'Blocker Terjadi',
      body: 'Perangkat offline',
      data: { type: 'blocker', taskId: 't-block' },
    });
    assert.equal(blockerReceived, true);
    assert.ok(receivedPayload);

    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
