import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateMcpCommand, validateRemoteMcpUrl } from '@personal-ai-os/mcp';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { McpRepository, McpServerRecord } from '../db/mcp-repository.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ApprovalRepository } from '../db/approval-repository.ts';

interface AuthUser {
  id: string;
  email: string;
  role?: string | undefined;
}

export function registerMcpRoutes(
  app: FastifyInstance,
  options: {
    mcpRepo: McpRepository;
    auth?: AuthService | undefined;
    auditRepo?: AuditRepository | undefined;
    approvalRepo?: ApprovalRepository | undefined;
  },
): void {
  const { mcpRepo, auth, auditRepo, approvalRepo } = options;

  if (process.env.NODE_ENV === 'production' && !auth) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: registerMcpRoutes requires active AuthService in production environment.',
    );
  }

  const getUser = async (req: FastifyRequest): Promise<AuthUser> => {
    if (auth) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthError('UNAUTHENTICATED', 'authentication required');
      }
      const token = authHeader.slice(7).trim();
      const authenticated = await auth.authenticate(token);
      return {
        ...authenticated,
        role: (authenticated as unknown as { role?: string }).role,
      };
    }
    if (process.env.NODE_ENV === 'production') {
      throw new AuthError('UNAUTHENTICATED', 'Autentikasi wajib di lingkungan produksi.', 401);
    }
    return (
      (req as unknown as { user?: AuthUser }).user ?? {
        id: 'default-user',
        email: 'user@personal-ai-os.local',
        role: 'admin',
      }
    );
  };

  const assertAdmin = (user: AuthUser): void => {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && (!auth || user.id === 'default-user')) {
      throw new AuthError(
        'FORBIDDEN',
        'Operasi admin MCP dilarang di lingkungan produksi tanpa autentikasi terverifikasi.',
        403,
      );
    }

    const ownerEmail = process.env.OWNER_EMAIL ?? process.env.ADMIN_EMAIL;
    const isOwner = Boolean(ownerEmail && user.email.toLowerCase() === ownerEmail.toLowerCase());
    const isAdminRole = user.role === 'admin';
    const isDefaultAdmin = !isProduction && (!auth || user.id === 'default-user');

    if (!isOwner && !isAdminRole && !isDefaultAdmin) {
      throw new AuthError(
        'FORBIDDEN',
        'Hanya peran admin/pemilik yang diizinkan mengelola server MCP.',
        403,
      );
    }
  };

  // 1. List MCP Servers
  app.get('/v1/mcp/servers', async (req: FastifyRequest, reply: FastifyReply) => {
    await getUser(req);
    const servers = await mcpRepo.listServers();
    return reply.code(200).send({ servers });
  });

  // 2. List MCP Call Logs
  app.get(
    '/v1/mcp/logs',
    async (
      req: FastifyRequest<{ Querystring: { serverId?: string | undefined; limit?: string | undefined } }>,
      reply: FastifyReply,
    ) => {
      await getUser(req);
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const logs = await mcpRepo.listCallLogs(
        req.query.serverId ? { serverId: req.query.serverId, limit } : { limit },
      );
      return reply.code(200).send({ logs });
    },
  );

  // 3. Add MCP Server (Admin Only, Validated against Allowlist, Approval-Gated)
  app.post(
    '/v1/mcp/servers',
    async (
      req: FastifyRequest<{
        Body: {
          id: string;
          name: string;
          transport: 'stdio' | 'sse' | 'http';
          command?: string | undefined;
          args?: string[] | undefined;
          url?: string | undefined;
          allowedCapabilities: string[];
          riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      assertAdmin(user);

      const body = req.body;
      if (!body || !body.id || !body.name || !body.transport) {
        return reply.code(400).send({ error: 'Field id, name, dan transport wajib diisi.' });
      }

      const id = body.id.trim().toLowerCase();
      if (!/^[a-z0-9_-]{3,64}$/.test(id)) {
        return reply.code(400).send({
          error: "ID server MCP hanya boleh memuat huruf kecil, angka, '-', dan '_', panjang 3-64 karakter.",
        });
      }

      const existing = await mcpRepo.getServerById(id);
      if (existing) {
        return reply.code(409).send({ error: `Server MCP '${id}' sudah terdaftar.` });
      }

      // Check capabilities
      if (!Array.isArray(body.allowedCapabilities) || body.allowedCapabilities.length === 0) {
        return reply.code(400).send({ error: 'allowedCapabilities wajib diisi minimal 1 capability terdaftar.' });
      }

      if (body.allowedCapabilities.some((c) => c === '*' || c === '*:*')) {
        return reply.code(400).send({ error: "Wildcard '*' tidak diizinkan dalam allowedCapabilities demi keamanan." });
      }

      // Transport validation
      if (body.transport === 'stdio') {
        if (!body.command || body.command.trim().length === 0) {
          return reply.code(400).send({ error: 'Command wajib diisi untuk transport stdio.' });
        }
        const validation = validateMcpCommand(body.command, body.args);
        if (!validation.allowed) {
          return reply.code(400).send({
            error: `Validasi perintah MCP ditolak: ${validation.reason}`,
          });
        }
      } else if (body.transport === 'sse' || body.transport === 'http') {
        if (!body.url || body.url.trim().length === 0) {
          return reply.code(400).send({ error: 'URL wajib diisi untuk transport remote sse/http.' });
        }
        const egress = validateRemoteMcpUrl(body.url);
        if (!egress.allowed) {
          return reply.code(400).send({
            error: `Validasi URL remote MCP ditolak: ${egress.reason}`,
          });
        }
      } else {
        return reply.code(400).send({ error: `Transport '${body.transport}' tidak didukung.` });
      }

      const riskLevel = body.riskLevel ?? 'MEDIUM';

      // Create explicit approval request if approvalRepo is available
      let approvalId: string | null = null;
      if (approvalRepo) {
        const fingerprint = createHash('sha256')
          .update(`${user.id}:mcp:register_server:mcp://${id}`)
          .digest('hex');

        const approval = await approvalRepo.createApproval({
          userId: user.id,
          action: 'mcp:register_server',
          resource: `mcp://${id}`,
          scope: 'external_mcp',
          riskLevel: 'HIGH',
          consequence: `Mendaftarkan server MCP eksternal '${body.name}' (${id}) dengan kapabilitas: ${body.allowedCapabilities.join(', ')}.`,
          fingerprint,
          expiresInSeconds: 3600,
        });
        approvalId = approval.id;
      }

      const serverRecord: Omit<McpServerRecord, 'createdAt' | 'updatedAt'> = {
        id,
        name: body.name.trim(),
        transport: body.transport,
        command: body.command?.trim() ?? null,
        args: body.args ?? null,
        url: body.url?.trim() ?? null,
        allowedCapabilities: body.allowedCapabilities,
        riskLevel,
        status: approvalId ? 'pending_approval' : 'connected',
        approvalId,
        isApproved: !approvalId,
        createdBy: user.id,
        lastSeenAt: null,
        lastError: null,
      };

      const created = await mcpRepo.createServer(serverRecord);

      await auditRepo?.log({
        userId: user.id,
        action: 'mcp:server_add',
        resourceType: 'mcp_server',
        resourceId: id,
        decision: approvalId ? 'require_approval' : 'allow',
        metadata: {
          transport: body.transport,
          riskLevel,
          allowedCapabilities: body.allowedCapabilities,
        },
      });

      return reply.code(201).send({
        server: created,
        requiresApproval: Boolean(approvalId),
        approvalId,
      });
    },
  );

  // 4. Delete MCP Server (Admin Only)
  app.delete(
    '/v1/mcp/servers/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      assertAdmin(user);

      const existing = await mcpRepo.getServerById(req.params.id);
      if (!existing) {
        return reply.code(404).send({ error: `Server MCP '${req.params.id}' tidak ditemukan.` });
      }

      await mcpRepo.deleteServer(req.params.id);

      await auditRepo?.log({
        userId: user.id,
        action: 'mcp:server_delete',
        resourceType: 'mcp_server',
        resourceId: req.params.id,
        decision: 'allow',
      });

      return reply.code(200).send({
        success: true,
        message: `Server MCP '${req.params.id}' berhasil dihapus.`,
      });
    },
  );
}
