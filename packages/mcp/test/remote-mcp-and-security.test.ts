import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ALLOWED_MCP_COMMANDS,
  McpError,
  McpHub,
  SseMcpServerAdapter,
  validateMcpCommand,
  validateRemoteMcpUrl,
} from '../src/index.ts';

test('validateMcpCommand: allows whitelisted commands and strictly denies unlisted/dangerous commands', () => {
  // 1. Whitelisted commands pass
  for (const cmd of DEFAULT_ALLOWED_MCP_COMMANDS) {
    const res = validateMcpCommand(cmd);
    assert.equal(res.allowed, true, `Expected ${cmd} to be allowed`);
  }

  // 2. Shell wrappers rejected
  const shellRes = validateMcpCommand('bash');
  assert.equal(shellRes.allowed, false);
  assert.match(shellRes.reason ?? '', /shell wrapper/i);

  const psRes = validateMcpCommand('powershell.exe');
  assert.equal(psRes.allowed, false);

  // 3. Unlisted commands rejected
  const unlistedRes = validateMcpCommand('rm');
  assert.equal(unlistedRes.allowed, false);
  assert.match(unlistedRes.reason ?? '', /allowlist/i);

  const curlRes = validateMcpCommand('curl');
  assert.equal(curlRes.allowed, false);

  // 4. Command chaining in command rejected
  const chainRes = validateMcpCommand('node ; rm -rf /');
  assert.equal(chainRes.allowed, false);
  assert.match(chainRes.reason ?? '', /chaining|operator/i);

  // 5. Command chaining in arguments rejected
  const argChainRes = validateMcpCommand('node', ['app.js', '&&', 'rm', '-rf']);
  assert.equal(argChainRes.allowed, false);
  assert.match(argChainRes.reason ?? '', /operator/i);
});

test('validateRemoteMcpUrl: prevents SSRF to loopback, private IPs, and cloud metadata', () => {
  // 1. Valid public HTTPS URL passes
  const publicRes = validateRemoteMcpUrl('https://mcp.example.com/sse');
  assert.equal(publicRes.allowed, true);

  // 2. Localhost & loopback rejected
  const localhostRes = validateRemoteMcpUrl('http://localhost:8080/sse');
  assert.equal(localhostRes.allowed, false);
  assert.match(localhostRes.reason ?? '', /SSRF/i);

  const loopbackRes = validateRemoteMcpUrl('http://127.0.0.1:3000/sse');
  assert.equal(loopbackRes.allowed, false);
  assert.match(loopbackRes.reason ?? '', /SSRF/i);

  // 3. Cloud metadata rejected
  const metadataRes = validateRemoteMcpUrl('http://169.254.169.254/latest/meta-data');
  assert.equal(metadataRes.allowed, false);
  assert.match(metadataRes.reason ?? '', /SSRF/i);

  // 4. Private network ranges rejected
  const privateRes1 = validateRemoteMcpUrl('http://10.0.1.5:8080/mcp');
  assert.equal(privateRes1.allowed, false);
  assert.match(privateRes1.reason ?? '', /privat/i);

  const privateRes2 = validateRemoteMcpUrl('http://192.168.1.100/mcp');
  assert.equal(privateRes2.allowed, false);

  // 5. Non-HTTP protocols rejected
  const fileRes = validateRemoteMcpUrl('file:///etc/passwd');
  assert.equal(fileRes.allowed, false);
  assert.match(fileRes.reason ?? '', /protokol/i);

  // 6. Explicit allowedHosts override permits specific host
  const explicitRes = validateRemoteMcpUrl('http://internal-mcp.company.local/sse', {
    allowedHosts: ['internal-mcp.company.local'],
  });
  assert.equal(explicitRes.allowed, true);
});

test('SseMcpServerAdapter: handles tools/list, tools/call, and egress enforcement', async () => {
  // 1. Throws on forbidden loopback URL during instantiation
  assert.throws(
    () => {
      new SseMcpServerAdapter({
        serverId: 'bad-remote',
        url: 'http://127.0.0.1:9090/sse',
        capability: 'remote:test',
      });
    },
    (err: Error) => err instanceof McpError && /egress/i.test(err.message),
  );

  // 2. Mock fetch implementation for tools/list and tools/call
  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };

    if (body.method === 'tools/list') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            tools: [
              {
                name: 'fetch_weather',
                description: 'Dapatkan prakiraan cuaca',
                inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (body.method === 'tools/call') {
      const args = body.params['arguments'] as { city?: string };
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [{ type: 'text', text: `Cuaca di ${args.city ?? 'Jakarta'}: Cerah 30°C` }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 99, error: { code: -32601, message: 'Not found' } }), {
      status: 404,
    });
  };

  const adapter = new SseMcpServerAdapter({
    serverId: 'weather-server',
    url: 'https://weather.mcp.example.com/sse',
    capability: 'weather:read',
    fetchFn: mockFetch,
  });

  const tools = await adapter.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, 'fetch_weather');
  assert.equal(tools[0]?.capability, 'weather:read');

  const callRes = await adapter.callTool('fetch_weather', { city: 'Bandung' });
  assert.match(callRes.content, /Cuaca di Bandung: Cerah 30°C/);
  assert.equal(callRes.error, undefined);

  // 3. Registering with McpHub sanitizes output and applies untrusted tag
  const hub = new McpHub();
  const registeredTools = await hub.registerServer(
    {
      id: 'weather-server',
      name: 'Weather MCP Server',
      transport: 'sse',
      allowedCapabilities: ['weather:read'],
      riskLevel: 'MEDIUM',
    },
    adapter,
  );

  assert.equal(registeredTools.length, 1);
  assert.equal(registeredTools[0]?.name, 'mcp_weather-server_fetch_weather');

  const executionRes = await registeredTools[0]?.execute(
    { city: 'Surabaya' },
    { signal: new AbortController().signal },
  );

  assert.equal(executionRes?.isUntrusted, true);
  assert.equal(executionRes?.isInstruction, false);
  assert.match(executionRes?.content ?? '', /<untrusted_content/);
  assert.match(executionRes?.content ?? '', /Cuaca di Surabaya: Cerah 30°C/);
});
