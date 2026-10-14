import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { ExecutionLimitExceededError, ExecutionLimiter, ToolRegistry } from '@personal-ai-os/tools';
import { McpHub, type McpServerConfig, StdioMcpServerAdapter } from '../src/index.ts';

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url));

test('ToolRegistry applies its per-tool cap to an MCP-registered tool', async () => {
  const hub = new McpHub();
  const adapter = new StdioMcpServerAdapter({
    serverId: 'echo',
    command: process.execPath,
    args: [ECHO_SERVER],
    capability: 'docs:read',
  });

  try {
    const config: McpServerConfig = {
      id: 'echo',
      name: 'Echo Server',
      transport: 'stdio',
      allowedCapabilities: ['docs:read'],
      riskLevel: 'LOW',
    };
    // In production `tool:mcp_*` is MEDIUM with scope `external_mcp`, so every call needs user
    // approval. This engine keeps the action LOW so the test isolates the execution cap instead
    // of tripping the approval path.
    const engine = new PermissionEngine([
      { pattern: /^tool:mcp_/i, baseRisk: 'LOW', consequence: 'uji batas eksekusi MCP' },
    ]);
    const registry = new ToolRegistry(
      new SecuredCapabilityGuard(engine),
      new ExecutionLimiter({ maxInFlight: 1, maxStartsPerInterval: 100 }),
    );
    for (const toolDef of await hub.registerServer(config, adapter)) registry.registerTool(toolDef);

    const context = { actor: { id: 'user-1' } };
    // The MCP call is still in flight when the second one arrives, so the cap must refuse it.
    const first = registry.executeTool<{ text: string }, { content: string }>({
      toolName: 'mcp_echo_echo',
      input: { text: 'satu' },
      context,
    });

    await assert.rejects(
      async () =>
        registry.executeTool({
          toolName: 'mcp_echo_echo',
          input: { text: 'dua' },
          context,
        }),
      (err: unknown) =>
        err instanceof ExecutionLimitExceededError &&
        err.limit === 'in_flight' &&
        err.key === 'mcp_echo_echo',
    );

    const result = await first;
    assert.equal(result.status, 'success');
    assert.match(result.data!.content, /echo:\{"text":"satu"\}/);
  } finally {
    await adapter.close();
  }
});
