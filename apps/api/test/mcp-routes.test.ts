import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryMcpRepository } from '../src/db/mcp-repository.ts';
import { InMemorySkillRepository } from '../src/db/skill-repository.ts';

test('MCP Routes: admin authorization, command allowlist, SSRF egress validation, and audit log', async () => {
  const authRepo = new InMemoryAuthRepository();
  const secret = 'test-secret-at-least-thirty-two-chars-long';
  const auth = createAuthService(authRepo, secret);
  const mcpRepo = new InMemoryMcpRepository();
  const skillRepo = new InMemorySkillRepository();

  // Create admin user and normal user
  const adminUser = await auth.register('admin@example.com', 'AdminPass123!');
  const normalUser = await auth.register('user@example.com', 'UserPass123!');

  // Set environment variable for owner/admin email
  process.env['OWNER_EMAIL'] = 'admin@example.com';

  const loggedAuditEntries: Array<{ action: string; resourceType: string; decision: string }> = [];
  const mockAuditRepo = {
    log: async (entry: { action: string; resourceType: string; decision: string }) => {
      loggedAuditEntries.push(entry);
    },
    listAuditLogs: async () => [],
  };

  const app = await buildApp({
    auth,
    mcp: {
      mcpRepo,
    },
    skills: {
      skillRepo,
    },
    approval: {
      approvalRepo: undefined as never,
      taskRepo: undefined as never,
      taskQueue: undefined as never,
      broadcaster: undefined as never,
      auditRepo: mockAuditRepo as never,
    },
  });

  // 1. Non-admin user attempts to add MCP server -> Rejected 403 Forbidden
  const forbiddenRes = await app.inject({
    method: 'POST',
    url: '/v1/mcp/servers',
    headers: {
      authorization: `Bearer ${normalUser.accessToken}`,
    },
    payload: {
      id: 'hacker-server',
      name: 'Malicious Server',
      transport: 'stdio',
      command: 'node',
      allowedCapabilities: ['system:exec'],
    },
  });
  assert.equal(forbiddenRes.statusCode, 403);
  assert.match(forbiddenRes.body, /Hanya peran admin/i);

  // 2. Admin adds server with dangerous command outside allowlist (e.g. bash or rm) -> Rejected 400
  const disallowedCmdRes = await app.inject({
    method: 'POST',
    url: '/v1/mcp/servers',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
    payload: {
      id: 'bash-server',
      name: 'Bash Server',
      transport: 'stdio',
      command: 'bash',
      allowedCapabilities: ['terminal:exec'],
    },
  });
  assert.equal(disallowedCmdRes.statusCode, 400);
  assert.match(disallowedCmdRes.body, /shell wrapper|allowlist/i);

  // 3. Admin adds server with SSRF / loopback URL -> Rejected 400
  const ssrfRes = await app.inject({
    method: 'POST',
    url: '/v1/mcp/servers',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
    payload: {
      id: 'internal-meta',
      name: 'Metadata Server',
      transport: 'sse',
      url: 'http://169.254.169.254/latest/meta-data',
      allowedCapabilities: ['cloud:meta'],
    },
  });
  assert.equal(ssrfRes.statusCode, 400);
  assert.match(ssrfRes.body, /SSRF|ditolak/i);

  // 4. Admin adds valid stdio server with allowlisted command ('npx') -> Success 201
  const validStdioRes = await app.inject({
    method: 'POST',
    url: '/v1/mcp/servers',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
    payload: {
      id: 'github-docs',
      name: 'GitHub Docs MCP',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      allowedCapabilities: ['docs:read'],
      riskLevel: 'MEDIUM',
    },
  });
  assert.equal(validStdioRes.statusCode, 201);
  assert.equal(validStdioRes.json().server.id, 'github-docs');

  // Verify audit log recorded server addition
  assert.ok(loggedAuditEntries.some((e) => e.action === 'mcp:server_add' && e.resourceType === 'mcp_server'));

  // 5. Admin adds valid remote SSE server -> Success 201
  const validSseRes = await app.inject({
    method: 'POST',
    url: '/v1/mcp/servers',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
    payload: {
      id: 'weather-api',
      name: 'Public Weather API MCP',
      transport: 'sse',
      url: 'https://weather.mcp.example.com/sse',
      allowedCapabilities: ['weather:fetch'],
      riskLevel: 'LOW',
    },
  });
  assert.equal(validSseRes.statusCode, 201);

  // 6. List MCP servers returns both registered servers
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/mcp/servers',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const servers = listRes.json().servers;
  assert.equal(servers.length, 2);
  assert.ok(servers.some((s: { id: string }) => s.id === 'github-docs'));
  assert.ok(servers.some((s: { id: string }) => s.id === 'weather-api'));

  // 7. Call logs endpoint
  await mcpRepo.logCall({
    serverId: 'weather-api',
    toolName: 'get_weather',
    arguments: { city: 'Jakarta' },
    durationMs: 142,
    status: 'success',
  });

  const logsRes = await app.inject({
    method: 'GET',
    url: '/v1/mcp/logs',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
  });
  assert.equal(logsRes.statusCode, 200);
  assert.equal(logsRes.json().logs.length, 1);
  assert.equal(logsRes.json().logs[0].toolName, 'get_weather');

  // 8. Delete server by admin -> Success 200
  const deleteRes = await app.inject({
    method: 'DELETE',
    url: '/v1/mcp/servers/weather-api',
    headers: {
      authorization: `Bearer ${adminUser.accessToken}`,
    },
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.json().success, true);

  // Verify audit log recorded server deletion
  assert.ok(loggedAuditEntries.some((e) => e.action === 'mcp:server_delete'));
});
