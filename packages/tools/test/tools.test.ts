import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ApprovalRequiredError,
  PermissionDeniedError,
  PermissionEngine,
  SecuredCapabilityGuard,
} from '@personal-ai-os/permissions';
import {
  createWebFetchTool,
  createWorkspaceReadFileTool,
  SsrfGuard,
  ToolCancelledError,
  type ToolDefinition,
  ToolInputValidationError,
  ToolRegistry,
  ToolTimeoutError,
} from '../src/index.ts';

test('ToolRegistry rejects tool call without permission (deny-by-default)', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const unauthorizedTool: ToolDefinition = {
    name: 'unauthorized_action',
    description: 'A tool that performs an unauthorized action',
    capability: 'dangerous:exploit',
    resourceScope: 'system',
    riskLevel: 'HIGH',
    action: 'dangerous:exploit', // Not recognized in PermissionEngine -> deny
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 1024,
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async () => 'should not run',
  };

  registry.registerTool(unauthorizedTool);

  await assert.rejects(
    async () =>
      registry.executeTool({
        toolName: 'unauthorized_action',
        input: {},
        context: {
          actor: { id: 'user-1', role: 'user' },
        },
      }),
    (err: unknown) => err instanceof PermissionDeniedError,
  );
});

test('ToolRegistry rejects high-risk tool call without approval', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const highRiskTool: ToolDefinition = {
    name: 'deploy_to_prod',
    description: 'Deploy code to production',
    capability: 'deploy:service',
    resourceScope: 'cloud',
    riskLevel: 'HIGH',
    action: 'deploy:release', // HIGH risk action
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 1024,
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async () => 'deployed',
  };

  registry.registerTool(highRiskTool);

  await assert.rejects(
    async () =>
      registry.executeTool({
        toolName: 'deploy_to_prod',
        input: {},
        context: {
          actor: { id: 'user-1', role: 'user' },
        },
      }),
    (err: unknown) => err instanceof ApprovalRequiredError,
  );
});

test('ToolRegistry validates input schema and rejects invalid input', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const strictTool: ToolDefinition<{ count: number }, string> = {
    name: 'strict_counter',
    description: 'Requires a positive count',
    capability: 'compute:calc',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:read',
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 1024,
    inputValidator: (input: unknown) => {
      const rec = input as Record<string, unknown>;
      if (typeof rec?.count !== 'number' || rec.count <= 0) {
        return { valid: false, error: 'count harus bertipe angka positif.' };
      }
      return { valid: true, data: input as { count: number } };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (inp) => `Counted ${inp.count}`,
  };

  registry.registerTool(strictTool);

  await assert.rejects(
    async () =>
      registry.executeTool({
        toolName: 'strict_counter',
        input: { count: -5 },
        context: {
          actor: { id: 'user-1' },
        },
      }),
    (err: unknown) =>
      err instanceof ToolInputValidationError &&
      /count harus bertipe angka positif/.test(err.message),
  );
});

test('ToolRegistry truncates output exceeding outputLimitBytes with clear marker', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const verboseTool: ToolDefinition<unknown, string> = {
    name: 'verbose_generator',
    description: 'Generates large text output',
    capability: 'text:generate',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:read',
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 256, // small limit for testing
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async () => 'A'.repeat(2000), // 2000 bytes
  };

  registry.registerTool(verboseTool);

  const result = await registry.executeTool({
    toolName: 'verbose_generator',
    input: {},
    context: {
      actor: { id: 'user-1' },
    },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.truncated, true);
  assert.match(
    result.data as string,
    /\[OUTPUT TRUNCATED: Exceeded limit of 256 bytes\. Original size was 2000 bytes\.\]/,
  );
});

test('ToolRegistry aborts when tool execution exceeds timeoutMs', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const slowTool: ToolDefinition = {
    name: 'slow_worker',
    description: 'Sleeps longer than timeout',
    capability: 'compute:slow',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:read',
    timeoutMs: 50, // 50ms timeout
    supportsCancellation: true,
    outputLimitBytes: 1024,
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (_inp, ctx) => {
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(res, 500);
        ctx.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          rej(new ToolCancelledError('slow_worker'));
        });
      });
      return 'done';
    },
  };

  registry.registerTool(slowTool);

  await assert.rejects(
    async () =>
      registry.executeTool({
        toolName: 'slow_worker',
        input: {},
        context: {
          actor: { id: 'user-1' },
        },
      }),
    (err: unknown) => err instanceof ToolTimeoutError && /50ms/.test(err.message),
  );
});

test('ToolRegistry aborts immediately when cancellation signal is triggered', async () => {
  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  const cancellableTool: ToolDefinition = {
    name: 'cancellable_worker',
    description: 'Can be cancelled',
    capability: 'compute:task',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:read',
    timeoutMs: 10000,
    supportsCancellation: true,
    outputLimitBytes: 1024,
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (_inp, ctx) => {
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(res, 5000);
        ctx.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          rej(new ToolCancelledError('cancellable_worker'));
        });
      });
      return 'done';
    },
  };

  registry.registerTool(cancellableTool);

  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 20);

  await assert.rejects(
    async () =>
      registry.executeTool({
        toolName: 'cancellable_worker',
        input: {},
        context: {
          actor: { id: 'user-1' },
          signal: abortController.signal,
        },
      }),
    (err: unknown) => err instanceof ToolCancelledError,
  );
});

test('workspace_read_file prevents path traversal outside workspace', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'workspace-test-'));
  const secretFile = join(tmpdir(), 'secret-outside.txt');
  await writeFile(secretFile, 'SUPER_SECRET_OUTSIDE');
  await writeFile(join(tmpDir, 'allowed.txt'), 'ALLOWED_WORKSPACE_CONTENT');

  const readFileTool = createWorkspaceReadFileTool(tmpDir);

  try {
    // 1. Valid workspace file reads cleanly
    const allowedRes = await readFileTool.execute(
      { path: 'allowed.txt' },
      { actor: { id: 'user-1' } },
    );
    assert.equal(allowedRes.content, 'ALLOWED_WORKSPACE_CONTENT');

    // 2. Path traversal with .. is strictly blocked
    await assert.rejects(
      async () =>
        readFileTool.execute({ path: '../secret-outside.txt' }, { actor: { id: 'user-1' } }),
      /Path traversal terdeteksi/,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(secretFile, { force: true }).catch(() => {});
  }
});

test('web_fetch enforces SSRF protection and blocks internal targets', async () => {
  const ssrfGuard = new SsrfGuard({ resolveDns: false });
  const fetchTool = createWebFetchTool(ssrfGuard);

  await assert.rejects(
    async () =>
      fetchTool.execute(
        { url: 'http://169.254.169.254/latest/meta-data/' },
        { actor: { id: 'user-1' } },
      ),
    /SSRF Protection.*diblokir/i,
  );

  await assert.rejects(
    async () =>
      fetchTool.execute({ url: 'http://127.0.0.1:8080/internal' }, { actor: { id: 'user-1' } }),
    /SSRF Protection.*diblokir/i,
  );
});
