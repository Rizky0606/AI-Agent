import { randomUUID } from 'node:crypto';
import type {
  NormalizedChannelAttachment,
  NormalizedChannelMessage,
  TelegramChannelConfig,
  TelegramChannelStatus,
  TelegramUpdate,
} from './types.ts';
import { TelegramPairingManager } from './pairing-manager.ts';

export interface TelegramChannelAdapterOptions {
  config: TelegramChannelConfig;
  pairingManager: TelegramPairingManager;
  fetchFn?: typeof fetch | undefined;
  onInboundMessage?: ((msg: NormalizedChannelMessage) => Promise<string | void>) | undefined;
}

export class TelegramChannelAdapter {
  private readonly config: TelegramChannelConfig;
  private readonly pairingManager: TelegramPairingManager;
  private readonly fetchFn: typeof fetch;
  private readonly onInboundMessage?: ((msg: NormalizedChannelMessage) => Promise<string | void>) | undefined;

  // Proteksi replay dan duplikasi update_id
  private readonly seenUpdateIds = new Set<number>();
  private readonly updateIdQueue: number[] = [];
  private static readonly MAX_SEEN_UPDATES = 10_000;

  // Rate limiter per chat_id (timestamp window 60s)
  private readonly chatRateLimits = new Map<string, number[]>();

  constructor(options: TelegramChannelAdapterOptions) {
    this.config = options.config;
    this.pairingManager = options.pairingManager;
    this.fetchFn = options.fetchFn ?? fetch;
    this.onInboundMessage = options.onInboundMessage;
  }

  /**
   * Menampilkan status terkini channel Telegram (jujur terhadap mode aktif).
   */
  async getStatus(): Promise<TelegramChannelStatus> {
    const isBotConfigured = Boolean(this.config.botToken && this.config.botToken.trim().length > 0);
    const pairedCount = await this.pairingManager.getActivePairingsCount();

    // Mode interaktif diblokir jika kontrak gateway Hermes tidak terverifikasi atau mode notification-only
    const isInteractiveBlocked =
      this.config.mode === 'notification-only' ||
      !this.config.webhookUrl;

    const blockedReason = isInteractiveBlocked
      ? 'Integrasi interaktif dibatasi: gateway Hermes tidak memiliki API integrasi terverifikasi dan polling simultan pada satu bot token dilarang.'
      : undefined;

    return {
      channel: 'telegram',
      configured: isBotConfigured,
      mode: this.config.mode,
      botConfigured: isBotConfigured,
      interactiveChatBlocked: isInteractiveBlocked,
      interactiveChatBlockedReason: blockedReason,
      pairedChatsCount: pairedCount,
      features: {
        outboundAlerts: isBotConfigured,
        approvalDeepLinks: isBotConfigured,
        interactiveCommands: !isInteractiveBlocked,
        inboundAgentExecution: !isInteractiveBlocked,
      },
    };
  }

  /**
   * Memproses Telegram Webhook Update yang masuk.
   */
  async processUpdate(
    update: TelegramUpdate,
    secretHeader?: string | undefined,
  ): Promise<{ status: 'ok' | 'ignored' | 'rejected' | 'duplicate_skipped' | 'rate_limited'; reason?: string; responseSent?: boolean }> {
    // 1. Verifikasi secret token jika dikonfigurasi
    if (this.config.secretToken) {
      if (!secretHeader || secretHeader !== this.config.secretToken) {
        return { status: 'rejected', reason: 'Invalid secret token header' };
      }
    }

    // 2. Proteksi Replay & Deduplikasi update_id
    if (!update || typeof update.update_id !== 'number') {
      return { status: 'rejected', reason: 'Missing update_id' };
    }

    if (this.seenUpdateIds.has(update.update_id)) {
      return { status: 'duplicate_skipped', reason: `update_id ${update.update_id} already processed` };
    }

    this.seenUpdateIds.add(update.update_id);
    this.updateIdQueue.push(update.update_id);
    if (this.updateIdQueue.length > TelegramChannelAdapter.MAX_SEEN_UPDATES) {
      const oldest = this.updateIdQueue.shift();
      if (oldest !== undefined) this.seenUpdateIds.delete(oldest);
    }

    const message = update.message ?? update.edited_message;
    if (!message || !message.chat || !message.chat.id) {
      return { status: 'ignored', reason: 'Non-message update' };
    }

    const chatIdStr = String(message.chat.id);
    const rawText = (message.text ?? message.caption ?? '').trim();
    const senderUsername = message.from?.username;

    // 3. Batas Ukuran Pesan (Oversized Message Protection)
    const maxLen = this.config.maxMessageLength ?? 4096;
    if (rawText.length > maxLen) {
      await this.sendChatMessage(
        chatIdStr,
        `⚠️ Pesan Anda terlalu panjang (${rawText.length} karakter). Batas maksimal adalah ${maxLen} karakter.`,
      );
      return { status: 'rejected', reason: 'Message exceeds max length' };
    }

    // 4. Rate Limiting per chat_id
    const now = Date.now();
    const limit = this.config.rateLimitPerMinute ?? 10;
    const timestamps = this.chatRateLimits.get(chatIdStr) ?? [];
    const validTimestamps = timestamps.filter((t) => now - t < 60_000);

    if (validTimestamps.length >= limit) {
      await this.sendChatMessage(
        chatIdStr,
        '⚠️ Batas frekuensi pesan tercapai (maksimal 10 pesan/menit). Silakan tunggu sebentar sebelum mengirim instruksi baru.',
      );
      return { status: 'rate_limited', reason: 'Rate limit exceeded' };
    }

    validTimestamps.push(now);
    this.chatRateLimits.set(chatIdStr, validTimestamps);

    // 5. Penanganan Perintah Khusus Telegram
    if (rawText.startsWith('/start')) {
      const isPaired = (await this.pairingManager.getPairedUserId(chatIdStr)) !== null;
      if (isPaired) {
        await this.sendChatMessage(
          chatIdStr,
          '🤖 *Personal AI OS Telegram Gateway*\n\nAkun Anda telah terhubung. Anda dapat mengirimkan pertanyaan, instruksi tugas, atau menerima notifikasi ringkasan dan persetujuan di sini.\n\nKetik `/status` untuk melihat status koneksi atau `/unpair` untuk mencabut.',
          { parseMode: 'Markdown' },
        );
      } else {
        await this.sendChatMessage(
          chatIdStr,
          '🤖 *Selamat datang di Personal AI OS*\n\nChat ini belum terhubung ke akun Anda. Untuk menghubungkan:\n1. Buka aplikasi Personal AI OS di Windows atau Android.\n2. Masuk ke *Pengaturan > Integrasi Telegram* dan salin kode pairing.\n3. Kirim ke sini dengan format: `/pair <KODE_PAIRING>`',
          { parseMode: 'Markdown' },
        );
      }
      return { status: 'ok', responseSent: true };
    }

    if (rawText.startsWith('/pair')) {
      const parts = rawText.split(/\s+/);
      if (parts.length < 2) {
        await this.sendChatMessage(
          chatIdStr,
          '⚠️ Format tidak valid. Gunakan format: `/pair <KODE_PAIRING>`\nContoh: `/pair PAIR-1A2B3C`',
          { parseMode: 'Markdown' },
        );
        return { status: 'ok', responseSent: true };
      }

      const inputCode = parts[1]!;
      const pairResult = await this.pairingManager.pairChat(chatIdStr, senderUsername, inputCode);
      if (pairResult.success) {
        await this.sendChatMessage(
          chatIdStr,
          '✅ *Berhasil Terhubung!*\n\nChat Telegram ini telah ditautkan ke akun Personal AI OS Anda. Sekarang Anda dapat menerima ringkasan tugas, notifikasi persetujuan, dan berinteraksi dengan asisten.',
          { parseMode: 'Markdown' },
        );
      } else {
        await this.sendChatMessage(
          chatIdStr,
          `❌ *Gagal Menautkan*: ${pairResult.error ?? 'Kode tidak valid'}`,
          { parseMode: 'Markdown' },
        );
      }
      return { status: 'ok', responseSent: true };
    }

    if (rawText === '/unpair') {
      const success = await this.pairingManager.unpairChat(chatIdStr);
      if (success) {
        await this.sendChatMessage(
          chatIdStr,
          '🔌 *Koneksi Dicabut*: Chat Telegram ini tidak lagi terhubung ke Personal AI OS.',
          { parseMode: 'Markdown' },
        );
      } else {
        await this.sendChatMessage(chatIdStr, 'Chat ini memang belum terhubung ke akun manapun.');
      }
      return { status: 'ok', responseSent: true };
    }

    if (rawText === '/status') {
      const pairedUserId = await this.pairingManager.getPairedUserId(chatIdStr);
      if (pairedUserId) {
        await this.sendChatMessage(
          chatIdStr,
          `ℹ️ *Status Integrasi Telegram*\n\n• Status: *Terhubung (Aktif)*\n• Mode: \`${this.config.mode}\`\n• Chat ID: \`${chatIdStr}\`\n• User ID: \`${pairedUserId}\``,
          { parseMode: 'Markdown' },
        );
      } else {
        await this.sendChatMessage(
          chatIdStr,
          `ℹ️ *Status Integrasi Telegram*\n\n• Status: *Belum Terhubung*\n• Chat ID: \`${chatIdStr}\`\n\nKirim \`/pair <KODE>\` untuk menautkan.`,
          { parseMode: 'Markdown' },
        );
      }
      return { status: 'ok', responseSent: true };
    }

    // 6. Verifikasi Allowlist / Pairing
    const userId = await this.pairingManager.getPairedUserId(chatIdStr);
    if (!userId) {
      await this.sendChatMessage(
        chatIdStr,
        '⚠️ Chat ini belum terdaftar atau belum dipasangkan dengan akun Personal AI OS.\n\nSilakan generate kode pairing di aplikasi resmi dan kirim `/pair <KODE>` untuk mulai menggunakan.',
      );
      return { status: 'rejected', reason: 'Chat unregistered or not paired' };
    }

    // 7. KEAMANAN PERSETUJUAN (HIGH/CRITICAL): Penolakan Keras Persetujuan Teks Biasa
    const lowerText = rawText.toLowerCase();
    const APPROVAL_TEXT_PATTERNS = /^(approve|setujui|yes|ya|confirm|izinkan|acc|ok|oke|lanjutkan|approve\s+task|setujui\s+task)\b/i;

    if (APPROVAL_TEXT_PATTERNS.test(lowerText) && lowerText.length < 50) {
      await this.sendChatMessage(
        chatIdStr,
        '🚨 *Persetujuan Ditolak (Kebijakan Keamanan)*\n\n' +
          'Tindakan berisiko tinggi (*HIGH* atau *CRITICAL*) **dilarang keras** disetujui hanya melalui pesan teks Telegram biasa demi mencegah penyalahgunaan dan pembajakan sesi.\n\n' +
          'Silakan buka aplikasi resmi Personal AI OS (Windows atau Android) melalui tautan mendalam (*deep link*): `personal-ai://approvals` untuk melakukan autentikasi dan memberikan konfirmasi sekunder.',
        { parseMode: 'Markdown' },
      );
      return { status: 'ok', responseSent: true };
    }

    // 8. Normalisasi Lampiran (Attachments)
    const attachments: NormalizedChannelAttachment[] = [];
    if (message.photo && message.photo.length > 0) {
      const highestResPhoto = message.photo[message.photo.length - 1]!;
      attachments.push({
        type: 'image',
        fileId: highestResPhoto.file_id,
        fileSizeBytes: highestResPhoto.file_size,
      });
    }
    if (message.document) {
      attachments.push({
        type: 'document',
        fileId: message.document.file_id,
        fileName: message.document.file_name,
        mimeType: message.document.mime_type,
        fileSizeBytes: message.document.file_size,
      });
    }

    // 9. Bentuk NormalizedChannelMessage
    const normalizedMessage: NormalizedChannelMessage = {
      id: randomUUID(),
      channel: 'telegram',
      originatingChatId: chatIdStr,
      senderId: String(message.from?.id ?? chatIdStr),
      senderUsername,
      userId,
      text: rawText,
      attachments,
      correlationId: `tg-upd-${update.update_id}`,
      updateId: update.update_id,
      receivedAt: new Date().toISOString(),
    };

    // 10. Teruskan ke Agent Core jika callback tersedia
    if (this.onInboundMessage) {
      try {
        const replyText = await this.onInboundMessage(normalizedMessage);
        if (replyText && typeof replyText === 'string') {
          await this.sendChatMessage(chatIdStr, replyText);
          return { status: 'ok', responseSent: true };
        }
      } catch (err: unknown) {
        await this.sendChatMessage(
          chatIdStr,
          `❌ Maaf, terjadi kesalahan saat memproses permintaan Anda: ${err instanceof Error ? err.message : 'Internal error'}`,
        );
        return { status: 'ok', responseSent: true };
      }
    }

    return { status: 'ok', responseSent: false };
  }

  /**
   * Mengirim pesan teks ke chat Telegram melalui Bot API resmi.
   */
  async sendChatMessage(
    chatId: string,
    text: string,
    options?: { parseMode?: 'Markdown' | 'HTML' | undefined; replyMarkup?: unknown } | undefined,
  ): Promise<boolean> {
    if (!this.config.botToken) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
      };
      if (options?.parseMode) body.parse_mode = options.parseMode;
      if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Mengirim notifikasi persetujuan (approval) dengan deep link terotentikasi.
   */
  async sendApprovalNotification(
    chatId: string,
    approvalId: string,
    actionName: string,
    description: string,
  ): Promise<boolean> {
    const deepLink = `personal-ai://approvals/${approvalId}`;
    const text =
      `🛡️ *[Personal AI OS — Permintaan Persetujuan]*\n\n` +
      `Tugas membutuhkan izin Anda untuk mengeksekusi aksi:\n` +
      `• *Aksi:* \`${actionName}\`\n` +
      `• *Detail:* ${description}\n\n` +
      `🔗 *Tautan Persetujuan:*\n${deepLink}\n\n` +
      `⚠️ *Catatan Keamanan:* Persetujuan wajib dilakukan melalui aplikasi resmi dengan autentikasi sekunder. Balasan teks pada chat ini tidak akan memicu persetujuan.`;

    return this.sendChatMessage(chatId, text, { parseMode: 'Markdown' });
  }

  /**
   * Mengirim ringkasan brief tugas terjadwal ke Telegram.
   */
  async sendTaskBrief(chatId: string, taskId: string, taskTitle: string, brief: string): Promise<boolean> {
    const deepLink = `personal-ai://tasks/${taskId}`;
    const text =
      `📋 *[Personal AI OS — Hasil Tugas Terjadwal]*\n\n` +
      `*${taskTitle}*\n\n` +
      `${brief}\n\n` +
      `🔗 *Detail Tugas:* ${deepLink}`;

    return this.sendChatMessage(chatId, text, { parseMode: 'Markdown' });
  }
}
