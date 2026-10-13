import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  McpCapabilityViolationError,
  McpHub,
  type McpAuditLog,
  type McpServerConfig,
  StdioMcpServerAdapter,
} from '../src/index.ts';

const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url));

const openAdapter = (
  overrides: Partial<ConstructorParameters<typeof StdioMcpServerAdapter>[0]> = {},
): StdioMcpServerAdapter =>
  new StdioMcpServerAdapter({
    serverId: 'echo',
    command: process.execPath,
    args: [ECHO_SERVER],
    capability: 'docs:read',
    ...overrides,
  });

test('StdioMcpServerAdapter drives a real MCP child process end to end', async () => {
  const auditEntries: McpAuditLog[] = [];
  const hub = new McpHub({ auditSink: (entry) => void auditEntries.push(entry) });
  const adapter = openAdapter();

  try {
    const config: McpServerConfig = {
      id: 'echo',
      name: 'Echo Server',
      transport: 'stdio',
      allowedCapabilities: ['docs:read'],
      riskLevel: 'LOW',
    };

    const toolDefs = await hub.registerServer(config, adapter);
    assert.deepEqual(
      toolDefs.map((tool) => tool.name),
      ['mcp_echo_echo', 'mcp_echo_boom'],
    );

    // The transport's own contract carries the schema through from the server.
    const descriptors = await adapter.listTools();
    assert.deepEqual(descriptors[0]!.inputSchema, {
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    assert.equal(descriptors[0]!.capability, 'docs:read');

    const result = await hub.callTool('echo', 'echo', { text: 'halo' }, 'trace-stdio');


    assert.equal(result.isUntrusted, true);
    assert.equal(result.isInstruction, false);
    assert.equal(result.provenance, 'mcp');
    assert.ok(result.rawContent.includes('echo:{"text":"halo"}'));
    assert.match(result.sanitizedContent, /<untrusted_content source="mcp:echo\/echo"/);
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0]!.status, 'success');
    assert.equal(auditEntries[0]!.traceId, 'trace-stdio');
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter reaches the same tool through the registry-facing ToolDefinition', async () => {
  const hub = new McpHub();
  const adapter = openAdapter();

  try {
    const [toolDef] = await hub.registerServer(
      {
        id: 'echo',
        name: 'Echo Server',
        transport: 'stdio',
        allowedCapabilities: ['docs:read'],
        riskLevel: 'LOW',
      },
      adapter,
    );

    const output = (await toolDef!.execute(
      { text: 'lewat-registry' },
      { actor: { id: 'user-1' } },
    )) as { content: string; isUntrusted: boolean; isInstruction: boolean };

    assert.equal(output.isUntrusted, true);
    assert.equal(output.isInstruction, false);
    assert.ok(output.content.includes('echo:{"text":"lewat-registry"}'));
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter refuses tools whose capability is not on the allowlist', async () => {
  const hub = new McpHub();
  const adapter = openAdapter();

  try {
    const toolDefs = await hub.registerServer(
      {
        id: 'echo',
        name: 'Echo Server',
        transport: 'stdio',
        allowedCapabilities: ['other:capability'],
        riskLevel: 'LOW',
      },
      adapter,
    );

    // The allowlist is applied at registration, so the tool never reaches the registry.
    assert.deepEqual(toolDefs, []);
    await assert.rejects(
      async () => hub.callTool('echo', 'echo', {}),
      /tidak ditemukan atau capability-nya diblokir/,
    );

    // A tool registered while allowed is still refused if the allowlist later drops it.
    const permissiveHub = new McpHub();
    const config = {
      id: 'echo',
      name: 'Echo Server',
      transport: 'stdio',
      allowedCapabilities: ['docs:read'],
      riskLevel: 'LOW',
    } as const;
    await permissiveHub.registerServer(config, adapter);
    (config.allowedCapabilities as string[]).length = 0;
    await assert.rejects(
      async () => permissiveHub.callTool('echo', 'echo', {}),
      (err: unknown) => err instanceof McpCapabilityViolationError,
    );
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter preserves the fact that non-text content was dropped', async () => {
  const hub = new McpHub();
  const adapter = openAdapter();

  try {
    await hub.registerServer(
      {
        id: 'echo',
        name: 'Echo Server',
        transport: 'stdio',
        allowedCapabilities: ['docs:read'],
        riskLevel: 'LOW',
      },
      adapter,
    );

    const result = await hub.callTool('echo', 'echo', { text: 'dua bagian' });

    assert.ok(result.rawContent.includes('echo:{"text":"dua bagian"}'));
    // The image part has no textual form; it must be marked, not silently vanish.
    assert.ok(result.rawContent.includes('[image content omitted]'));
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter surfaces a server-reported tool failure as an error', async () => {
  const hub = new McpHub();
  const adapter = openAdapter();

  try {
    await hub.registerServer(
      {
        id: 'echo',
        name: 'Echo Server',
        transport: 'stdio',
        allowedCapabilities: ['docs:read'],
        riskLevel: 'LOW',
      },
      adapter,
    );

    const result = await hub.callTool('echo', 'boom', {});

    assert.equal(result.error, 'kegagalan yang dilaporkan server');
    // A failed call still gets sanitized and wrapped before it can reach a prompt.
    assert.match(result.sanitizedContent, /<untrusted_content source="mcp:echo\/boom"/);
    assert.equal(hub.getAuditLogs()[0]!.status, 'failure');
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter routes child stderr to diagnostics instead of swallowing it', async () => {
  const diagnostics: string[] = [];
  const adapter = openAdapter({ onDiagnostic: (line) => void diagnostics.push(line) });

  try {
    await adapter.listTools();
    assert.deepEqual(diagnostics, ['echo-server siap']);
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter rejects an aborted call', async () => {
  const adapter = openAdapter();

  try {
    const controller = new AbortController();
    const pending = adapter.callTool('hang', {}, controller.signal);
    controller.abort();

    await assert.rejects(pending, /dibatalkan/);
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter times out a call the server never answers', async () => {
  const adapter = openAdapter({ requestTimeoutMs: 250 });

  try {
    await assert.rejects(async () => adapter.callTool('hang', {}), /melewati batas 250 ms/);
  } finally {
    await adapter.close();
  }
});

test('StdioMcpServerAdapter reports a failed spawn and retries on the next call', async () => {
  const adapter = new StdioMcpServerAdapter({
    serverId: 'missing',
    command: 'definitely-not-a-real-binary-9f2c1e',
    args: [],
    capability: 'docs:read',
    initializeTimeoutMs: 5_000,
  });

  await assert.rejects(async () => adapter.listTools(), /gagal dijalankan|berhenti/);
  // The startup latch must clear, otherwise every later call inherits the first failure.
  await assert.rejects(async () => adapter.listTools(), /gagal dijalankan|berhenti/);
  await adapter.close();
});

test('StdioMcpServerAdapter restarts the child after close', async () => {
  const adapter = openAdapter();

  const first = await adapter.listTools();
  assert.equal(first.length, 2);

  await adapter.close();
  const second = await adapter.listTools();
  assert.deepEqual(
    second.map((tool) => tool.name),
    ['echo', 'boom'],
  );

  await adapter.close();
});
