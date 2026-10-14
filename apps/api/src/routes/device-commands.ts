import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DeviceOfflineError,
  type DeviceConnectionManager,
} from '../services/device-connection-manager.ts';

/**
 * The Windows agent's WSS session lives in this process, so the worker cannot reach a device on
 * its own. These two routes are the bridge: the worker asks which devices are online and asks for
 * one command to be dispatched. They are internal-only — the reverse proxy refuses `/v1/internal`
 * and the caller must present the shared service token.
 */
export interface DeviceCommandRouteOptions {
  deviceManager: DeviceConnectionManager;
  token: string;
  /** Overrides `RECONNECT_GRACE_MS`; `0` reports an absent device immediately. */
  reconnectGraceMs?: number | undefined;
}

/** Mirrors `MAX_TIMEOUT_MS` in the Windows agent, which clamps whatever it is told to wait. */
const MAX_DEVICE_TIMEOUT_MS = 120_000;
/** The device answers before its own timeout fires, so the server waits a little longer. */
const DISPATCH_GRACE_MS = 10_000;
/**
 * How long a dispatch waits for the target device to (re)connect before reporting it offline.
 * Sessions are in-memory, so an API restart leaves an already-approved command with nowhere to go;
 * the agent usually dials back within seconds, and failing instantly would cost the user another
 * approval for the same command.
 */
const RECONNECT_GRACE_MS = Number(process.env.DEVICE_RECONNECT_GRACE_MS ?? 30_000);

interface DeviceCommandBody {
  userId: string;
  deviceId: string;
  command: string;
  capability?: string | undefined;
  action?: string | undefined;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

const tokenMatches = (provided: string | undefined, expected: string): boolean => {
  if (!provided) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(
    createHash('sha256').update(provided).digest(),
    createHash('sha256').update(expected).digest(),
  );
};

export const registerDeviceCommandRoutes = (
  app: FastifyInstance,
  options: DeviceCommandRouteOptions,
): void => {
  const isAuthorized = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const header = request.headers['x-internal-token'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (tokenMatches(provided, options.token)) return true;
    void reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'invalid service token', requestId: request.id } });
    return false;
  };

  app.get(
    '/v1/internal/devices',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            platform: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!isAuthorized(request, reply)) return reply;
      const query = request.query as { userId: string; platform?: string | undefined };
      return reply.send({ devices: options.deviceManager.listOnlineDeviceIds(query.userId, query.platform) });
    },
  );

  app.post(
    '/v1/internal/device-commands',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'deviceId', 'command'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            deviceId: { type: 'string', minLength: 1 },
            command: { type: 'string', minLength: 1 },
            capability: { type: 'string', minLength: 1 },
            action: { type: 'string', minLength: 1 },
            cwd: { type: 'string', minLength: 1 },
            timeoutMs: { type: 'integer', minimum: 1_000, maximum: MAX_DEVICE_TIMEOUT_MS },
          },
        },
      },
    },
    async (request, reply) => {
      if (!isAuthorized(request, reply)) return reply;
      const body = request.body as DeviceCommandBody;
      const timeoutMs = body.timeoutMs ?? 60_000;

      try {
        const connected = await options.deviceManager.waitForConnection(
          body.deviceId,
          options.reconnectGraceMs ?? RECONNECT_GRACE_MS,
          body.userId,
        );
        if (!connected) throw new DeviceOfflineError(body.deviceId);

        const result = await options.deviceManager.dispatchCommand(
          body.deviceId,
          {
            commandId: randomUUID(),
            command: body.command,
            capability: body.capability,
            action: body.action,
            cwd: body.cwd,
            timeoutMs,
          },
          { userId: body.userId, timeoutMs: timeoutMs + DISPATCH_GRACE_MS },
        );
        return reply.send({ result });
      } catch (err) {
        if (err instanceof DeviceOfflineError) {
          return reply.code(404).send({
            error: { code: 'DEVICE_OFFLINE', message: err.message, requestId: request.id },
          });
        }
        const message = err instanceof Error ? err.message : String(err);
        request.log.warn({ err }, 'device command dispatch failed');
        return reply.code(504).send({
          error: { code: 'DEVICE_DISPATCH_FAILED', message, requestId: request.id },
        });
      }
    },
  );
};
