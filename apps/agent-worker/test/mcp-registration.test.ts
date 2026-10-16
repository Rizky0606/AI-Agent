import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { McpHub } from '@personal-ai-os/mcp';
import {
  ApprovalRequiredError,
  PermissionEngine,
  SecuredCapabilityGuard,
  type ApprovalValidator,
} from '@personal-ai-os/permissions';
import { createDefaultToolRegistry, type ToolRegistry } from '@personal-ai-os/tools';
import { registerMcpServers } from '../src/index.ts';

const ECHO_SERVER = fileURLToPath(
  new URL('../../../packages/mcp/test/fixtures/echo-server.mjs', import.meta.url),
);

const MCP_SERVERS = JSON.stringify([
  {
    id: 'echo',
    name: 'Echo Server',
    command: process.execPath,
    args: [ECHO_SERVER],
    capability: 'docs:read',
  },
]);

const withMcpServers = async (
  run: (registry: ToolRegistry) => Promise<void>,
  validator?: ApprovalValidator,
): Promise<void> => {
  const previous = process.env.MCP_SERVERS;
  process.env.MCP_SERVERS = MCP_SERVERS;
  const guard = new SecuredCapabilityGuard(
    new PermissionEngine(),
    validator ? { approvalValidator: validator } : {},
  );
  const registry = createDefaultToolRegistry({ guard });
  const adapters = await registerMcpServers(new McpHub(), registry);

  try {
    await run(registry);
  } finally {
    await Promise.all(adapters.map((adapter) => adapter.close()));
    if (previous === undefined) delete process.env.MCP_SERVERS;
    else process.env.MCP_SERVERS = previous;
  }
};

test('registerMcpServers exposes MCP tools through the production tool registry', async () => {
  await withMcpServers(async (registry) => {
    const names = registry.listTools().map((tool) => tool.name);
    assert.ok(names.includes('web_fetch'), 'built-in tools must survive MCP registration');
    assert.deepEqual(
      names.filter((name) => name.startsWith('mcp_')),
      ['mcp_echo_echo', 'mcp_echo_boom'],
    );

    // `/v1/catalog` reports `approvalRequired` from the risk level, so an untrusted
    // server's tools must never advertise themselves as risk-free.
    const mcpTool = registry.getTool('mcp_echo_echo');
    assert.equal(mcpTool?.riskLevel, 'MEDIUM');
    assert.equal(mcpTool?.resourceScope, 'external_mcp');
  });
});

test('registerMcpServers keeps MCP calls behind the permission guard', async () => {
  await withMcpServers(async (registry) => {
    // No approval supplied: the guard must stop the call before the child process runs.
    await assert.rejects(
      async () =>
        registry.executeTool({
          toolName: 'mcp_echo_echo',
          input: { text: 'halo' },
          context: { actor: { id: 'user-1', role: 'user' } },
        }),
      (err: unknown) => err instanceof ApprovalRequiredError,
    );
  });
});

test('registerMcpServers returns untrusted, non-instruction output after approval', async () => {
  const consumed: string[] = [];
  const validator: ApprovalValidator = {
    async validateAndConsume(approvalId, expectedFingerprint, actorId) {
      consumed.push(`${approvalId}:${expectedFingerprint}:${actorId}`);
      return { valid: true };
    },
  };

  await withMcpServers(async (registry) => {
    const result = await registry.executeTool<Record<string, unknown>, { content: string }>({
      toolName: 'mcp_echo_echo',
      input: { text: 'setelah-persetujuan' },
      context: { actor: { id: 'user-1', role: 'user' } },
      approvalId: 'approval-1',
    });

    assert.ok(result.data);
    assert.ok(result.data.content.includes('echo:{"text":"setelah-persetujuan"}'));
    assert.match(result.data.content, /<untrusted_content source="mcp:echo\/echo"/);
    assert.equal(consumed.length, 1);
    // The fingerprint must bind to the MCP action, not to some other tool's policy.
    assert.match(consumed[0]!, /^approval-1:[0-9a-f]{16,}:user-1$/);
  }, validator);
});

test('registerMcpServers skips a server that fails to launch and still returns a usable registry', async () => {
  const previous = process.env.MCP_SERVERS;
  process.env.MCP_SERVERS = JSON.stringify([
    { id: 'broken', command: 'definitely-not-a-real-binary-9f2c1e', capability: 'docs:read' },
  ]);
  const registry = createDefaultToolRegistry({
    guard: new SecuredCapabilityGuard(new PermissionEngine()),
  });

  try {
    const adapters = await registerMcpServers(new McpHub(), registry);
    assert.deepEqual(adapters, []);
    assert.deepEqual(
      registry.listTools().map((tool) => tool.name),
      ['web_fetch', 'web_search'],
    );
  } finally {
    if (previous === undefined) delete process.env.MCP_SERVERS;
    else process.env.MCP_SERVERS = previous;
  }
});

test('registerMcpServers registers nothing when MCP_SERVERS is unset', async () => {
  const previous = process.env.MCP_SERVERS;
  delete process.env.MCP_SERVERS;
  const registry = createDefaultToolRegistry({
    guard: new SecuredCapabilityGuard(new PermissionEngine()),
  });

  try {
    const adapters = await registerMcpServers(new McpHub(), registry);
    assert.deepEqual(adapters, []);
    assert.deepEqual(
      registry.listTools().map((tool) => tool.name),
      ['web_fetch', 'web_search'],
    );
  } finally {
    if (previous !== undefined) process.env.MCP_SERVERS = previous;
  }
});
