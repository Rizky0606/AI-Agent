/**
 * Personal AI OS — Skrip Pengujian Notifikasi Push FCM Langsung ke Perangkat Android
 *
 * Penggunaan:
 *   node --experimental-strip-types scripts/test-fcm-push.ts <DEVICE_PUSH_TOKEN>
 *
 * Kredensial dibaca dari FCM_SERVICE_ACCOUNT_JSON atau file /etc/personal-ai-os/fcm-service-account.json
 */

import * as fs from 'node:fs';
import { createFcmProviderFromEnv } from '../apps/scheduler/src/fcm-provider.ts';

async function main(): Promise<void> {
  const devicePushToken = process.argv[2] ?? process.env.TARGET_PUSH_TOKEN;

  if (!devicePushToken) {
    console.error('❌ Kesalahan: Device push token wajib diberikan.');
    console.error('Penggunaan: node --experimental-strip-types scripts/test-fcm-push.ts <DEVICE_PUSH_TOKEN>');
    process.exit(1);
  }

  console.log('[FCM Test] Memuat provider FCM dari environment / secret file...');
  const provider = createFcmProviderFromEnv();

  console.log(`[FCM Test] Mengirim notifikasi uji ke perangkat token: "${devicePushToken.slice(0, 16)}..."`);

  const result = await provider.sendPushNotification(devicePushToken, {
    title: '🔔 Uji Notifikasi Personal AI OS',
    body: 'Notifikasi push Firebase Cloud Messaging (FCM) berhasil diterima di perangkat Android Anda!',
    data: {
      type: 'test_notification',
      timestamp: String(Date.now()),
      deepLink: 'personal-ai://chat',
    },
  });

  if (result.success) {
    console.log('✅ SUKSES: Notifikasi push berhasil dikirim!');
    console.log(`ID Pesan Google: ${result.messageId}`);
    console.log('Silakan periksa panel notifikasi pada ponsel Android Anda.');
  } else {
    console.error(`❌ GAGAL: Pengiriman notifikasi push gagal: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
