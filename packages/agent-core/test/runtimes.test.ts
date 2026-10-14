import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine } from '@personal-ai-os/permissions';
import {
  AgentRouter,
  BaseAgentRuntime,
  RuntimeManager,
  type RuntimeCapability,
  type RuntimeExecuteInput,
  type RuntimeExecuteResult,
  type RuntimeHealth,
  type RuntimeProposedAction,
} from '../src/index.ts';

const CODING_CAPABILITIES: readonly RuntimeCapability[] = [
  { name: 'coding', description: 'Coding', level: 'write' },
];

/**
 * Test-local fake runtime. The worker registers no in-process adapter
 * (only RemoteRuntimeAdapter over the bridge), so these fixtures live here.
 */
class FakeRuntime extends BaseAgentRuntime {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly RuntimeCapability[];

  private readonly health: RuntimeHealth;
  private readonly proposedActions: RuntimeProposedAction[];

  constructor(opts: {
    id: string;
    name: string;
    version: string;
    health: RuntimeHealth;
    proposedActions?: RuntimeProposedAction[] | undefined;
    permissionEngine?: PermissionEngine | undefined;
  }) {
    super(opts.permissionEngine);
    this.id = opts.id;
    this.name = opts.name;
    this.version = opts.version;
    this.capabilities = CODING_CAPABILITIES;
    this.health = opts.health;
    this.proposedActions = opts.proposedActions ?? [];
  }

  async execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult> {
    const proposedActions = this.proposedActions;
    return {
      taskId: input.taskId,
      status: 'completed',
      output: 'Refactored auth module',
      durationMs: 0,
      // Runtime output is UNTRUSTED; it must be filtered before being trusted.
      untrustedOutputWarning: true,
      proposedActions,
      appliedActions: await this.filterUntrustedActions(proposedActions),
    };
  }

  async healthCheck(): Promise<RuntimeHealth> {
    return this.health;
  }
}

test('RuntimeManager: registers, manages lifecycle and health of runtimes', async () => {
  const manager = new RuntimeManager();

  const runtime = new FakeRuntime({
    id: 'omp',
    name: 'Test Coding Agent',
    version: '1.0.0',
    health: {
      healthy: true,
      lastChecked: new Date().toISOString(),
      details: 'test-runtime 1.0.0',
    },
  });

  manager.register(runtime);
  assert.equal(manager.getAllRuntimes().length, 1);
  assert.equal(manager.getRuntime('omp')?.name, 'Test Coding Agent');

  // Duplicate registration throws
  assert.throws(() => manager.register(runtime), /already registered/);

  // Health check
  const health = await manager.healthCheck('omp');
  assert.equal(health.healthy, true);
  assert.ok(health.details?.includes('1.0.0'));

  // Task lifecycle
  await manager.pauseTask('omp', 'task-1');
  await manager.resumeTask('omp', 'task-1');
  await manager.cancelTask('omp', 'task-1');

  // Capability querying
  const codingRuntimes = manager.findRuntimesForCapability('coding');
  assert.equal(codingRuntimes.length, 1);
  assert.equal(codingRuntimes[0]?.id, 'omp');

  const healthy = await manager.getHealthyRuntimeForCapability('coding');
  assert.equal(healthy?.id, 'omp');
});

test('Untrusted runtime output: enforced through PermissionEngine before being trusted', async () => {
  const permissions = new PermissionEngine([
    {
      pattern: /^file:read$/i,
      baseRisk: 'LOW',
      consequence: 'Read file',
      allowWithoutApproval: true,
    },
    {
      pattern: /^shell:exec$/i,
      baseRisk: 'HIGH',
      consequence: 'Execute shell command',
      allowWithoutApproval: false,
    },
  ]);

  const runtime = new FakeRuntime({
    id: 'fake-untrusted',
    name: 'Fake Untrusted Runtime',
    version: '1.0.0',
    health: { healthy: true, lastChecked: new Date().toISOString() },
    permissionEngine: permissions,
    proposedActions: [
      {
        id: 'act-1',
        type: 'file_write',
        action: 'file:read',
        resource: 'workspace/src/auth.ts',
        riskLevel: 'LOW',
      },
      {
        id: 'act-2',
        type: 'command',
        action: 'shell:exec',
        resource: 'workspace/rm -rf /',
        riskLevel: 'HIGH',
      },
    ],
  });

  const res = await runtime.execute({
    taskId: 'task-untrusted-1',
    prompt: 'Refactor auth and cleanup',
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.untrustedOutputWarning, true);
  assert.equal(res.proposedActions?.length, 2);

  // act-1 is allowed
  assert.equal(res.appliedActions?.[0]?.action.id, 'act-1');
  assert.equal(res.appliedActions?.[0]?.permissionGranted, true);
  assert.equal(res.appliedActions?.[0]?.executed, true);

  // act-2 is blocked by PermissionEngine
  assert.equal(res.appliedActions?.[1]?.action.id, 'act-2');
  assert.equal(res.appliedActions?.[1]?.permissionGranted, false);
  assert.equal(res.appliedActions?.[1]?.executed, false);
});

test('Runtime without PermissionEngine: untrusted output denied by default (fail-closed)', async () => {
  const runtime = new FakeRuntime({
    id: 'fake-no-engine',
    name: 'Fake Runtime Without PermissionEngine',
    version: '1.0.0',
    health: { healthy: true, lastChecked: new Date().toISOString() },
    proposedActions: [
      {
        id: 'act-1',
        type: 'command',
        action: 'shell:exec',
        resource: 'workspace/rm -rf /',
        riskLevel: 'HIGH',
      },
    ],
  });

  const res = await runtime.execute({ taskId: 'task-fail-closed', prompt: 'run cleanup' });

  assert.equal(res.untrustedOutputWarning, true);
  assert.equal(res.appliedActions?.length, 1);
  assert.equal(res.appliedActions?.[0]?.permissionGranted, false);
  assert.equal(res.appliedActions?.[0]?.executed, false);
});

test('AgentRouter: selects healthy runtime and automatically triggers fallback when primary runtime is unhealthy', async () => {
  const manager = new RuntimeManager();

  // Primary is UNHEALTHY (e.g. binary missing or error)
  const unhealthyOmp = new FakeRuntime({
    id: 'omp',
    name: 'Test Coding Agent',
    version: '1.0.0',
    health: {
      healthy: false,
      lastChecked: new Date().toISOString(),
      error: 'omp binary not found or crashed',
    },
  });

  // Fallback is HEALTHY
  const healthyPi = new FakeRuntime({
    id: 'pi',
    name: 'Test Fallback Agent',
    version: '1.1.0',
    health: {
      healthy: true,
      lastChecked: new Date().toISOString(),
      details: 'pi 1.1.0',
    },
  });

  manager.register(unhealthyOmp);
  manager.register(healthyPi);

  const router = new AgentRouter(undefined, undefined, manager);

  // Route task for coding
  const resolution = await router.routeWithHealth('Tolong perbaiki bug pada auth service di repo', {
    userId: 'user-1',
    preferredRuntimeId: 'omp',
  });

  // Primary was unhealthy, so router must have fallen back to the healthy one
  assert.equal(resolution.route.fallbackUsed, true);
  assert.equal(resolution.route.originalRuntimeId, 'omp');
  assert.equal(resolution.route.selectedRuntimeId, 'pi');
  assert.ok(resolution.route.fallbackReason?.includes('Fallback to "pi"'));
  assert.ok(resolution.route.reason.includes('[FALLBACK:'));
});
