import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerMcpRoutes } from '../src/routes/mcp.ts';
import type { McpRepository, McpServerRecord } from '../src/db/mcp-repository.ts';

class MockMcpRepo implements McpRepository {
  private servers: McpServerRecord[] = [];

  async registerServer(record: Omit<McpServerRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const s: McpServerRecord = {
      ...record,
      id: `mcp-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.servers.push(s);
    return s;
  }

  async createServer(record: Omit<McpServerRecord, 'createdAt' | 'updatedAt'>) {
    const s: McpServerRecord = {
      ...record,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.servers.push(s);
    return s;
  }

  async listServers() {
    return this.servers;
  }

  async getServer(id: string) {
    return this.servers.find((s) => s.id === id) ?? null;
  }

  async getServerById(id: string) {
    return this.getServer(id);
  }

  async updateServer(id: string, patch: Partial<McpServerRecord>) {
    const s = await this.getServer(id);
    if (!s) return null;
    Object.assign(s, patch);
    return s;
  }

  async deleteServer(id: string) {
    const idx = this.servers.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.servers.splice(idx, 1);
    return true;
  }
}

test('MCP Admin Security: Fails closed in production without authentication', async () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const app = Fastify();
    const mcpRepo = new MockMcpRepo();

    // 1. In production, registering without AuthService throws fatal error
    assert.throws(
      () => registerMcpRoutes(app, { mcpRepo, auth: undefined }),
      /registerMcpRoutes requires active AuthService in production environment/i,
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('MCP Admin Security: Rejects non-admin in production and enforces admin authorization', async () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const app = Fastify();
    const mcpRepo = new MockMcpRepo();

    // Mock AuthService returning specific user roles
    let currentUserRole = 'user';
    const currentUserEmail = 'regular-user@example.com';
    const mockAuthService = {
      authenticate: async (token: string) => {
        if (token === 'invalid') throw new Error('Invalid token');
        return {
          id: 'auth-user-123',
          email: currentUserEmail,
          role: currentUserRole,
        };
      },
    } as unknown as import('../src/auth/service.ts').AuthService;

    registerMcpRoutes(app, { mcpRepo, auth: mockAuthService });

    // 1. Non-admin user receives 403 on createServer
    const nonAdminRes = await app.inject({
      method: 'POST',
      url: '/v1/mcp/servers',
      headers: { authorization: 'Bearer valid-user-token' },
      payload: {
        id: 'test-mcp-user',
        name: 'test-mcp',
        transport: 'stdio',
        command: 'node',
        allowedCapabilities: ['mcp:tools'],
      },
    });
    assert.equal(nonAdminRes.statusCode, 403);
    assert.match(nonAdminRes.body, /Hanya peran admin\/pemilik/);

    // 2. Admin role user successfully creates MCP server
    currentUserRole = 'admin';
    const adminRes = await app.inject({
      method: 'POST',
      url: '/v1/mcp/servers',
      headers: { authorization: 'Bearer valid-admin-token' },
      payload: {
        id: 'test-mcp-admin',
        name: 'test-mcp-admin',
        transport: 'stdio',
        command: 'node',
        allowedCapabilities: ['mcp:tools'],
      },
    });
    assert.equal(adminRes.statusCode, 201);

    // 3. Unauthenticated request in production receives 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/v1/mcp/servers',
      payload: {
        id: 'unauth-mcp',
        name: 'unauth-mcp',
        transport: 'stdio',
        command: 'node',
        allowedCapabilities: ['mcp:tools'],
      },
    });
    assert.equal(unauthRes.statusCode, 401);
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});
