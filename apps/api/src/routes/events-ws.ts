import type { WebSocket } from '@fastify/websocket';
import type { TaskEventEnvelope } from '@personal-ai-os/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService, AuthUser } from '../auth/service.ts';
import type { TaskRepository } from '../db/task-repository.ts';
import type { TaskEventBroadcaster } from '../services/event-broadcaster.ts';

export interface EventsWsDependencies {
  auth: AuthService;
  taskRepo: TaskRepository;
  broadcaster: TaskEventBroadcaster;
}

type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'events.subscribe'; taskId?: string | undefined; lastEventId?: string | undefined }
  | { type: 'ping' };

export const registerEventsWsRoute = (app: FastifyInstance, deps: EventsWsDependencies): void => {
  app.get(
    '/v1/events/ws',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      let currentUser: AuthUser | null = null;
      let scopedTaskId: string | null = null;
      let unsubscribeBroadcaster: (() => void) | null = null;

      const cleanup = () => {
        if (unsubscribeBroadcaster) {
          unsubscribeBroadcaster();
          unsubscribeBroadcaster = null;
        }
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);

      const sendJson = (payload: unknown) => {
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(JSON.stringify(payload));
        }
      };

      const sendReplay = async (user: AuthUser, taskId: string, afterEventId?: string) => {
        const events = await deps.taskRepo.getTaskEvents(user.id, taskId, {
          afterEventId,
        });
        for (const evt of events) {
          sendJson({
            ...evt,
            replayed: true,
          });
        }
      };

      const subscribeToBroadcaster = (user: AuthUser) => {
        cleanup();
        unsubscribeBroadcaster = deps.broadcaster.subscribeUser(
          user.id,
          (event: TaskEventEnvelope) => {
            if (!scopedTaskId || event.taskId === scopedTaskId) {
              sendJson({
                ...event,
                replayed: false,
              });
            }
          },
        );
      };

      // 1. Check query token during handshake
      const query = request.query as Record<string, string | undefined>;
      const queryToken = query.token;
      const initialTaskId = query.taskId;
      const initialLastEventId = query.last_event_id ?? query.lastEventId;

      if (queryToken) {
        try {
          currentUser = await deps.auth.authenticate(queryToken);
          sendJson({ type: 'auth.ok', userId: currentUser.id });
          if (initialTaskId) {
            scopedTaskId = initialTaskId;
            if (initialLastEventId) {
              await sendReplay(currentUser, initialTaskId, initialLastEventId);
            }
          }
          subscribeToBroadcaster(currentUser);
        } catch {
          sendJson({ type: 'error', code: 'UNAUTHENTICATED', message: 'Invalid or expired token' });
          socket.close(4001, 'Unauthorized');
          return;
        }
      }

      // 2. Handle incoming client messages
      socket.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;

          if (msg.type === 'auth') {
            try {
              currentUser = await deps.auth.authenticate(msg.token);
              sendJson({ type: 'auth.ok', userId: currentUser.id });
              subscribeToBroadcaster(currentUser);
            } catch {
              sendJson({
                type: 'error',
                code: 'UNAUTHENTICATED',
                message: 'Invalid or expired token',
              });
              socket.close(4001, 'Unauthorized');
            }
            return;
          }

          if (msg.type === 'ping') {
            sendJson({ type: 'pong' });
            return;
          }

          if (msg.type === 'events.subscribe') {
            if (!currentUser) {
              sendJson({
                type: 'error',
                code: 'UNAUTHENTICATED',
                message: 'Must authenticate first',
              });
              return;
            }

            if (msg.taskId) {
              scopedTaskId = msg.taskId;
              if (msg.lastEventId) {
                await sendReplay(currentUser, msg.taskId, msg.lastEventId);
              }
            } else {
              scopedTaskId = null;
            }

            sendJson({
              type: 'subscription.active',
              taskId: scopedTaskId,
            });
            return;
          }
        } catch {
          sendJson({ type: 'error', code: 'BAD_REQUEST', message: 'Invalid message payload' });
        }
      });
    },
  );
};
