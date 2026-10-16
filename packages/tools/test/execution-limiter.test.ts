import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  ExecutionLimitExceededError,
  ExecutionLimiter,
  type ToolDefinition,
  ToolRegistry,
} from '../src/index.ts';

const context = { actor: { id: 'user-1' } };

function limitedRegistry(limiter: ExecutionLimiter): ToolRegistry {
  return new ToolRegistry(new SecuredCapabilityGuard(new PermissionEngine()), limiter);
}

function echoTool(onStart?: () => Promise<void>): ToolDefinition<Record<string, never>, string> {
  return {
    name: 'limited_tool',
    description: 'Echoes a value, optionally waiting for a gate',
    capability: 'compute:echo',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:read',
    timeoutMs: 5000,
    supportsCancellation: true,
    outputLimitBytes: 1024,
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async () => {
      await onStart?.();
      return 'ok';
    },
  };
}

test('ToolRegistry refuses a call beyond the in-flight cap with ExecutionLimitExceededError', async () => {
  const registry = limitedRegistry(
    new ExecutionLimiter({ maxInFlight: 1, maxStartsPerInterval: 100 }),
  );
  const gate = Promise.withResolvers<void>();
  registry.registerTool(echoTool(() => gate.promise));

  // The slot is taken synchronously, so the second call is refused while the first is running.
  const first = registry.executeTool({ toolName: 'limited_tool', input: {}, context });

  await assert.rejects(
    async () => registry.executeTool({ toolName: 'limited_tool', input: {}, context }),
    (err: unknown) =>
      err instanceof ExecutionLimitExceededError &&
      err.limit === 'in_flight' &&
      err.key === 'limited_tool' &&
      /maksimum 1 pemanggilan berjalan/.test(err.message),
  );

  gate.resolve();
  assert.equal((await first).status, 'success');
});

test('ToolRegistry allows calls up to the cap and frees the slot afterwards', async () => {
  const registry = limitedRegistry(
    new ExecutionLimiter({ maxInFlight: 2, maxStartsPerInterval: 100 }),
  );
  const gate = Promise.withResolvers<void>();
  registry.registerTool(echoTool(() => gate.promise));

  const calls = [
    registry.executeTool({ toolName: 'limited_tool', input: {}, context }),
    registry.executeTool({ toolName: 'limited_tool', input: {}, context }),
  ];
  gate.resolve();
  assert.deepEqual(
    (await Promise.all(calls)).map((result) => result.status),
    ['success', 'success'],
  );

  // Both slots were released, so a third call is still admitted.
  assert.equal(
    (await registry.executeTool({ toolName: 'limited_tool', input: {}, context })).status,
    'success',
  );
});

test('ToolRegistry refuses a call beyond the start-rate cap', async () => {
  const registry = limitedRegistry(
    new ExecutionLimiter({ maxInFlight: 10, maxStartsPerInterval: 2 }),
  );
  registry.registerTool(echoTool());

  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      (await registry.executeTool({ toolName: 'limited_tool', input: {}, context })).status,
      'success',
    );
  }

  await assert.rejects(
    async () => registry.executeTool({ toolName: 'limited_tool', input: {}, context }),
    (err: unknown) =>
      err instanceof ExecutionLimitExceededError &&
      err.limit === 'starts_per_interval' &&
      /maksimum 2 pemanggilan per 60000ms/.test(err.message),
  );
});

test('ExecutionLimiter.fromEnv reads caps from the environment', () => {
  process.env['TOOL_MAX_IN_FLIGHT'] = '1';
  process.env['TOOL_MAX_STARTS_PER_MINUTE'] = '7';
  try {
    const limiter = ExecutionLimiter.fromEnv('TOOL', { maxInFlight: 4, maxStartsPerInterval: 600 });
    limiter.acquire('limited_tool');
    assert.throws(
      () => limiter.acquire('limited_tool'),
      (err: unknown) => err instanceof ExecutionLimitExceededError && err.limit === 'in_flight',
    );
  } finally {
    delete process.env['TOOL_MAX_IN_FLIGHT'];
    delete process.env['TOOL_MAX_STARTS_PER_MINUTE'];
  }
});

test('ToolRegistry normalises a missing or invalid timeout to a finite default', () => {
  const registry = limitedRegistry(
    new ExecutionLimiter({ maxInFlight: 4, maxStartsPerInterval: 600 }),
  );

  registry.registerTool({ ...echoTool(), name: 'no_timeout_tool', timeoutMs: Number.NaN });
  registry.registerTool({ ...echoTool(), name: 'explicit_timeout_tool', timeoutMs: 1234 });

  assert.equal(registry.getTool('no_timeout_tool')?.timeoutMs, 30_000);
  assert.equal(registry.getTool('explicit_timeout_tool')?.timeoutMs, 1234);
});
