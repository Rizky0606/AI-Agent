import { and, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { channelPairings, type ChannelPairingRow } from './schema.ts';
import type { ChannelPairingRecord } from '../channels/telegram/types.ts';
import type { PairingStorage } from '../channels/telegram/pairing-manager.ts';

export class SqlChannelPairingRepository implements PairingStorage {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private mapRow(row: ChannelPairingRow): ChannelPairingRecord {
    return {
      id: row.id,
      userId: row.userId,
      channel: 'telegram',
      channelChatId: row.channelChatId,
      channelUsername: row.channelUsername ?? undefined,
      pairedAt: row.pairedAt.toISOString(),
      status: row.status as 'active' | 'revoked',
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    };
  }

  async savePairing(pairing: ChannelPairingRecord): Promise<void> {
    await this.db
      .insert(channelPairings)
      .values({
        id: pairing.id,
        userId: pairing.userId,
        channel: 'telegram',
        channelChatId: pairing.channelChatId,
        channelUsername: pairing.channelUsername ?? null,
        status: pairing.status,
        metadata: pairing.metadata ?? {},
        pairedAt: new Date(pairing.pairedAt),
      })
      .onConflictDoUpdate({
        target: [channelPairings.channel, channelPairings.channelChatId],
        set: {
          userId: pairing.userId,
          channelUsername: pairing.channelUsername ?? null,
          status: pairing.status,
          metadata: pairing.metadata ?? {},
          pairedAt: new Date(pairing.pairedAt),
          revokedAt: pairing.status === 'revoked' ? new Date() : null,
        },
      });
  }

  async getPairingByChatId(chatId: string): Promise<ChannelPairingRecord | null> {
    const rows = await this.db
      .select()
      .from(channelPairings)
      .where(and(eq(channelPairings.channel, 'telegram'), eq(channelPairings.channelChatId, chatId)))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return null;
    }
    return this.mapRow(rows[0]);
  }

  async listPairingsByUserId(userId: string): Promise<ChannelPairingRecord[]> {
    const rows = await this.db
      .select()
      .from(channelPairings)
      .where(and(eq(channelPairings.channel, 'telegram'), eq(channelPairings.userId, userId)));

    return rows.map((r) => this.mapRow(r));
  }

  async updatePairingStatus(id: string, status: 'active' | 'revoked'): Promise<void> {
    await this.db
      .update(channelPairings)
      .set({
        status,
        revokedAt: status === 'revoked' ? new Date() : null,
      })
      .where(eq(channelPairings.id, id));
  }

  async deletePairingByChatId(chatId: string): Promise<boolean> {
    const rows = await this.db
      .delete(channelPairings)
      .where(and(eq(channelPairings.channel, 'telegram'), eq(channelPairings.channelChatId, chatId)))
      .returning({ id: channelPairings.id });
    return rows.length > 0;
  }
}
