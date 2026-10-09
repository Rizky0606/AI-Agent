import assert from 'node:assert/strict';
import test from 'node:test';
import {
  McpHub,
  type McpServerAdapter,
  type McpServerConfig,
  type McpToolDescriptor,
  sanitizeMcpOutput,
} from '../src/index.ts';

test('sanitizeMcpOutput strips ANSI control codes, redacts secrets, and wraps as untrusted non-instruction', () => {
  const rawInput =
    '\u001b[31mError occurred\u001b[0m while connecting with api_key="sk-live-secret-abcdef123456" and Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc.';

  const result = sanitizeMcpOutput(rawInput, 'srv-1', 'fetch_data');

  assert.equal(result.isUntrusted, true);
  assert.equal(result.isInstruction, false);
  // ANSI stripped
  assert.ok(!result.sanitized.includes('\u001b[31m'));
  // Secrets redacted
  assert.ok(!result.sanitized.includes('sk-live-secret-abcdef123456'));
  assert.ok(result.sanitized.includes('[REDACTED_SECRET]'));
  // Wrapped inside untrusted boundaries
  assert.match(
    result.wrappedContent,
    /<untrusted_content source="mcp:srv-1\/fetch_data" is_instruction="false">/,
  );
  assert.match(result.wrappedContent, /<\/untrusted_content>/);
});

test('McpHub restricts external tools to capability allowlist and audits calls', async () => {
  const auditEntries: unknown[] = [];
  const hub = new McpHub({
    auditSink: (entry) => {
      auditEntries.push(entry);
    },
  });

  const mockAdapter: McpServerAdapter = {
    async listTools(): Promise<McpToolDescriptor[]> {
      return [
        {
          name: 'read_doc',
          description: 'Reads public documentation',
          capability: 'docs:read',
        },
        {
          name: 'drop_database',
          description: 'Malicious unauthorized tool',
          capability: 'db:destructive_drop', // NOT in allowedCapabilities
        },
      ];
    },
    async callTool(name: string) {
      if (name === 'read_doc') {
        return {
          content: 'Here is documentation text: apiKey=secret_1234567890abcdef.',
        };
      }
      return { content: 'executed' };
    },
  };

  const config: McpServerConfig = {
    id: 'docs-server',
    name: 'External Docs Provider',
    transport: 'in_process',
    allowedCapabilities: ['docs:read'], // Only docs:read is allowed
    riskLevel: 'LOW',
  };

  // 1. Register server
  const toolDefs = await hub.registerServer(config, mockAdapter);

  // 'drop_database' was filtered out because db:destructive_drop is not allowed
  assert.equal(toolDefs.length, 1);
  assert.equal(toolDefs[0]!.name, 'mcp_docs-server_read_doc');

  // 2. Call allowed tool
  const callRes = await hub.callTool('docs-server', 'read_doc', { docId: 'readme' }, 'trace-123');

  assert.equal(callRes.isUntrusted, true);
  assert.equal(callRes.isInstruction, false);
  assert.ok(callRes.sanitizedContent.includes('<untrusted_content'));
  assert.ok(callRes.sanitizedContent.includes('[REDACTED_SECRET]'));

  // 3. Verify audit trail was logged
  assert.equal(auditEntries.length, 1);
  const audit = auditEntries[0] as {
    serverId: string;
    toolName: string;
    status: string;
  };
  assert.equal(audit.serverId, 'docs-server');
  assert.equal(audit.toolName, 'read_doc');
  assert.equal(audit.status, 'success');
});
