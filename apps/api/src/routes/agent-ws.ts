import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import type { DeviceConnectionManager } from '../services/device-connection-manager.ts';
import {
  canonicalDevicePublicKey,
  deviceKeyThumbprint,
  parseDevicePublicKey,
  verifyDeviceSignature,
} from '../services/device-identity.ts';

export interface AgentWsRouteOptions {
  auth: AuthService;
  deviceManager: DeviceConnectionManager;
  /**
   * Resolves the `devices` row a verified key belongs to, creating it on first contact. Unset means
   * no session can be established, because a session without an owner row would be an unregistered
   * device and the whole point of the handshake is to make the server, not the agent, name the
   * device.
   */
  registerAgent?:
    | ((
        userId: string,
        input: { name: string; platform: string; publicKey: string },
      ) => Promise<{ id: string; name: string; platform: string }>)
    | undefined;
}

/** An agent that cannot answer the challenge within this window is dropped. */
const HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_DEVICE_NAME_LENGTH = 120;

/**
 * The device channel is authenticated by possession of a P-256 key, not by a string the client
 * picks. On connect the server sends a fresh challenge; the agent signs it and presents its public
 * key; only then does the socket become a device session, and the id it gets back is the server's
 * `devices.id`. A `deviceId` in the query string is refused outright instead of being trusted, so
 * an old agent fails loudly rather than silently taking over another device's identity.
 */
export const registerAgentWsRoute = (app: FastifyInstance, options: AgentWsRouteOptions): void => {
  app.get('/v1/agent/ws', { websocket: true }, async (socket, request) => {
    const query = request.query as Record<string, string | undefined>;
    const token = query['token'];

    if (!token) {
      socket.send(
        JSON.stringify({
          type: 'device.error',
          code: 'UNAUTHORIZED',
          message: 'Missing agent token',
        }),
      );
      socket.close();
      return;
    }

    if (query['deviceId'] !== undefined) {
      socket.send(
        JSON.stringify({
          type: 'device.error',
          code: 'DEVICE_IDENTITY_REQUIRED',
          message:
            'This server issues device ids itself; connect without deviceId and answer the signed challenge',
        }),
      );
      socket.close();
      return;
    }

    let user;
    try {
      user = await options.auth.authenticate(token);
    } catch {
      socket.send(
        JSON.stringify({
          type: 'device.error',
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired agent token',
        }),
      );
      socket.close();
      return;
    }

    // The exact bytes the agent has to sign, so neither side can drift on the message format.
    const challenge = `device-handshake:${randomBytes(32).toString('base64url')}`;
    let deviceId: string | null = null;
    let pingTimer: NodeJS.Timeout | undefined;

    const handshakeTimer = setTimeout(() => {
      if (deviceId === null) socket.close();
    }, HANDSHAKE_TIMEOUT_MS);

    const fail = (code: string, message: string): void => {
      socket.send(JSON.stringify({ type: 'device.error', code, message }));
      socket.close();
    };

    const completeHandshake = async (frame: Record<string, unknown>): Promise<void> => {
      const publicKey = parseDevicePublicKey(frame['publicKey']);
      const signature = frame['signature'];
      const name = frame['name'];
      const platform = frame['platform'];

      if (!publicKey) return fail('DEVICE_KEY_INVALID', 'Expected a P-256 public key without private members');
      if (typeof signature !== 'string' || signature.length === 0) {
        return fail('DEVICE_SIGNATURE_MISSING', 'Handshake signature is required');
      }
      if (typeof name !== 'string' || name.length === 0 || name.length > MAX_DEVICE_NAME_LENGTH) {
        return fail('DEVICE_NAME_INVALID', 'Device name must be 1-120 characters');
      }
      if (typeof platform !== 'string' || !/^[a-z][a-z0-9_-]{2,31}$/.test(platform)) {
        return fail('DEVICE_PLATFORM_INVALID', 'Device platform must be a short lowercase identifier');
      }
      if (!verifyDeviceSignature({ publicKey, nonce: challenge, signature })) {
        return fail('DEVICE_SIGNATURE_INVALID', 'Handshake signature does not match the public key');
      }
      if (!options.registerAgent) {
        return fail('DEVICE_REGISTRY_UNAVAILABLE', 'Device registry is not configured on this server');
      }

      let row: { id: string; name: string; platform: string };
      try {
        row = await options.registerAgent(user.id, {
          name,
          platform,
          publicKey: canonicalDevicePublicKey(publicKey),
        });
      } catch (err) {
        request.log.error({ err }, 'device registration failed');
        return fail('DEVICE_REGISTRATION_FAILED', 'Could not register this device');
      }

      deviceId = row.id;
      clearTimeout(handshakeTimer);
      options.deviceManager.registerConnection(row.id, user.id, platform, socket, {
        name: row.name,
        keyThumbprint: deviceKeyThumbprint(publicKey),
      });
      socket.send(
        JSON.stringify({
          type: 'device.handshake_ack',
          deviceId: row.id,
          name: row.name,
          platform,
          status: 'online',
          serverTime: new Date().toISOString(),
        }),
      );

      pingTimer = setInterval(() => {
        socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }, 20_000);
    };

    socket.send(JSON.stringify({ type: 'device.challenge', challenge }));

    socket.on('message', (data: Buffer | string) => {
      let frame: Record<string, unknown>;
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        frame = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return; // ignore malformed frame
      }

      // Until the challenge is answered this socket is nobody, so no other frame is honoured.
      if (deviceId === null) {
        if (frame['type'] === 'device.handshake') void completeHandshake(frame);
        return;
      }

      switch (frame['type']) {
        case 'pong':
          options.deviceManager.updateHeartbeat(deviceId);
          break;

        case 'ping':
          socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'command.result':
          options.deviceManager.handleCommandResult(deviceId, frame);
          break;

        default:
          break;
      }
    });

    const teardown = (): void => {
      clearTimeout(handshakeTimer);
      clearInterval(pingTimer);
      if (deviceId !== null) options.deviceManager.unregisterConnection(deviceId, socket);
    };
    socket.on('close', teardown);
    socket.on('error', teardown);
  });
};
