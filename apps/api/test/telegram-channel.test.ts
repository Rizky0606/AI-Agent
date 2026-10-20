import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TelegramChannelAdapter,
  TelegramPairingManager,
  type NormalizedChannelMessage,
  type TelegramUpdate,
} from '../src/channels/telegram/index.ts';
import { buildApp } from '../src/app.ts';
import type { AuthService, AuthUser } from '../src/auth/service.ts';

// Mock Auth Service
const createMockAuth = (user: AuthUser): AuthService => ({
  authenticate: async () => user,
  hashPassword: async () => 'hash',
  verifyPassword: async () => true,
  createSession: async () => ({ accessToken: 'mock-token', refreshToken: 'mock-refresh' }),
  refreshSession: async () => ({ accessToken: 'mock-token', refreshToken: 'mock-refresh' }),
  revokeSession: async () => {},
  generatePairingToken: async () => 'pair-token',
  verifyPairingToken: async () => user,
});

test('TelegramPairingManager: lifecycle of pairing code generation, consumption, and revocation', async () => {
  const manager = new TelegramPairingManager({ codeTtlMs: 5000 });
  const userId = 'user-uuid-123';

  // 1. Generate code
  const { code, expiresAt } = await manager.generatePairingCode(userId);
  assert.ok(code.startsWith('PAIR-'));
  assert.ok(new Date(expiresAt).getTime() > Date.now());

  // 2. Reject invalid code
  const invalidResult = await manager.pairChat('12345678', 'tester', 'PAIR-INVALID');
  assert.equal(invalidResult.success, false);
  assert.ok(invalidResult.error?.includes('tidak valid'));

  // 3. Pair with valid code
  const pairResult = await manager.pairChat('12345678', 'tester', code);
  assert.equal(pairResult.success, true);
  assert.equal(pairResult.userId, userId);

  // 4. Single-use: pairing with the same code again fails
  const reuseResult = await manager.pairChat('87654321', 'tester2', code);
  assert.equal(reuseResult.success, false);

  // 5. Query paired user
  const pairedUser = await manager.getPairedUserId('12345678');
  assert.equal(pairedUser, userId);

  // 6. List user pairings
  const list = await manager.listUserPairings(userId);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.channelChatId, '12345678');
  assert.equal(list[0]?.status, 'active');

  // 7. Revoke pairing
  const unpairSuccess = await manager.unpairChat('12345678');
  assert.equal(unpairSuccess, true);

  const afterRevoke = await manager.getPairedUserId('12345678');
  assert.equal(afterRevoke, null);
});

test('TelegramPairingManager: rejects expired pairing code', async () => {
  const manager = new TelegramPairingManager({ codeTtlMs: -1000 }); // expired instantly
  const { code } = await manager.generatePairingCode('user-uuid-expired');

  const result = await manager.pairChat('12345', 'tester', code);
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('kedaluwarsa'));
});

test('TelegramChannelAdapter: rejects update when secret token does not match', async () => {
  const pairingManager = new TelegramPairingManager();
  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
      secretToken: 'super-secret-token-123',
    },
    pairingManager,
  });

  const update: TelegramUpdate = {
    update_id: 1001,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' },
      text: 'Halo',
    },
  };

  // Wrong secret token
  const resBad = await adapter.processUpdate(update, 'wrong-token');
  assert.equal(resBad.status, 'rejected');
  assert.ok(resBad.reason?.includes('secret token'));

  // Correct secret token
  const resGood = await adapter.processUpdate(update, 'super-secret-token-123');
  // It proceeds past secret check (chat unregistered so rejected at pairing check)
  assert.notEqual(resGood.reason, 'Invalid secret token header');
});

test('TelegramChannelAdapter: replay protection skips duplicate update_id', async () => {
  const pairingManager = new TelegramPairingManager();
  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
    },
    pairingManager,
  });

  const update: TelegramUpdate = {
    update_id: 2001,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 99999, type: 'private' },
      text: '/start',
    },
  };

  const firstRun = await adapter.processUpdate(update);
  assert.equal(firstRun.status, 'ok');

  // Replayed update with same update_id
  const secondRun = await adapter.processUpdate(update);
  assert.equal(secondRun.status, 'duplicate_skipped');
  assert.ok(secondRun.reason?.includes('already processed'));
});

test('TelegramChannelAdapter: rejects oversized messages safely', async () => {
  const pairingManager = new TelegramPairingManager();
  let sentOutboundText = '';
  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
      maxMessageLength: 100, // small limit for test
    },
    pairingManager,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      sentOutboundText = body.text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  const hugeText = 'A'.repeat(150);
  const update: TelegramUpdate = {
    update_id: 3001,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 88888, type: 'private' },
      text: hugeText,
    },
  };

  const res = await adapter.processUpdate(update);
  assert.equal(res.status, 'rejected');
  assert.equal(res.reason, 'Message exceeds max length');
  assert.ok(sentOutboundText.includes('terlalu panjang'));
});

test('TelegramChannelAdapter: enforces rate limit per chat_id', async () => {
  const pairingManager = new TelegramPairingManager();
  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
      rateLimitPerMinute: 3,
    },
    pairingManager,
    fetchFn: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });

  const chatId = 77777;

  // 3 requests allowed
  for (let i = 1; i <= 3; i++) {
    const res = await adapter.processUpdate({
      update_id: 4000 + i,
      message: {
        message_id: i,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        text: '/start',
      },
    });
    assert.equal(res.status, 'ok');
  }

  // 4th request rate-limited
  const fourth = await adapter.processUpdate({
    update_id: 4004,
    message: {
      message_id: 4,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text: '/start',
    },
  });
  assert.equal(fourth.status, 'rate_limited');
  assert.equal(fourth.reason, 'Rate limit exceeded');
});

test('TelegramChannelAdapter: rejects unregistered chats and accepts /pair command', async () => {
  const pairingManager = new TelegramPairingManager();
  let lastSent = '';
  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
    },
    pairingManager,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      lastSent = body.text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  const chatId = 55555;

  // 1. Regular prompt from un-paired chat is rejected with pairing prompt
  const unregRes = await adapter.processUpdate({
    update_id: 5001,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text: 'Tolong buatkan kode program',
    },
  });
  assert.equal(unregRes.status, 'rejected');
  assert.equal(unregRes.reason, 'Chat unregistered or not paired');
  assert.ok(lastSent.includes('belum terdaftar'));

  // 2. Generate pairing code for user
  const { code } = await pairingManager.generatePairingCode('user-alice');

  // 3. User sends `/pair <CODE>`
  const pairRes = await adapter.processUpdate({
    update_id: 5002,
    message: {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text: `/pair ${code}`,
    },
  });
  assert.equal(pairRes.status, 'ok');
  assert.ok(lastSent.includes('Berhasil Terhubung'));

  // 4. Now chat is paired and recognized
  const pairedUser = await pairingManager.getPairedUserId(String(chatId));
  assert.equal(pairedUser, 'user-alice');
});

test('SECURITY POLICY: Plain text "approve" is strictly rejected from executing approvals', async () => {
  const pairingManager = new TelegramPairingManager();
  let outboundMessage = '';

  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
    },
    pairingManager,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      outboundMessage = body.text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  const chatId = '66666';
  // Pre-pair the chat
  const { code } = await pairingManager.generatePairingCode('user-admin');
  await pairingManager.pairChat(chatId, 'admin', code);

  // Test various approval text attempts
  const approvalAttempts = ['approve', 'setujui', 'yes', 'ya', 'confirm', 'izinkan', 'acc', 'Approve Task'];

  for (let i = 0; i < approvalAttempts.length; i++) {
    const attempt = approvalAttempts[i]!;
    outboundMessage = '';

    const res = await adapter.processUpdate({
      update_id: 6000 + i,
      message: {
        message_id: 10 + i,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(chatId), type: 'private' },
        text: attempt,
      },
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.responseSent, true);
    // MUST contain explicit security policy warning
    assert.ok(
      outboundMessage.includes('Persetujuan Ditolak (Kebijakan Keamanan)'),
      `Attempt "${attempt}" did not return security rejection!`,
    );
    assert.ok(
      outboundMessage.includes('dilarang keras'),
    );
    assert.ok(
      outboundMessage.includes('pesan teks Telegram biasa'),
    );
    assert.ok(outboundMessage.includes('personal-ai://approvals'));
  }
});

test('TelegramChannelAdapter: normalizes valid inbound message and routes to onInboundMessage callback', async () => {
  const pairingManager = new TelegramPairingManager();
  let receivedNormalized: NormalizedChannelMessage | null = null;
  let outboundReply = '';

  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'mock-bot-token',
    },
    pairingManager,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      outboundReply = body.text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    onInboundMessage: async (msg) => {
      receivedNormalized = msg;
      return `Hasil respon agen untuk: ${msg.text}`;
    },
  });

  const chatId = '77711';
  const { code } = await pairingManager.generatePairingCode('user-john');
  await pairingManager.pairChat(chatId, 'john_doe', code);

  const res = await adapter.processUpdate({
    update_id: 7001,
    message: {
      message_id: 42,
      from: { id: 998877, is_bot: false, first_name: 'John', username: 'john_doe' },
      chat: { id: Number(chatId), type: 'private' },
      date: 1792415000,
      text: 'Rangkum tren AI terkini',
    },
  });

  assert.equal(res.status, 'ok');
  assert.equal(res.responseSent, true);
  assert.ok(receivedNormalized);
  assert.equal(receivedNormalized.channel, 'telegram');
  assert.equal(receivedNormalized.userId, 'user-john');
  assert.equal(receivedNormalized.originatingChatId, '77711');
  assert.equal(receivedNormalized.text, 'Rangkum tren AI terkini');
  assert.equal(receivedNormalized.updateId, 7001);
  assert.ok(receivedNormalized.correlationId.includes('tg-upd-7001'));
  assert.ok(outboundReply.includes('Hasil respon agen untuk: Rangkum tren AI terkini'));
});

test('TelegramChannelAdapter: sends approval notification and task brief with deep links', async () => {
  const pairingManager = new TelegramPairingManager();
  const sentMessages: string[] = [];

  const adapter = new TelegramChannelAdapter({
    config: {
      mode: 'notification-only',
      botToken: 'mock-bot-token',
    },
    pairingManager,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      sentMessages.push(body.text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  // 1. Send approval notification
  const approvalSuccess = await adapter.sendApprovalNotification(
    '123456',
    'appr-999',
    'deploy_production',
    'Deploy commit abc to production cluster',
  );
  assert.equal(approvalSuccess, true);
  const apprMsg = sentMessages[0]!;
  assert.ok(apprMsg.includes('Permintaan Persetujuan'));
  assert.ok(apprMsg.includes('personal-ai://approvals/appr-999'));
  assert.ok(apprMsg.includes('Persetujuan wajib dilakukan melalui aplikasi resmi'));

  // 2. Send task brief
  const briefSuccess = await adapter.sendTaskBrief(
    '123456',
    'task-777',
    'Daily AI Briefing',
    'Semua tes lulus, build stabil.',
  );
  assert.equal(briefSuccess, true);
  const briefMsg = sentMessages[1]!;
  assert.ok(briefMsg.includes('Hasil Tugas Terjadwal'));
  assert.ok(briefMsg.includes('personal-ai://tasks/task-777'));
});

test('TelegramChannelAdapter: getStatus distinguishes notification-only from interactive-chat and reports blocked reasons', async () => {
  const pairingManager = new TelegramPairingManager();

  // Mode 1: Notification-only (default)
  const adapterNotificationOnly = new TelegramChannelAdapter({
    config: {
      mode: 'notification-only',
      botToken: 'token-abc',
    },
    pairingManager,
  });

  const status1 = await adapterNotificationOnly.getStatus();
  assert.equal(status1.mode, 'notification-only');
  assert.equal(status1.configured, true);
  assert.equal(status1.interactiveChatBlocked, true);
  assert.ok(status1.interactiveChatBlockedReason?.includes('Hermes'));
  assert.equal(status1.features.outboundAlerts, true);
  assert.equal(status1.features.approvalDeepLinks, true);
  assert.equal(status1.features.interactiveCommands, false);

  // Mode 2: Interactive-chat with webhook configured
  const adapterInteractive = new TelegramChannelAdapter({
    config: {
      mode: 'interactive-chat',
      botToken: 'token-abc',
      webhookUrl: 'https://ai.example.com/v1/channels/telegram/webhook',
    },
    pairingManager,
  });

  const status2 = await adapterInteractive.getStatus();
  assert.equal(status2.mode, 'interactive-chat');
  assert.equal(status2.interactiveChatBlocked, false);
  assert.equal(status2.features.interactiveCommands, true);
});

test('Telegram API Routes Integration via buildApp: status, pairing generate, pairings list, revoke, and webhook', async () => {
  const mockUser: AuthUser = {
    id: 'user-bob-456',
    email: 'bob@example.com',
  };
  const auth = createMockAuth(mockUser);
  const pairingManager = new TelegramPairingManager();
  let outboundSent = '';

  const channelAdapter = new TelegramChannelAdapter({
    config: {
      mode: 'notification-only',
      botToken: 'mock-token',
      secretToken: 'secret-xyz',
    },
    pairingManager,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      outboundSent = body.text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  const app = await buildApp({
    auth,
    telegram: {
      channelAdapter,
      pairingManager,
    },
  });

  // 1. GET /v1/channels/telegram/status
  const statusRes = await app.inject({
    method: 'GET',
    url: '/v1/channels/telegram/status',
    headers: { authorization: 'Bearer mock-token' },
  });
  assert.equal(statusRes.statusCode, 200);
  const statusJson = statusRes.json();
  assert.equal(statusJson.channel, 'telegram');
  assert.equal(statusJson.mode, 'notification-only');
  assert.equal(statusJson.interactiveChatBlocked, true);

  // 2. POST /v1/channels/telegram/pairing/generate
  const genRes = await app.inject({
    method: 'POST',
    url: '/v1/channels/telegram/pairing/generate',
    headers: { authorization: 'Bearer mock-token' },
  });
  assert.equal(genRes.statusCode, 200);
  const genJson = genRes.json();
  assert.ok(genJson.code.startsWith('PAIR-'));
  const generatedCode = genJson.code;

  // 3. Webhook receives `/pair <CODE>` from Telegram
  const webhookPairRes = await app.inject({
    method: 'POST',
    url: '/v1/channels/telegram/webhook',
    headers: {
      'x-telegram-bot-api-secret-token': 'secret-xyz',
    },
    payload: {
      update_id: 8001,
      message: {
        message_id: 1,
        chat: { id: 333333, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: `/pair ${generatedCode}`,
      },
    },
  });
  assert.equal(webhookPairRes.statusCode, 200);
  assert.ok(outboundSent.includes('Berhasil Terhubung'));

  // 4. GET /v1/channels/telegram/pairings
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/channels/telegram/pairings',
    headers: { authorization: 'Bearer mock-token' },
  });
  assert.equal(listRes.statusCode, 200);
  const listJson = listRes.json();
  assert.equal(listJson.pairings.length, 1);
  assert.equal(listJson.pairings[0].channelChatId, '333333');

  // 5. POST /v1/channels/telegram/pairing/revoke
  const revokeRes = await app.inject({
    method: 'POST',
    url: '/v1/channels/telegram/pairing/revoke',
    headers: { authorization: 'Bearer mock-token' },
    payload: { chatId: '333333' },
  });
  assert.equal(revokeRes.statusCode, 200);
  assert.equal(revokeRes.json().success, true);

  // 6. Webhook with wrong secret header returns 403 Forbidden
  const wrongSecretRes = await app.inject({
    method: 'POST',
    url: '/v1/channels/telegram/webhook',
    headers: {
      'x-telegram-bot-api-secret-token': 'wrong-secret',
    },
    payload: {
      update_id: 8002,
      message: {
        message_id: 2,
        chat: { id: 333333, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'halo',
      },
    },
  });
  assert.equal(wrongSecretRes.statusCode, 403);
});
