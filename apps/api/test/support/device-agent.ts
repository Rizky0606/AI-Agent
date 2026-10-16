import type { DeviceConnectionManager } from '../../src/services/device-connection-manager.ts';
import { canonicalDevicePublicKey } from '../../src/services/device-identity.ts';

/**
 * A stand-in for the Windows agent, exercising the real handshake: connect without a claimed id,
 * sign the server's challenge with a P-256 key, and report the public half back. Tests use it so
 * they drive the same contract the shipped agent does instead of a shortcut that would pass while
 * the real agent fails.
 */

export class DeviceHandshakeRefused extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export interface DeviceAgentSession {
  deviceId: string;
  publicKeyJwk: JsonWebKey;
  keyPair: CryptoKeyPair;
  /** Frames the server sent, in order. */
  frames: Array<Record<string, unknown>>;
  /** Resolves with the next frame matching `matches`, without relying on timers. */
  waitForFrame(matches: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  /** Sends a raw frame, for the paths where the server must reject malformed input. */
  send(frame: Record<string, unknown>): void;
  close(): void;
}

const signChallenge = async (keyPair: CryptoKeyPair, challenge: string): Promise<string> => {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge),
  );
  return Buffer.from(signature).toString('base64');
};

export async function connectDeviceAgent(options: {
  port: number;
  token: string;
  name: string;
  platform?: string;
  /** Reuse a key pair to reconnect as the same device. */
  keyPair?: CryptoKeyPair;
  /** Flip a signature byte, so the server must reject a proof that does not match the key. */
  tamperSignature?: boolean;
  /** Claim an id in the query string, which the server is expected to refuse. */
  claimedDeviceId?: string;
  /**
   * Called for every `command.execute` the server dispatches, with a `send` bound to this socket.
   * The handshake stays the helper's business, so a test only has to answer the command.
   */
  onCommandExecute?: (
    frame: Record<string, unknown>,
    send: (frame: Record<string, unknown>) => void,
  ) => void;
}): Promise<DeviceAgentSession> {
  const keyPair =
    options.keyPair ??
    (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]));
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const claimed = options.claimedDeviceId
    ? `&deviceId=${encodeURIComponent(options.claimedDeviceId)}`
    : '';
  const ws = new WebSocket(
    `ws://127.0.0.1:${options.port}/v1/agent/ws?token=${encodeURIComponent(options.token)}${claimed}`,
  );

  const frames: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    matches: (frame: Record<string, unknown>) => boolean;
    resolve: (frame: Record<string, unknown>) => void;
  }> = [];
  const outcome = Promise.withResolvers<string>();
  const send = (frame: Record<string, unknown>): void => ws.send(JSON.stringify(frame));

  ws.onmessage = (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
    frames.push(frame);
    const index = waiters.findIndex((waiter) => waiter.matches(frame));
    if (index !== -1) waiters.splice(index, 1)[0]?.resolve(frame);

    if (frame['type'] === 'command.execute') {
      options.onCommandExecute?.(frame, send);
      return;
    }

    if (frame['type'] === 'device.challenge') {
      void (async () => {
        const challenge = String(frame['challenge']);
        let signature = await signChallenge(keyPair, challenge);
        if (options.tamperSignature) {
          const bytes = Buffer.from(signature, 'base64');
          bytes[0] = bytes[0]! ^ 0xff;
          signature = bytes.toString('base64');
        }
        ws.send(
          JSON.stringify({
            type: 'device.handshake',
            publicKey: { kty: 'EC', crv: 'P-256', x: publicKeyJwk.x, y: publicKeyJwk.y },
            signature,
            name: options.name,
            platform: options.platform ?? 'windows',
          }),
        );
      })();
      return;
    }

    if (frame['type'] === 'device.handshake_ack') {
      outcome.resolve(String(frame['deviceId']));
    } else if (frame['type'] === 'device.error') {
      outcome.reject(
        new DeviceHandshakeRefused(String(frame['code']), String(frame['message'] ?? '')),
      );
    }
  };
  ws.onclose = () => outcome.reject(new DeviceHandshakeRefused('CONNECTION_CLOSED', 'socket closed'));

  const deviceId = await outcome.promise;

  return {
    deviceId,
    publicKeyJwk,
    keyPair,
    frames,
    waitForFrame: (matches) => {
      const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
      waiters.push({ matches, resolve });
      return promise;
    },
    send: (frame) => ws.send(JSON.stringify(frame)),
    close: () => ws.close(),
  };
}

/**
 * Resolves once the server has processed the socket close and dropped the session, so a test can
 * assert the offline transition without sleeping for it.
 */
export const waitForDeviceOffline = (
  deviceManager: DeviceConnectionManager,
  deviceId: string,
): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const unsubscribe = deviceManager.onDeviceStatusChange((event) => {
    if (event.deviceId !== deviceId || event.status !== 'offline') return;
    unsubscribe();
    resolve();
  });
  return promise;
};

/** The exact string the server stores in `devices.public_key` for a given key. */
export const storedPublicKey = (session: DeviceAgentSession): string =>
  canonicalDevicePublicKey({
    kty: 'EC',
    crv: 'P-256',
    x: String(session.publicKeyJwk.x),
    y: String(session.publicKeyJwk.y),
  });
