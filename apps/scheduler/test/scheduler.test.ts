import assert from 'node:assert/strict';
import test from 'node:test';
import { CronParser } from '../src/cron-parser.ts';
import { SchedulerEngine } from '../src/scheduler-engine.ts';
import type { ScheduledRunExecution } from '../src/types.ts';

test('CronParser: parses standard cron expressions and calculates timezone-aware next runs', () => {
  // Parsing valid expression
  const parsed = CronParser.parse('30 9 * * 1-5'); // Monday to Friday at 09:30
  assert.ok(parsed.minutes.has(30));
  assert.ok(parsed.hours.has(9));
  assert.ok(parsed.daysOfWeek.has(1));
  assert.ok(parsed.daysOfWeek.has(5));
  assert.equal(parsed.daysOfWeek.has(0), false); // No Sunday

  // Timezone calculation in Asia/Jakarta (UTC+7)
  const baseUtc = new Date('2026-10-10T01:00:00Z'); // 08:00 WIB
  const nextRun = CronParser.getNextRun('30 9 * * *', baseUtc, 'Asia/Jakarta');

  const parts = CronParser.getZonedParts(nextRun, 'Asia/Jakarta');
  assert.equal(parts.hour, 9);
  assert.equal(parts.minute, 30);
  assert.ok(nextRun > baseUtc);
});

test('SchedulerEngine: one-off delayed tasks execute on time and complete', async () => {
  const dispatched: ScheduledRunExecution[] = [];
  const engine = new SchedulerEngine({
    dispatcher: async (exec) => {
      dispatched.push(exec);
    },
  });

  const runAt = new Date('2026-10-10T10:05:00Z');

  const job = engine.registerSchedule({
    userId: 'user-1',
    name: 'Backup Database One-Off',
    type: 'one_off',
    runAt: runAt.toISOString(),
    taskPayload: { kind: 'backup', input: { target: 'postgres' } },
  });

  assert.equal(job.status, 'active');
  assert.equal(job.nextRunAt, runAt.toISOString());

  // 1. Tick before due time -> no execution
  await engine.tick(new Date('2026-10-10T10:04:00Z'));
  assert.equal(dispatched.length, 0);

  // 2. Tick at/after due time -> executes once and marks completed
  await engine.tick(new Date('2026-10-10T10:05:01Z'));
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.jobId, job.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.nextRunAt, undefined);

  // 3. Subsequent tick -> does NOT re-execute (no double run)
  await engine.tick(new Date('2026-10-10T10:06:00Z'));
  assert.equal(dispatched.length, 1);
});

test('SchedulerEngine: pause and resume functionality', async () => {
  const dispatched: ScheduledRunExecution[] = [];
  const engine = new SchedulerEngine({
    dispatcher: async (exec) => {
      dispatched.push(exec);
    },
  });

  const job = engine.registerSchedule({
    userId: 'user-1',
    name: 'Recurring Sync',
    type: 'recurring',
    cronExpression: '*/10 * * * *', // every 10 mins
    timezone: 'UTC',
    taskPayload: { kind: 'sync', input: {} },
  });

  // Pause
  engine.pauseSchedule(job.id);
  assert.equal(engine.getJob(job.id)?.status, 'paused');

  // Tick while paused -> no run
  await engine.tick(new Date('2026-10-10T11:00:00Z'));
  assert.equal(dispatched.length, 0);

  // Resume
  engine.resumeSchedule(job.id);
  assert.equal(engine.getJob(job.id)?.status, 'active');
});

test('SchedulerEngine: missed-run policies (skip vs run_once vs catch_up)', async () => {
  // Case A: missedRunPolicy = 'skip'
  {
    const dispatched: ScheduledRunExecution[] = [];
    const engine = new SchedulerEngine({
      dispatcher: async (exec) => {
        dispatched.push(exec);
      },
    });

    const job = engine.registerSchedule({
      userId: 'user-1',
      name: 'Hourly Metric Aggregation',
      type: 'recurring',
      cronExpression: '0 * * * *', // hourly
      timezone: 'UTC',
      missedRunPolicy: 'skip',
      taskPayload: { kind: 'metrics', input: {} },
    });

    // Simulate scheduler was offline for 3 hours: nextRun was at 08:00, current time is 11:30
    job.nextRunAt = '2026-10-10T08:00:00Z';

    const runs = await engine.tick(new Date('2026-10-10T11:30:00Z'));
    // 'skip' policy discards past runs and jumps to the next future run (12:00)
    assert.equal(runs.length, 0);
    assert.equal(dispatched.length, 0);
    assert.equal(job.nextRunAt, '2026-10-10T12:00:00.000Z');
  }

  // Case B: missedRunPolicy = 'run_once'
  {
    const dispatched: ScheduledRunExecution[] = [];
    const engine = new SchedulerEngine({
      dispatcher: async (exec) => {
        dispatched.push(exec);
      },
    });

    const job = engine.registerSchedule({
      userId: 'user-1',
      name: 'Nightly Sync',
      type: 'recurring',
      cronExpression: '0 * * * *',
      timezone: 'UTC',
      missedRunPolicy: 'run_once',
      taskPayload: { kind: 'sync', input: {} },
    });

    // Missed 3 runs
    job.nextRunAt = '2026-10-10T08:00:00Z';

    const runs = await engine.tick(new Date('2026-10-10T11:30:00Z'));
    // 'run_once' policy executes exactly 1 catch-up run
    assert.equal(runs.length, 1);
    assert.equal(dispatched.length, 1);
    assert.equal(job.nextRunAt, '2026-10-10T12:00:00.000Z');
  }

  // Case C: missedRunPolicy = 'catch_up'
  {
    const dispatched: ScheduledRunExecution[] = [];
    const engine = new SchedulerEngine({
      dispatcher: async (exec) => {
        dispatched.push(exec);
      },
    });

    const job = engine.registerSchedule({
      userId: 'user-1',
      name: 'Financial Ledger Reconcile',
      type: 'recurring',
      cronExpression: '0 * * * *',
      timezone: 'UTC',
      missedRunPolicy: 'catch_up',
      taskPayload: { kind: 'reconcile', input: {} },
    });

    // Missed 4 slots: 08:00, 09:00, 10:00, 11:00
    job.nextRunAt = '2026-10-10T08:00:00Z';

    const runs = await engine.tick(new Date('2026-10-10T11:30:00Z'));
    // 'catch_up' policy executes each missed slot
    assert.equal(runs.length, 4);
    assert.equal(dispatched.length, 4);

    // Each run has a unique idempotency key
    const keys = new Set(dispatched.map((d) => d.idempotencyKey));
    assert.equal(keys.size, 4);

    assert.equal(job.nextRunAt, '2026-10-10T12:00:00.000Z');
  }
});

test('SchedulerEngine: double execution and race condition prevention via idempotency', async () => {
  let executionCount = 0;
  const engine = new SchedulerEngine({
    dispatcher: async () => {
      executionCount++;
    },
  });

  const now = new Date('2026-10-10T12:00:00Z');
  const job = engine.registerSchedule({
    userId: 'user-1',
    name: 'Cron Job',
    type: 'recurring',
    cronExpression: '0 12 * * *',
    timezone: 'UTC',
    taskPayload: { kind: 'test', input: {} },
  });

  job.nextRunAt = now.toISOString();

  // Run tick twice concurrently or in quick succession with same timestamp
  await Promise.all([engine.tick(now), engine.tick(now)]);

  assert.equal(executionCount, 1);
});
