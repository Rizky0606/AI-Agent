import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';

export interface RuntimeRouteDependencies {
  auth: AuthService;
  runtimeBridgeUrl?: string | undefined;
  runtimeBridgeToken?: string | undefined;
}

export interface RuntimeInfo {
  id: 'omp' | 'hermes' | 'native';
  name: string;
  version: string;
  status: 'ready' | 'offline';
  healthText: string;
  capabilities: string[];
}

export function registerRuntimeRoutes(
  app: FastifyInstance,
  deps: RuntimeRouteDependencies,
): void {
  const getUser = async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError('UNAUTHENTICATED', 'authentication required');
    }
    const token = authHeader.slice(7).trim();
    return deps.auth.authenticate(token);
  };

  app.get('/v1/runtimes', async (req: FastifyRequest, reply: FastifyReply) => {
    await getUser(req);

    let ompHealthy = false;
    let hermesHealthy = false;

    if (deps.runtimeBridgeUrl && deps.runtimeBridgeToken) {
      try {
        const res = await fetch(`${deps.runtimeBridgeUrl.replace(/\/$/, '')}/health`, {
          headers: { authorization: `Bearer ${deps.runtimeBridgeToken}` },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          ompHealthy = true;
          hermesHealthy = true;
        }
      } catch {
        ompHealthy = false;
        hermesHealthy = false;
      }
    }

    const runtimes: RuntimeInfo[] = [
      {
        id: 'omp',
        name: 'OMP Coding Engine',
        version: '18.6.1',
        status: ompHealthy ? 'ready' : 'offline',
        healthText: ompHealthy
          ? 'Siap untuk koding, manipulasi repositori, dan pemecahan bug.'
          : 'Tidak tersedia: koneksi jembatan runtime terputus.',
        capabilities: ['coding', 'repo', 'terminal'],
      },
      {
        id: 'hermes',
        name: 'Hermes Agent',
        version: '0.20.5',
        status: hermesHealthy ? 'ready' : 'offline',
        healthText: hermesHealthy
          ? 'Siap untuk otomasi tugas, eksekusi skill, dan integrasi pesan.'
          : 'Tidak tersedia: koneksi jembatan runtime terputus.',
        capabilities: ['automation', 'skill', 'general', 'terminal'],
      },
      {
        id: 'native',
        name: 'Runtime Bawaan',
        version: '0.2.0',
        status: 'ready',
        healthText: 'Aktif (Internal Worker siap mengeksekusi tools).',
        capabilities: ['generic', 'chat', 'tools'],
      },
    ];

    return reply.code(200).send({ runtimes });
  });
}
