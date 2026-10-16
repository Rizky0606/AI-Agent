import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { ToolRegistry, createWebFetchTool, type ToolDefinition } from '@personal-ai-os/tools';
import { LocalResearchEnvironment } from '../src/index.ts';

function environmentWith(fetchImpl: (url: string) => Promise<Response>): LocalResearchEnvironment {
  const registry = new ToolRegistry(new SecuredCapabilityGuard(new PermissionEngine()));
  registry.registerTool(
    createWebFetchTool(undefined, (input: RequestInfo | URL) => fetchImpl(String(input))),
  );
  return new LocalResearchEnvironment({
    registry,
    context: { actor: { id: 'user-1', role: 'user' }, taskId: 'task-1', projectId: 'proj-1' },
  });
}

test('LocalResearchEnvironment rejects pages whose output the registry had to truncate', async () => {
  const registry = new ToolRegistry(new SecuredCapabilityGuard(new PermissionEngine()));
  // Registered ahead of web_fetch so the registry's oversized-output path is exercised with a
  // cheap payload instead of a real megabyte page.
  const oversized: ToolDefinition<{ url: string }, { url: string; status: number; content: string }> = {
    name: 'web_fetch',
    description: 'test double',
    capability: 'web:fetch',
    resourceScope: 'global',
    riskLevel: 'LOW',
    action: 'web:fetch',
    timeoutMs: 5000,
    supportsCancellation: false,
    outputLimitBytes: 512,
    inputValidator: (input: unknown) =>
      typeof input === 'object' && input !== null && 'url' in input
        ? { valid: true, data: input as { url: string } }
        : { valid: false, error: 'url required' },
    healthCheck: async () => ({
      status: 'healthy' as const,
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input) => ({
      url: input.url,
      status: 200,
      content: `<html><body>${'pad '.repeat(500)}</body></html>`,
    }),
  };
  registry.registerTool(oversized);

  const environment = new LocalResearchEnvironment({
    registry,
    context: { actor: { id: 'user-1', role: 'user' } },
  });

  await assert.rejects(
    async () => environment.fetchContent('https://example.com/huge'),
    /melebihi batas output web_fetch/,
  );
});

test('LocalResearchEnvironment drops pages whose extracted text is not readable prose', async () => {
  const scriptOnly = environmentWith(async () =>
    new Response(
      `<html><head><title>App</title><script>${'var x="'.repeat(200)};'.repeat(1)}</script></head><body><div id="root"></div></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
  );

  await assert.rejects(
    async () => scriptOnly.fetchContent('https://example.com/spa'),
    /terlalu pendek/,
  );
});

test('LocalResearchEnvironment returns extracted text and the page title for a readable page', async () => {
  const environment = environmentWith(async () =>
    new Response(
      `<html><head><title>Durable execution &amp; checkpoints</title><style>body{color:red}</style></head><body><p>Durable execution persists each workflow step so a crash resumes from the last checkpoint instead of restarting the whole run. Engines that implement it keep the workflow history in a store the application can query, and they replay completed steps from that history after a failure.</p></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
  );

  const page = await environment.fetchContent('https://example.com/durable');

  assert.equal(page.title, 'Durable execution & checkpoints');
  assert.match(page.content, /persists each workflow step/);
  assert.doesNotMatch(page.content, /color:red/);
  assert.equal(page.url, 'https://example.com/durable');
});
