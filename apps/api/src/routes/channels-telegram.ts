import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { TelegramChannelAdapter } from '../channels/telegram/channel-adapter.ts';
import type { TelegramPairingManager } from '../channels/telegram/pairing-manager.ts';
import type { TelegramUpdate } from '../channels/telegram/types.ts';

export interface TelegramRoutesDependencies {
  auth: AuthService;
  channelAdapter: TelegramChannelAdapter;
  pairingManager: TelegramPairingManager;
}

export function registerTelegramChannelRoutes(
  app: FastifyInstance,
  deps: TelegramRoutesDependencies,
): void {
  const extractUser = async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError('UNAUTHENTICATED', 'authentication required');
    }
    const token = authHeader.slice(7).trim();
    return deps.auth.authenticate(token);
  };

  /**
   * Status channel Telegram (jujur terhadap mode aktif & status blocker).
   */
  app.get('/v1/channels/telegram/status', async (req: FastifyRequest, reply: FastifyReply) => {
    await extractUser(req);
    const status = await deps.channelAdapter.getStatus();
    return reply.code(200).send(status);
  });

  /**
   * Membuat kode pairing sekali pakai untuk menautkan chat Telegram ke akun pengguna.
   */
  app.post('/v1/channels/telegram/pairing/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await extractUser(req);
    const pairing = await deps.pairingManager.generatePairingCode(user.id);

    return reply.code(200).send({
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      instruction: `Buka chat bot Telegram Anda dan kirimkan perintah: /pair ${pairing.code}`,
    });
  });

  /**
   * Menampilkan daftar pairing Telegram milik pengguna yang sedang login.
   */
  app.get('/v1/channels/telegram/pairings', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await extractUser(req);
    const pairings = await deps.pairingManager.listUserPairings(user.id);
    return reply.code(200).send({ pairings });
  });

  /**
   * Mencabut penautan chat Telegram.
   */
  app.post(
    '/v1/channels/telegram/pairing/revoke',
    {
      schema: {
        body: {
          type: 'object',
          required: ['chatId'],
          properties: {
            chatId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await extractUser(req);
      const { chatId } = req.body as { chatId: string };

      const existing = await deps.pairingManager.getPairing(chatId);
      if (!existing || existing.userId !== user.id) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Pairing tidak ditemukan atau bukan milik akun Anda' },
        });
      }

      const revoked = await deps.pairingManager.unpairChat(chatId);
      return reply.code(200).send({ success: revoked });
    },
  );

  /**
   * Webhook inbound Telegram Bot API.
   */
  app.post('/v1/channels/telegram/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const secretTokenHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const update = req.body as TelegramUpdate;

    if (!update || typeof update !== 'object') {
      return reply.code(400).send({ error: { code: 'INVALID_UPDATE', message: 'Payload update tidak valid' } });
    }

    const result = await deps.channelAdapter.processUpdate(update, secretTokenHeader);

    if (result.status === 'rejected' && result.reason?.includes('secret token')) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Secret token tidak valid' } });
    }

    // Telegram Bot API mengharapkan 200 OK agar tidak melakukan retry berulang yang membanjiri server
    return reply.code(200).send({ ok: true, result });
  });
}
