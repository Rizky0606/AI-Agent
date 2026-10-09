import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CapabilityDisabledError,
  CapabilityRegistry,
} from '../src/security/capability-registry.ts';

test('CapabilityRegistry: All capabilities are default OFF', () => {
  const registry = new CapabilityRegistry();

  assert.equal(registry.isEnabled('filesystem'), false);
  assert.equal(registry.isEnabled('powershell'), false);
  assert.equal(registry.isEnabled('git'), false);
  assert.equal(registry.isEnabled('browser'), false);
  assert.equal(registry.isEnabled('screenshot'), false);
  assert.equal(registry.isEnabled('vscode'), false);
  assert.equal(registry.isEnabled('docker'), false);
});

test('CapabilityRegistry: Executing action when capability is OFF throws CapabilityDisabledError', () => {
  const registry = new CapabilityRegistry();

  assert.throws(
    () => {
      registry.assertCapabilityAllowed('powershell', 'exec');
    },
    (err: unknown) => {
      assert.ok(err instanceof CapabilityDisabledError);
      assert.equal(err.capability, 'powershell');
      assert.equal(err.code, 'CAPABILITY_DISABLED');
      return true;
    },
  );

  assert.throws(
    () => {
      registry.assertCapabilityAllowed('filesystem', 'read');
    },
    (err: unknown) => {
      assert.ok(err instanceof CapabilityDisabledError);
      assert.equal(err.capability, 'filesystem');
      return true;
    },
  );
});

test('CapabilityRegistry: Toggling capability ON permits execution within allowed scope', () => {
  const registry = new CapabilityRegistry();

  // Initially OFF
  assert.throws(() => registry.assertCapabilityAllowed('git', 'status'));

  // Turn ON
  registry.setCapability('git', true);
  assert.equal(registry.isEnabled('git'), true);

  // Now permitted
  assert.doesNotThrow(() => {
    registry.assertCapabilityAllowed('git', 'status');
  });

  // Action outside allowed list is rejected
  assert.throws(
    () => {
      registry.assertCapabilityAllowed('git', 'destructive_push_force');
    },
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, 'ACTION_NOT_PERMITTED');
      return true;
    },
  );
});

test('CapabilityRegistry: VS Code and Docker require explicit opt-in', () => {
  const registry = new CapabilityRegistry();
  const allRules = registry.getAllRules();

  assert.equal(allRules.vscode.requiresExplicitOptIn, true);
  assert.equal(allRules.docker.requiresExplicitOptIn, true);

  // Both start OFF
  assert.equal(registry.isEnabled('vscode'), false);
  assert.equal(registry.isEnabled('docker'), false);

  // Explicit opt-in enables them
  registry.setCapability('docker', true);
  assert.equal(registry.isEnabled('docker'), true);
  assert.doesNotThrow(() => {
    registry.assertCapabilityAllowed('docker', 'ps');
  });
});
