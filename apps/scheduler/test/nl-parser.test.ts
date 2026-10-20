import assert from 'node:assert/strict';
import test from 'node:test';
import { NaturalLanguageScheduleParser } from '../src/nl-parser.ts';
import { SchedulerEngine } from '../src/scheduler-engine.ts';
import { CronParser } from '../src/cron-parser.ts';

test('NaturalLanguageScheduleParser: parses deterministic recurring schedules (daily, weekly, weekdays, intervals)', () => {
  const ref = new Date('2026-10-19T08:00:00.000Z');

  // 1. Setiap hari jam 09:00 WIB
  const res1 = NaturalLanguageScheduleParser.parse('Setiap hari jam 09:00 WIB', { referenceDate: ref });
  assert.equal(res1.success, true);
  assert.equal(res1.scheduleType, 'recurring');
  assert.equal(res1.cronExpression, '0 9 * * *');
  assert.equal(res1.timezone, 'Asia/Jakarta');

  // 2. Setiap senin jam 10:30 WITA
  const res2 = NaturalLanguageScheduleParser.parse('Jadwalkan riset pasar setiap senin jam 10:30 WITA', { referenceDate: ref });
  assert.equal(res2.success, true);
  assert.equal(res2.scheduleType, 'recurring');
  assert.equal(res2.cronExpression, '30 10 * * 1');
  assert.equal(res2.timezone, 'Asia/Makassar');
  assert.ok(res2.prompt?.includes('riset pasar'));

  // 3. Setiap hari kerja jam 08:00
  const res3 = NaturalLanguageScheduleParser.parse('Kirim rekap standup setiap hari kerja jam 08:00', { referenceDate: ref });
  assert.equal(res3.success, true);
  assert.equal(res3.scheduleType, 'recurring');
  assert.equal(res3.cronExpression, '0 8 * * 1-5');
  assert.equal(res3.timezone, 'Asia/Jakarta');

  // 4. Interval 30 menit
  const res4 = NaturalLanguageScheduleParser.parse('Cek healthcheck server setiap 30 menit', { referenceDate: ref });
  assert.equal(res4.success, true);
  assert.equal(res4.scheduleType, 'recurring');
  assert.equal(res4.cronExpression, '*/30 * * * *');

  // 5. Cron mentah: "0 12 * * 5"
  const res5 = NaturalLanguageScheduleParser.parse('Audit mingguan 0 12 * * 5', { referenceDate: ref });
  assert.equal(res5.success, true);
  assert.equal(res5.scheduleType, 'recurring');
  assert.equal(res5.cronExpression, '0 12 * * 5');
});

test('NaturalLanguageScheduleParser: parses deterministic one-off schedules (besok, lusa, in X hours)', () => {
  const ref = new Date('2026-10-19T08:00:00.000Z'); // 15:00 WIB

  // 1. Besok jam 14:00 WIB
  const res1 = NaturalLanguageScheduleParser.parse('Ingatkan saya review PR besok jam 14:00 WIB', { referenceDate: ref });
  assert.equal(res1.success, true);
  assert.equal(res1.scheduleType, 'one_off');
  assert.ok(res1.runAt);
  assert.equal(res1.timezone, 'Asia/Jakarta');
  assert.ok(res1.prompt?.includes('review PR'));

  // 2. Dalam 2 jam
  const res2 = NaturalLanguageScheduleParser.parse('Kirim notifikasi dalam 2 jam', { referenceDate: ref });
  assert.equal(res2.success, true);
  assert.equal(res2.scheduleType, 'one_off');
  assert.ok(res2.runAt);
  const diffHours = (new Date(res2.runAt!).getTime() - ref.getTime()) / (3600 * 1000);
  assert.equal(Math.round(diffHours), 2);

  // 3. Tanggal spesifik ISO
  const res3 = NaturalLanguageScheduleParser.parse('Backup data 2026-11-01 jam 10:00', { referenceDate: ref });
  assert.equal(res3.success, true);
  assert.equal(res3.scheduleType, 'one_off');
  assert.ok(res3.runAt?.startsWith('2026-11-01'));
});

test('NaturalLanguageScheduleParser: strictly rejects ambiguous inputs without guessing', () => {
  const ref = new Date('2026-10-19T08:00:00.000Z');

  // 1. "besok pagi" tanpa jam spesifik
  const res1 = NaturalLanguageScheduleParser.parse('Ingatkan saya minum obat besok pagi', { referenceDate: ref });
  assert.equal(res1.success, false);
  assert.equal(res1.ambiguous, true);
  assert.ok(res1.reason?.includes('Waktu eksekusi tidak spesifik'));
  assert.ok(res1.suggestedClarification?.includes('Harap tentukan jam spesifik'));

  // 2. "nanti sore"
  const res2 = NaturalLanguageScheduleParser.parse('Follow up klien nanti sore', { referenceDate: ref });
  assert.equal(res2.success, false);
  assert.equal(res2.ambiguous, true);

  // 3. "minggu depan"
  const res3 = NaturalLanguageScheduleParser.parse('Rapat anggaran minggu depan', { referenceDate: ref });
  assert.equal(res3.success, false);
  assert.equal(res3.ambiguous, true);

  // 4. "kapan-kapan"
  const res4 = NaturalLanguageScheduleParser.parse('Kapan-kapan ingatkan saya berolahraga', { referenceDate: ref });
  assert.equal(res4.success, false);
  assert.equal(res4.ambiguous, true);

  // 5. Kalimat tanpa penunjuk waktu sama sekali
  const res5 = NaturalLanguageScheduleParser.parse('Halo tolong bantu saya', { referenceDate: ref });
  assert.equal(res5.success, false);
  assert.ok(res5.reason?.includes('Instruksi tidak dapat dipahami'));
});

test('NaturalLanguageScheduleParser: rejects intervals below 15 minutes', () => {
  const ref = new Date('2026-10-19T08:00:00.000Z');

  const res1 = NaturalLanguageScheduleParser.parse('Ping server setiap 5 menit', { referenceDate: ref });
  assert.equal(res1.success, false);
  assert.ok(res1.reason?.includes('terlalu sering'));
  assert.ok(res1.reason?.includes('15 menit'));

  const res2 = NaturalLanguageScheduleParser.parse('Periksa email setiap 1 menit', { referenceDate: ref });
  assert.equal(res2.success, false);
  assert.ok(res2.reason?.includes('terlalu sering'));
});

test('SchedulerEngine.updateSchedule: updates parameters, recalculates next run, and enforces validation', () => {
  const engine = new SchedulerEngine();
  const job = engine.registerSchedule({
    userId: 'user-ojixx',
    name: 'Initial Daily Job',
    type: 'recurring',
    cronExpression: '0 8 * * *',
    timezone: 'Asia/Jakarta',
    taskPayload: { kind: 'research', input: { topic: 'AI' } },
  });

  assert.equal(job.name, 'Initial Daily Job');

  // 1. Update name and cronExpression
  const updated = engine.updateSchedule(job.id, {
    name: 'Updated Evening Job',
    cronExpression: '0 20 * * *',
    timezone: 'Asia/Jakarta',
  });

  assert.equal(updated.name, 'Updated Evening Job');
  assert.equal(updated.cronExpression, '0 20 * * *');
  assert.ok(updated.nextRunAt);

  // 2. Reject interval below 15 minutes on update
  assert.throws(
    () =>
      engine.updateSchedule(job.id, {
        cronExpression: '*/5 * * * *',
      }),
    (err: unknown) => err instanceof Error && err.message.includes('terlalu sering'),
  );

  // 3. Reject empty name on update
  assert.throws(
    () =>
      engine.updateSchedule(job.id, {
        name: '   ',
      }),
    (err: unknown) => err instanceof Error && err.message.includes('Field name tidak boleh kosong'),
  );
});

test('CronParser: verifies DST transitions and timezone consistency', () => {
  // America/New_York transitions from EDT (UTC-4) to EST (UTC-5) in November
  const base = new Date('2026-11-01T04:00:00Z');
  const next = CronParser.getNextRun('0 9 * * *', base, 'America/New_York');
  const zoned = CronParser.getZonedParts(next, 'America/New_York');
  assert.equal(zoned.hour, 9);
  assert.equal(zoned.minute, 0);

  // Asia/Jakarta has no DST (UTC+7 permanently)
  const jktNext = CronParser.getNextRun('0 9 * * *', base, 'Asia/Jakarta');
  const jktZoned = CronParser.getZonedParts(jktNext, 'Asia/Jakarta');
  assert.equal(jktZoned.hour, 9);
  assert.equal(jktZoned.minute, 0);
});
