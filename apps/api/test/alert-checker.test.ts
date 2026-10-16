import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MockAlertTransport,
  TelegramAlertTransport,
  VpsAlertChecker,
} from '../src/services/alert-checker.ts';

test('VpsAlertChecker: Mendeteksi kegagalan /ready dan mengirimkan alert CRITICAL ke Telegram', async () => {
  const transport = new MockAlertTransport();
  const checker = new VpsAlertChecker(transport);

  // 1. Kondisi normal: /ready ok
  const noIncident = await checker.checkReadyEndpoint(async () => ({ ok: true, status: 200 }));
  assert.equal(noIncident, null);
  assert.equal(transport.sentAlerts.length, 0);

  // 2. Kondisi kegagalan: /ready 503 (database/redis down)
  const incident = await checker.checkReadyEndpoint(async () => ({
    ok: false,
    status: 503,
    body: { status: 'not_ready', checks: { database: false, redis: true } },
  }));

  assert.ok(incident);
  assert.equal(incident.severity, 'critical');
  assert.equal(incident.id, 'ready_endpoint_down');
  assert.equal(transport.sentAlerts.length, 1);
  assert.match(transport.sentAlerts[0]!.title, /Layanan API tidak siap/);
});

test('VpsAlertChecker: Mendeteksi antrean BullMQ macet dan backup kedaluwarsa', async () => {
  const transport = new MockAlertTransport();
  const checker = new VpsAlertChecker(transport);

  const now = Date.now();

  // Antrean macet: 30 jobs waiting
  const queueIncident = await checker.checkQueueHealth(
    { waiting: 35, active: 2, failed: 1 },
    now,
  );
  assert.ok(queueIncident);
  assert.equal(queueIncident.id, 'queue_stuck');
  assert.equal(transport.sentAlerts.length, 1);

  // Backup stale: 30 jam yang lalu
  const thirtyHoursAgo = now - 30 * 3600 * 1000;
  const backupIncident = await checker.checkBackupFreshness(thirtyHoursAgo, now);
  assert.ok(backupIncident);
  assert.equal(backupIncident.severity, 'critical');
  assert.equal(backupIncident.id, 'backup_stale');
  assert.equal(transport.sentAlerts.length, 2);
});

test('VpsAlertChecker: Mendeteksi pemakaian disk tinggi dan sertifikat TLS kedaluwarsa', async () => {
  const transport = new MockAlertTransport();
  const checker = new VpsAlertChecker(transport);

  const now = Date.now();

  // Disk 89% pemakaian
  const diskIncident = await checker.checkDiskUsage(89, now);
  assert.ok(diskIncident);
  assert.equal(diskIncident.id, 'disk_nearly_full');
  assert.equal(diskIncident.severity, 'warning');

  // Disk 97% pemakaian (critical)
  const criticalDisk = await checker.checkDiskUsage(97, now + 35 * 60 * 1000);
  assert.ok(criticalDisk);
  assert.equal(criticalDisk.severity, 'critical');

  // TLS kedaluwarsa dalam 5 hari
  const fiveDaysLater = now + 5 * 24 * 3600 * 1000;
  const tlsIncident = await checker.checkTlsExpiration(fiveDaysLater, now);
  assert.ok(tlsIncident);
  assert.equal(tlsIncident.id, 'tls_expiring');
});

test('VpsAlertChecker: Mencegah spam pesan berulang melalui cooldown window', async () => {
  const transport = new MockAlertTransport();
  const checker = new VpsAlertChecker(transport, { cooldownMs: 60_000 }); // 1 menit cooldown

  const now = Date.now();
  // Call 1: trigger
  await checker.checkDiskUsage(90, now);
  assert.equal(transport.sentAlerts.length, 1);

  // Call 2: 30 detik kemudian (masih dalam cooldown)
  await checker.checkDiskUsage(91, now + 30_000);
  assert.equal(transport.sentAlerts.length, 1, 'Pesan kedua harus disupresi oleh cooldown');

  // Call 3: 70 detik kemudian (cooldown selesai)
  await checker.checkDiskUsage(92, now + 70_000);
  assert.equal(transport.sentAlerts.length, 2, 'Pesan ketiga harus dikirim setelah cooldown berakhir');
});

test('TelegramAlertTransport: Memformat pesan Markdown Telegram dalam Bahasa Indonesia dengan rapi', async () => {
  let requestedUrl = '';
  let requestBody: Record<string, unknown> = {};

  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requestedUrl = String(url);
    if (init?.body) {
      requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const telegramTransport = new TelegramAlertTransport({
    botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    chatId: '-100987654321',
    fetchFn: fakeFetch as typeof fetch,
  });

  const incident = {
    id: 'ready_endpoint_down',
    title: 'Layanan API tidak siap (/ready gagal)',
    description: 'PostgreSQL database pool tidak merespons.',
    severity: 'critical' as const,
    timestamp: 1776333600000,
    metadata: { httpStatus: 503, databaseHealthy: false },
  };

  const sent = await telegramTransport.sendAlert(incident);
  assert.ok(sent);
  assert.match(requestedUrl, /123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11\/sendMessage/);
  assert.equal(requestBody.chat_id, '-100987654321');
  assert.equal(requestBody.parse_mode, 'Markdown');

  const text = String(requestBody.text);
  assert.match(text, /🚨 \*\[Personal AI OS Alert — CRITICAL\]\*/);
  assert.match(text, /Masalah:\* Layanan API tidak siap \(\/ready gagal\)/);
  assert.match(text, /Detail:\* PostgreSQL database pool tidak merespons\./);
  assert.match(text, /`httpStatus`: 503/);
});
