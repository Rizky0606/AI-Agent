import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine } from '@personal-ai-os/permissions';
import {
  AgentRouter,
  HermesRuntimeAdapter,
  OmpRuntimeAdapter,
  OpenHandsRuntimeAdapter,
  PiRuntimeAdapter,
  RuntimeManager,
} from '../src/index.ts';

test('RuntimeManager: registers, manages lifecycle and health of runtimes', async () => {
  const manager = new RuntimeManager();

  const omp = new OmpRuntimeAdapter({
    commandRunner: async (_cmd, args) => {
      if (args[0] === '--help') {
        return { stdout: 'omp --mode json [options]', stderr: '', exitCode: 0 };
      }
      return { stdout: '{}', stderr: '', exitCode: 0 };
    },
  });

  manager.register(omp);
  assert.equal(manager.getAllRuntimes().length, 1);
  assert.equal(manager.getRuntime('omp')?.name, 'Oh-My-Pi Coding Agent');

  // Duplicate registration throws
  assert.throws(() => manager.register(omp), /already registered/);

  // Health check
  const health = await manager.healthCheck('omp');
  assert.equal(health.healthy, true);
  assert.ok(health.details?.includes('18.8.4'));

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

test('OmpRuntimeAdapter & PiRuntimeAdapter: enforce untrusted output boundaries via PermissionEngine', async () => {
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

  const omp = new OmpRuntimeAdapter({
    permissionEngine: permissions,
    commandRunner: async (_cmd, args) => {
      if (args[0] === '-p') {
        // Output proposed actions from untrusted runtime
        const responseJson = {
          response: 'Refactored auth module',
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
        };
        return { stdout: JSON.stringify(responseJson), stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  const res = await omp.execute({
    taskId: 'task-untrusted-1',
    prompt: 'Refactor auth and cleanup',
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.untrustedOutputWarning, true);
  assert.equal(res.proposedActions?.length, 2);

  // act-1 is allowed
  assert.equal(res.appliedActions?.[0]?.action.id, 'act-1');
  assert.equal(res.appliedActions?.[0]?.permissionGranted, true);

  // act-2 is blocked by PermissionEngine
  assert.equal(res.appliedActions?.[1]?.action.id, 'act-2');
  assert.equal(res.appliedActions?.[1]?.permissionGranted, false);
  assert.equal(res.appliedActions?.[1]?.executed, false);
});

test('Unverified runtimes (Hermes, OpenHands): rejected and report unhealthy per Rule 6 and assessment.md', async () => {
  const hermes = new HermesRuntimeAdapter();
  const openhands = new OpenHandsRuntimeAdapter();

  const hermesHealth = await hermes.healthCheck();
  assert.equal(hermesHealth.healthy, false);
  assert.ok(hermesHealth.error?.includes('NOT verified/installed'));

  const openhandsHealth = await openhands.healthCheck();
  assert.equal(openhandsHealth.healthy, false);
  assert.ok(openhandsHealth.error?.includes('NOT verified/installed'));

  // Execution fails immediately
  const hermesExec = await hermes.execute({ taskId: 'h-1', prompt: 'test' });
  assert.equal(hermesExec.status, 'failed');
  assert.ok(hermesExec.error?.includes('not verified or installed'));

  // Initialization throws per Rule 6
  await assert.rejects(async () => hermes.initialize(), /Refusing execution per Rule 6/);
});

test('AgentRouter: selects healthy runtime and automatically triggers fallback when primary runtime is unhealthy', async () => {
  const manager = new RuntimeManager();

  // OMP is UNHEALTHY (e.g. binary missing or error)
  const unhealthyOmp = new OmpRuntimeAdapter({
    commandRunner: async () => ({
      stdout: '',
      stderr: 'omp binary not found or crashed',
      exitCode: 127,
    }),
  });

  // Pi is HEALTHY
  const healthyPi = new PiRuntimeAdapter({
    commandRunner: async () => ({
      stdout: 'pi --mode json version 1.1.0',
      stderr: '',
      exitCode: 0,
    }),
  });

  manager.register(unhealthyOmp);
  manager.register(healthyPi);

  const router = new AgentRouter(undefined, undefined, manager);

  // Route task for coding
  const resolution = await router.routeWithHealth('Tolong perbaiki bug pada auth service di repo', {
    userId: 'user-1',
    preferredRuntimeId: 'omp',
  });

  // Primary OMP was unhealthy, so router must have fallen back to healthy Pi
  assert.equal(resolution.route.fallbackUsed, true);
  assert.equal(resolution.route.originalRuntimeId, 'omp');
  assert.equal(resolution.route.selectedRuntimeId, 'pi');
  assert.ok(resolution.route.fallbackReason?.includes('Fallback to "pi"'));
  assert.ok(resolution.route.reason.includes('[FALLBACK:'));
});
