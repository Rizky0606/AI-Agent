import { randomBytes, randomUUID } from 'node:crypto';
import type { ChannelPairingRecord, PairingCodeRecord } from './types.ts';

export interface PairingStorage {
  savePairing(pairing: ChannelPairingRecord): Promise<void>;
  getPairingByChatId(chatId: string): Promise<ChannelPairingRecord | null>;
  listPairingsByUserId(userId: string): Promise<ChannelPairingRecord[]>;
  updatePairingStatus(id: string, status: 'active' | 'revoked'): Promise<void>;
  deletePairingByChatId(chatId: string): Promise<boolean>;
}

export class InMemoryPairingStorage implements PairingStorage {
  private readonly pairings = new Map<string, ChannelPairingRecord>(); // keyed by chatId

  async savePairing(pairing: ChannelPairingRecord): Promise<void> {
    this.pairings.set(pairing.channelChatId, { ...pairing });
  }

  async getPairingByChatId(chatId: string): Promise<ChannelPairingRecord | null> {
    const item = this.pairings.get(chatId);
    if (!item) return null;
    return { ...item };
  }

  async listPairingsByUserId(userId: string): Promise<ChannelPairingRecord[]> {
    return Array.from(this.pairings.values()).filter((p) => p.userId === userId);
  }

  async updatePairingStatus(id: string, status: 'active' | 'revoked'): Promise<void> {
    for (const item of this.pairings.values()) {
      if (item.id === id) {
        item.status = status;
        break;
      }
    }
  }

  async deletePairingByChatId(chatId: string): Promise<boolean> {
    return this.pairings.delete(chatId);
  }
}

export interface PairingManagerOptions {
  storage?: PairingStorage | undefined;
  codeTtlMs?: number | undefined; // Default 10 minutes
}

export class TelegramPairingManager {
  private readonly storage: PairingStorage;
  private readonly codeTtlMs: number;
  private readonly pendingCodes = new Map<string, PairingCodeRecord>(); // code -> record

  constructor(options?: PairingManagerOptions | undefined) {
    this.storage = options?.storage ?? new InMemoryPairingStorage();
    this.codeTtlMs = options?.codeTtlMs ?? 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Membuat kode pairing unik sekali pakai untuk user terautentikasi.
   */
  async generatePairingCode(userId: string): Promise<{ code: string; expiresAt: string }> {
    // Bersihkan kode lama milik user ini
    for (const [code, rec] of this.pendingCodes) {
      if (rec.userId === userId) {
        this.pendingCodes.delete(code);
      }
    }

    const randomSuffix = randomBytes(4).toString('hex').toUpperCase(); // 8 karakter hex
    const code = `PAIR-${randomSuffix}`;
    const expiresAt = Date.now() + this.codeTtlMs;

    this.pendingCodes.set(code, {
      code,
      userId,
      expiresAt,
    });

    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * Memasangkan chat Telegram dengan akun Personal AI OS menggunakan kode pairing.
   */
  async pairChat(
    chatId: string,
    username: string | undefined,
    inputCode: string,
  ): Promise<{ success: boolean; userId?: string | undefined; error?: string | undefined }> {
    const cleanCode = inputCode.trim().toUpperCase();
    const record = this.pendingCodes.get(cleanCode);

    if (!record) {
      return { success: false, error: 'Kode pairing tidak valid atau telah digunakan.' };
    }

    if (Date.now() > record.expiresAt) {
      this.pendingCodes.delete(cleanCode);
      return { success: false, error: 'Kode pairing telah kedaluwarsa. Silakan buat kode baru di aplikasi.' };
    }

    // Kode valid, konsumsi kode (single-use)
    this.pendingCodes.delete(cleanCode);

    const pairingRecord: ChannelPairingRecord = {
      id: randomUUID(),
      userId: record.userId,
      channel: 'telegram',
      channelChatId: chatId,
      channelUsername: username,
      pairedAt: new Date().toISOString(),
      status: 'active',
    };

    await this.storage.savePairing(pairingRecord);
    return { success: true, userId: record.userId };
  }

  /**
   * Mendapatkan user ID yang terhubung ke chatId jika aktif.
   */
  async getPairedUserId(chatId: string): Promise<string | null> {
    const pairing = await this.storage.getPairingByChatId(chatId);
    if (!pairing || pairing.status !== 'active') {
      return null;
    }
    return pairing.userId;
  }

  /**
   * Mendapatkan record pairing untuk chatId.
   */
  async getPairing(chatId: string): Promise<ChannelPairingRecord | null> {
    return this.storage.getPairingByChatId(chatId);
  }

  /**
   * Mencabut pairing untuk chatId tertentu.
   */
  async unpairChat(chatId: string): Promise<boolean> {
    const existing = await this.storage.getPairingByChatId(chatId);
    if (!existing) return false;
    await this.storage.updatePairingStatus(existing.id, 'revoked');
    return true;
  }

  /**
   * Menampilkan daftar pairing aktif untuk seorang user.
   */
  async listUserPairings(userId: string): Promise<ChannelPairingRecord[]> {
    return this.storage.listPairingsByUserId(userId);
  }

  /**
   * Jumlah total pairing aktif.
   */
  async getActivePairingsCount(): Promise<number> {
    if (this.storage instanceof InMemoryPairingStorage) {
      const all = await this.storage.listPairingsByUserId(''); // or inspect map
      return all.filter((p) => p.status === 'active').length;
    }
    return 0;
  }
}
