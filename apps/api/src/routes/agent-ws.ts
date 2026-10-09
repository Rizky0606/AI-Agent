import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import type { DeviceConnectionManager } from '../services/device-connection-manager.ts';

export interface AgentWsRouteOptions {
  auth: AuthService;
  deviceManager: DeviceConnectionManager;
  updateDeviceLastSeen?: ((deviceId: string) => Promise<void>) | undefined;
}

export const registerAgentWsRoute = (app: FastifyInstance, options: AgentWsRouteOptions): void => {
  app.get('/v1/agent/ws', { websocket: true }, async (socket, request) => {
    const query = request.query as Record<string, string | undefined>;
    const token = query['token'];
    const deviceId = query['deviceId'];
    const platform = query['platform'] ?? 'windows';

    if (!token || !deviceId) {
      socket.send(
        JSON.stringify({
          type: 'error',
          error: { code: 'UNAUTHENTICATED', message: 'Missing token or deviceId query parameters' },
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
          type: 'error',
          error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' },
        }),
      );
      socket.close();
      return;
    }

    // Register active device connection
    options.deviceManager.registerConnection(deviceId, user.id, platform, socket);
    if (options.updateDeviceLastSeen) {
      void options.updateDeviceLastSeen(deviceId);
    }

    // Heartbeat ping interval from server side
    const pingTimer = setInterval(() => {
      try {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      } catch {
        // ignore
      }
    }, 20_000);

    socket.on('message', (data: Buffer | string) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        const frame = JSON.parse(raw);

        switch (frame.type) {
          case 'pong':
            options.deviceManager.updateHeartbeat(deviceId);
            if (options.updateDeviceLastSeen) {
              void options.updateDeviceLastSeen(deviceId);
            }
            break;

          case 'ping':
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

          case 'device.handshake':
            options.deviceManager.updateHeartbeat(deviceId);
            socket.send(
              JSON.stringify({
                type: 'device.handshake_ack',
                deviceId,
                status: 'online',
                serverTime: new Date().toISOString(),
              }),
            );
            break;

          case 'command.result':
            options.deviceManager.handleCommandResult({
              commandId: frame.commandId,
              success: frame.success,
              result: frame.result,
              error: frame.error,
            });
            break;
        }
      } catch {
        // ignore malformed frame
      }
    });

    socket.on('close', () => {
      clearInterval(pingTimer);
      options.deviceManager.unregisterConnection(deviceId);
      if (options.updateDeviceLastSeen) {
        void options.updateDeviceLastSeen(deviceId);
      }
    });

    socket.on('error', () => {
      clearInterval(pingTimer);
      options.deviceManager.unregisterConnection(deviceId);
    });
  });
};
