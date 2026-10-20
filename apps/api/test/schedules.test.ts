import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { EventEngine, NotificationEngine, SchedulerEngine } from '@personal-ai-os/scheduler';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Schedules, Events, and Notifications API integration', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const authResult = await auth.register('alice-sched@example.com', 'ValidPassword123!');
  const userId = authResult.user.id;
  const token = authResult.accessToken;

  const schedulerEngine = new SchedulerEngine();
  const eventEngine = new EventEngine();
  const notificationEngine = new NotificationEngine();

  const app = await buildApp({
    auth,
    schedules: {
      schedulerEngine,
      eventEngine,
      notificationEngine,
    },
  });

  // 1. Create a recurring schedule
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/schedules',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Daily Morning Briefing',
      type: 'recurring',
      cronExpression: '0 8 * * *',
      timezone: 'Asia/Jakarta',
      missedRunPolicy: 'run_once',
      taskPayload: { kind: 'briefing', input: { topic: 'news' } },
    },
  });
  assert.equal(createRes.statusCode, 201);
  const createdSchedule = createRes.json().schedule;
  assert.equal(createdSchedule.name, 'Daily Morning Briefing');
  assert.equal(createdSchedule.status, 'active');
  assert.ok(createdSchedule.nextRunAt);

  // 2. List schedules
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/schedules',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().schedules.length, 1);

  // 3. Pause schedule
  const pauseRes = await app.inject({
    method: 'POST',
    url: `/v1/schedules/${createdSchedule.id}/pause`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(pauseRes.statusCode, 200);
  assert.equal(pauseRes.json().schedule.status, 'paused');

  // 4. Resume schedule
  const resumeRes = await app.inject({
    method: 'POST',
    url: `/v1/schedules/${createdSchedule.id}/resume`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(resumeRes.statusCode, 200);
  assert.equal(resumeRes.json().schedule.status, 'active');

  // 4b. Update schedule via PATCH /v1/schedules/:id
  const updateRes = await app.inject({
    method: 'PATCH',
    url: `/v1/schedules/${createdSchedule.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Updated Evening Briefing',
      cronExpression: '30 20 * * *',
    },
  });
  assert.equal(updateRes.statusCode, 200);
  const updatedSchedule = updateRes.json().schedule;
  assert.equal(updatedSchedule.name, 'Updated Evening Briefing');
  assert.equal(updatedSchedule.cronExpression, '30 20 * * *');

  // 4c. Delete / Cancel schedule via DELETE /v1/schedules/:id
  const deleteRes = await app.inject({
    method: 'DELETE',
    url: `/v1/schedules/${createdSchedule.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.json().schedule.status, 'cancelled');

  // 5. Ingest event via POST /v1/events
  const eventPayload = {
    id: 'evt-webhook-99',
    source: 'external:github',
    type: 'push.event',
    timestamp: new Date().toISOString(),
    payload: { branch: 'main' },
  };

  const eventRes1 = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: { authorization: `Bearer ${token}` },
    payload: eventPayload,
  });
  assert.equal(eventRes1.statusCode, 200);
  assert.equal(eventRes1.json().result.accepted, true);
  assert.equal(eventRes1.json().result.duplicate, false);

  // Ingest duplicate event
  const eventRes2 = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: { authorization: `Bearer ${token}` },
    payload: eventPayload,
  });
  assert.equal(eventRes2.statusCode, 200);
  assert.equal(eventRes2.json().result.accepted, false);
  assert.equal(eventRes2.json().result.duplicate, true);

  // 6. Notifications & preferences
  // Dispatch a notification
  await notificationEngine.dispatchNotification({
    userId: userId,
    type: 'approval_required',
    title: 'Approval Dibutuhkan',
    body: 'Aksi deployment perlu disetujui',
    data: { approvalId: 'appr-abc-123' },
  });

  const notifsRes = await app.inject({
    method: 'GET',
    url: '/v1/notifications',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(notifsRes.statusCode, 200);
  const notifs = notifsRes.json().notifications;
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0]?.title, 'Approval Dibutuhkan');
  assert.equal(notifs[0]?.deepLink, 'personal-ai://approvals/appr-abc-123');

  // Mark as read
  const readRes = await app.inject({
    method: 'POST',
    url: `/v1/notifications/${notifs[0]?.id}/read`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(readRes.statusCode, 200);
  assert.equal(readRes.json().notification.deliveryState, 'read');

  // Get and update preferences
  const prefsRes = await app.inject({
    method: 'GET',
    url: '/v1/notifications/preferences',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(prefsRes.statusCode, 200);
  assert.equal(prefsRes.json().preferences.enabled, true);

  const updatePrefsRes = await app.inject({
    method: 'PUT',
    url: '/v1/notifications/preferences',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      preferences: {
        enabled: true,
        channels: { push: true, websocket: true },
        categories: {
          approvalRequired: true,
          taskCompleted: false,
          taskFailed: true,
          blocker: true,
        },
      },
    },
  });
  assert.equal(updatePrefsRes.statusCode, 200);
  assert.equal(updatePrefsRes.json().preferences.categories.taskCompleted, false);
});
