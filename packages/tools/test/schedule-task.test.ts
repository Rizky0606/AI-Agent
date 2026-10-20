import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  createScheduleTaskTool,
  createListScheduledTasksTool,
  createPauseScheduledTaskTool,
  createResumeScheduledTaskTool,
  createUpdateScheduledTaskTool,
  createCancelScheduledTaskTool,
  DEFAULT_SCHEDULE_TIMEZONE,
  MAX_ACTIVE_SCHEDULES_PER_USER,
  type ScheduleDispatcher,
  type ScheduleDispatchPayload,
  type ScheduledTaskItem,
  ToolError,
  ToolRegistry,
  validateCronExpression,
  validateTimezone,
} from '../src/index.ts';

test('validateTimezone recognizes valid IANA timezones and rejects invalid ones', () => {
  assert.equal(validateTimezone('Asia/Jakarta'), true);
  assert.equal(validateTimezone('UTC'), true);
  assert.equal(validateTimezone('America/New_York'), true);
  assert.equal(validateTimezone('Europe/London'), true);

  assert.equal(validateTimezone('Not/A_Real_Timezone'), false);
  assert.equal(validateTimezone('RandomString'), false);
});

test('validateCronExpression accepts interval >= 15 minutes and rejects too frequent crons', () => {
  // Valid crons
  assert.doesNotThrow(() => validateCronExpression('*/15 * * * *'));
  assert.doesNotThrow(() => validateCronExpression('*/30 * * * *'));
  assert.doesNotThrow(() => validateCronExpression('0 8 * * *'));
  assert.doesNotThrow(() => validateCronExpression('30 * * * *'));
  assert.doesNotThrow(() => validateCronExpression('0,30 * * * *'));
  assert.doesNotThrow(() => validateCronExpression('0 0 1 * *'));

  // Invalid: 1 minute wildcard
  assert.throws(
    () => validateCronExpression('* * * * *'),
    (err: unknown) => err instanceof ToolError && err.message.includes('terlalu sering'),
  );

  // Invalid: 5 minutes step
  assert.throws(
    () => validateCronExpression('*/5 * * * *'),
    (err: unknown) => err instanceof ToolError && err.message.includes('terlalu sering'),
  );

  // Invalid: 10 minutes step
  assert.throws(
    () => validateCronExpression('*/10 * * * *'),
    (err: unknown) => err instanceof ToolError && err.message.includes('terlalu sering'),
  );

  // Invalid: comma-separated minutes closer than 15 min
  assert.throws(
    () => validateCronExpression('0,10,20 * * * *'),
    (err: unknown) => err instanceof ToolError && err.message.includes('terlalu sering'),
  );

  // Invalid: wrap-around between last and first minute
  assert.throws(
    () => validateCronExpression('5,55 * * * *'),
    (err: unknown) => err instanceof ToolError && err.message.includes('terlalu sering'),
  );

  // Invalid: non-5 field cron
  assert.throws(
    () => validateCronExpression('*/15 * * *'),
    (err: unknown) => err instanceof ToolError && err.message.includes('tepat 5 field'),
  );
});

test('schedule_task: creates recurring schedule with valid cron and default timezone', async () => {
  let dispatchedPayload: ScheduleDispatchPayload | undefined;

  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule(payload) {
      dispatchedPayload = payload;
      return {
        id: 'sched-rec-1',
        status: 'active',
        nextRunAt: '2026-10-19T14:30:00.000Z',
      };
    },
    async getActiveCount() {
      return 2;
    },
  };

  const tool = createScheduleTaskTool(mockDispatcher);
  const result = await tool.execute(
    {
      title: 'Pembersihan Cache Berkala',
      prompt: 'Bersihkan file cache sementara dan catat ringkasan ukuran disk',
      scheduleType: 'recurring',
      cronExpression: '*/30 * * * *',
    },
    {
      actor: { id: 'user-ojixx', role: 'user' },
      projectId: 'proj-omega',
    },
  );

  assert.equal(result.scheduleId, 'sched-rec-1');
  assert.equal(result.status, 'active');
  assert.equal(result.type, 'recurring');
  assert.ok(result.message.includes('*/30 * * * *'));

  assert.ok(dispatchedPayload);
  assert.equal(dispatchedPayload.userId, 'user-ojixx');
  assert.equal(dispatchedPayload.projectId, 'proj-omega');
  assert.equal(dispatchedPayload.name, 'Pembersihan Cache Berkala');
  assert.equal(dispatchedPayload.cronExpression, '*/30 * * * *');
  assert.equal(dispatchedPayload.timezone, DEFAULT_SCHEDULE_TIMEZONE);
});

test('schedule_task: creates one_off schedule with valid future ISO date', async () => {
  let dispatchedPayload: ScheduleDispatchPayload | undefined;

  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule(payload) {
      dispatchedPayload = payload;
      return {
        id: 'sched-oneoff-1',
        status: 'active',
        nextRunAt: payload.runAt,
      };
    },
  };

  const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now

  const tool = createScheduleTaskTool(mockDispatcher);
  const result = await tool.execute(
    {
      title: 'Kirim Laporan Harian',
      prompt: 'Generate laporan harian metrik dan simpan sebagai artefak',
      scheduleType: 'one_off',
      runAt: futureDate,
      timezone: 'Asia/Makassar',
    },
    {
      actor: { id: 'user-ojixx', role: 'user' },
    },
  );

  assert.equal(result.scheduleId, 'sched-oneoff-1');
  assert.equal(result.type, 'one_off');
  assert.equal(result.nextRunAt, futureDate);

  assert.ok(dispatchedPayload);
  assert.equal(dispatchedPayload.timezone, 'Asia/Makassar');
  assert.equal(dispatchedPayload.runAt, futureDate);
});

test('schedule_task: rejects one_off schedule with past date', async () => {
  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule() {
      throw new Error('Should not be called');
    },
  };

  const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
  const tool = createScheduleTaskTool(mockDispatcher);

  await assert.rejects(
    async () =>
      tool.execute(
        {
          title: 'Tugas Masa Lalu',
          prompt: 'Harus gagal karena waktu sudah lewat',
          scheduleType: 'one_off',
          runAt: pastDate,
        },
        { actor: { id: 'user-ojixx', role: 'user' } },
      ),
    (err: unknown) => err instanceof ToolError && err.message.includes('harus berada di masa depan'),
  );
});

test('schedule_task: rejects when maximum active schedules quota is exceeded', async () => {
  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule() {
      throw new Error('Should not be called');
    },
    async getActiveCount() {
      return MAX_ACTIVE_SCHEDULES_PER_USER; // Already at 10 active schedules
    },
  };

  const tool = createScheduleTaskTool(mockDispatcher);

  await assert.rejects(
    async () =>
      tool.execute(
        {
          title: 'Tugas Ke-11',
          prompt: 'Tugas yang melebihi batas 10 jadwal aktif',
          scheduleType: 'recurring',
          cronExpression: '0 8 * * *',
        },
        { actor: { id: 'user-ojixx', role: 'user' } },
      ),
    (err: unknown) =>
      err instanceof ToolError && err.message.includes('Batas kuota jadwal aktif (10) telah tercapai'),
  );
});

test('schedule_task: integrates with ToolRegistry and PermissionEngine', async () => {
  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule() {
      return {
        id: 'sched-reg-1',
        status: 'active',
        nextRunAt: '2026-10-20T01:00:00.000Z',
      };
    },
  };

  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  registry.registerTool(createScheduleTaskTool(mockDispatcher));

  const result = await registry.executeTool({
    toolName: 'schedule_task',
    input: {
      title: 'Audit Keamanan Mingguan',
      prompt: 'Jalankan pemeriksaan dependensi dan audit log',
      scheduleType: 'recurring',
      cronExpression: '0 8 * * 1', // Every Monday at 08:00
    },
    context: {
      actor: { id: 'admin-1', role: 'admin' },
    },
  });

  assert.equal(result.status, 'success');
  const data = result.data as { scheduleId: string; status: string };
  assert.equal(data.scheduleId, 'sched-reg-1');
  assert.equal(data.status, 'active');
});

test('schedule_task: parses natural language instruction into deterministic recurring schedule', async () => {
  let dispatchedPayload: ScheduleDispatchPayload | undefined;

  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule(payload) {
      dispatchedPayload = payload;
      return {
        id: 'sched-nl-1',
        status: 'active',
        nextRunAt: '2026-10-20T02:00:00.000Z',
      };
    },
  };

  const tool = createScheduleTaskTool(mockDispatcher);
  const result = await tool.execute(
    {
      prompt: 'Jalankan riset AI trend setiap hari jam 09:00 WIB',
    },
    {
      actor: { id: 'user-ojixx', role: 'user' },
    },
  );

  assert.equal(result.scheduleId, 'sched-nl-1');
  assert.equal(result.type, 'recurring');
  assert.equal(result.status, 'active');
  assert.ok(dispatchedPayload);
  assert.equal(dispatchedPayload.cronExpression, '0 9 * * *');
  assert.equal(dispatchedPayload.timezone, 'Asia/Jakarta');
  assert.ok(dispatchedPayload.prompt.includes('riset AI trend'));
});

test('schedule_task: rejects ambiguous natural language instruction without guessing and requests confirmation', async () => {
  let dispatcherCalled = false;
  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule() {
      dispatcherCalled = true;
      return { id: 'should-not-create', status: 'active' };
    },
  };

  const tool = createScheduleTaskTool(mockDispatcher);
  const result = await tool.execute(
    {
      prompt: 'Ingatkan saya minum obat besok pagi',
    },
    {
      actor: { id: 'user-ojixx', role: 'user' },
    },
  );

  assert.equal(dispatcherCalled, false);
  assert.equal(result.status, 'requires_confirmation');
  assert.equal(result.requiresConfirmation, true);
  assert.ok(result.message.includes('ambigu'));
  assert.ok(result.message.includes('tidak menebak waktu'));
});

test('list_scheduled_tasks, pause, resume, update, and cancel tools lifecycle', async () => {
  const schedulesDB = new Map<string, ScheduledTaskItem>([
    [
      'sched-100',
      {
        id: 'sched-100',
        name: 'Daily Standup Brief',
        type: 'recurring',
        status: 'active',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Asia/Jakarta',
        nextRunAt: '2026-10-20T02:00:00.000Z',
      },
    ],
  ]);

  const mockDispatcher: ScheduleDispatcher = {
    async createSchedule() {
      throw new Error('not used');
    },
    async listSchedules(filter) {
      return Array.from(schedulesDB.values()).filter(
        (s) => !filter.status || s.status === filter.status,
      );
    },
    async pauseSchedule(id) {
      const item = schedulesDB.get(id);
      if (!item) throw new Error('Not found');
      item.status = 'paused';
      return { id, status: 'paused' };
    },
    async resumeSchedule(id) {
      const item = schedulesDB.get(id);
      if (!item) throw new Error('Not found');
      item.status = 'active';
      item.nextRunAt = '2026-10-21T02:00:00.000Z';
      return { id, status: 'active', nextRunAt: item.nextRunAt };
    },
    async updateSchedule(id, userId, updates) {
      const item = schedulesDB.get(id);
      if (!item) throw new Error('Not found');
      if (updates.name) item.name = updates.name;
      if (updates.cronExpression) item.cronExpression = updates.cronExpression;
      return { id, name: item.name, status: item.status, nextRunAt: item.nextRunAt };
    },
    async cancelSchedule(id) {
      const item = schedulesDB.get(id);
      if (!item) throw new Error('Not found');
      item.status = 'cancelled';
      return { id, status: 'cancelled' };
    },
  };

  const context = { actor: { id: 'user-ojixx', role: 'user' } };

  // 1. List
  const listTool = createListScheduledTasksTool(mockDispatcher);
  const listRes = await listTool.execute({}, context);
  assert.equal(listRes.count, 1);
  assert.equal(listRes.schedules[0]?.id, 'sched-100');

  // 2. Pause
  const pauseTool = createPauseScheduledTaskTool(mockDispatcher);
  const pauseRes = await pauseTool.execute({ scheduleId: 'sched-100' }, context);
  assert.equal(pauseRes.status, 'paused');
  assert.equal(schedulesDB.get('sched-100').status, 'paused');

  // 3. Update
  const updateTool = createUpdateScheduledTaskTool(mockDispatcher);
  const updateRes = await updateTool.execute(
    { scheduleId: 'sched-100', title: 'Updated Daily Standup Brief', cronExpression: '30 9 * * 1-5' },
    context,
  );
  assert.equal(updateRes.name, 'Updated Daily Standup Brief');
  assert.equal(schedulesDB.get('sched-100').name, 'Updated Daily Standup Brief');
  assert.equal(schedulesDB.get('sched-100').cronExpression, '30 9 * * 1-5');

  // 4. Resume
  const resumeTool = createResumeScheduledTaskTool(mockDispatcher);
  const resumeRes = await resumeTool.execute({ scheduleId: 'sched-100' }, context);
  assert.equal(resumeRes.status, 'active');
  assert.ok(resumeRes.nextRunAt);
  assert.equal(schedulesDB.get('sched-100').status, 'active');

  // 5. Cancel
  const cancelTool = createCancelScheduledTaskTool(mockDispatcher);
  const cancelRes = await cancelTool.execute({ scheduleId: 'sched-100' }, context);
  assert.equal(cancelRes.status, 'cancelled');
  assert.equal(schedulesDB.get('sched-100').status, 'cancelled');
});
