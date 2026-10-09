import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine } from '@personal-ai-os/permissions';
import { type HealingIncident, SelfHealingEngine } from '../src/index.ts';

test('SelfHealingEngine: successfully diagnoses, repairs, tests and resolves incident in dev environment', async () => {
  const permissions = new PermissionEngine([
    {
      pattern: /^code:patch$/i,
      baseRisk: 'LOW',
      consequence: 'Patch code in dev',
      allowWithoutApproval: true,
    },
  ]);

  let patchApplied = false;
  let testPasses = false;

  const engine = new SelfHealingEngine({
    permissionEngine: permissions,
    maxAttempts: 3,
    handlers: {
      collectEvidence: async (inc) => ({
        incidentId: inc.id,
        logs: ['SyntaxError: Unexpected token'],
        failingTestNames: ['src/parser.test.ts'],
        affectedFiles: ['src/parser.ts'],
      }),
      diagnose: async (inc) => ({
        incidentId: inc.id,
        category: 'syntax',
        rootCause: 'Missing closing bracket on line 42',
        confidence: 0.95,
      }),
      propose: async (inc, diag, attempt) => ({
        id: `prop-${attempt}`,
        incidentId: inc.id,
        action: 'code:patch',
        resource: 'workspace/src/parser.ts',
        scope: 'dev:repair',
        riskLevel: 'LOW',
        patchDescription: 'Add closing bracket',
        rationale: diag.rootCause,
      }),
      apply: async () => {
        patchApplied = true;
        testPasses = true; // After applying, test will pass
        return true;
      },
      test: async () => ({
        passed: testPasses,
        output: testPasses ? '1 suite passed, 0 failed' : 'SyntaxError',
      }),
    },
  });

  const incident: HealingIncident = {
    id: 'inc-01',
    targetResource: 'workspace/src/parser.ts',
    environment: 'development',
    errorMessage: 'SyntaxError: Unexpected token',
    detectedAt: new Date().toISOString(),
  };

  const res = await engine.run(incident);

  assert.equal(res.status, 'resolved');
  assert.equal(res.totalAttempts, 1);
  assert.equal(patchApplied, true);
  assert.equal(res.finalStage, 'resolved');
  assert.ok(res.summary.includes('successfully resolved'));
});

test('SelfHealingEngine: bounded repair stops and escalates when max attempts are reached without infinite loop', async () => {
  const permissions = new PermissionEngine([
    {
      pattern: /^remediate_resource$/i,
      baseRisk: 'LOW',
      consequence: 'Remediate resource in dev',
      allowWithoutApproval: true,
    },
  ]);

  let rollbackCount = 0;
  let applyCount = 0;

  const engine = new SelfHealingEngine({
    permissionEngine: permissions,
    maxAttempts: 3, // Bounded at 3
    handlers: {
      apply: async () => {
        applyCount++;
        return true;
      },
      test: async () => ({
        passed: false, // Always fails
        output: 'AssertionError: Expected 200 OK but received 500 Internal Error',
      }),
      rollback: async () => {
        rollbackCount++;
        return true;
      },
    },
  });

  const incident: HealingIncident = {
    id: 'inc-flaky-02',
    targetResource: 'workspace/src/api.ts',
    environment: 'development',
    errorMessage: 'Persistent HTTP 500 failure',
    detectedAt: new Date().toISOString(),
  };

  const res = await engine.run(incident);

  // Must stop after exactly 3 attempts and escalate
  assert.equal(res.status, 'escalated');
  assert.equal(res.totalAttempts, 3);
  assert.equal(applyCount, 3);
  assert.equal(rollbackCount, 3); // Every failed attempt is rolled back
  assert.equal(res.finalStage, 'escalated');
  assert.ok(res.escalationReason?.includes('Max repair attempts (3) exhausted'));
});

test('SelfHealingEngine: STRICTLY blocks automated changes in production environment and escalates for approval', async () => {
  const permissions = new PermissionEngine([
    {
      pattern: /^remediate_resource$/i,
      baseRisk: 'LOW',
      consequence: 'Remediate resource',
      allowWithoutApproval: true,
    },
  ]);

  let applyCalled = false;

  const engine = new SelfHealingEngine({
    permissionEngine: permissions,
    maxAttempts: 3,
    handlers: {
      apply: async () => {
        applyCalled = true;
        return true;
      },
    },
  });

  const productionIncident: HealingIncident = {
    id: 'inc-prod-03',
    targetResource: 'production/db/schema.sql',
    environment: 'production', // PRODUCTION environment!
    errorMessage: 'Database connection pool exhausted in production cluster',
    detectedAt: new Date().toISOString(),
  };

  const res = await engine.run(productionIncident);

  // In production, automated changes MUST NOT be applied automatically
  assert.equal(res.status, 'escalated');
  assert.equal(applyCalled, false);
  assert.ok(res.requiresApprovalBinding !== undefined);
  assert.equal(res.attempts[0]?.permissionDecision, 'require_approval');
  assert.ok(res.summary.includes('Production changes require explicit human approval'));
});

test('SelfHealingEngine: halts and escalates immediately when PermissionEngine denies proposed remediation', async () => {
  // Empty rules list -> deny-by-default for all unrecognized actions
  const permissions = new PermissionEngine([]);

  let applyCalled = false;

  const engine = new SelfHealingEngine({
    permissionEngine: permissions,
    handlers: {
      propose: async (inc) => ({
        id: 'prop-deny',
        incidentId: inc.id,
        action: 'fs:delete',
        resource: 'workspace/node_modules',
        scope: 'cleanup',
        riskLevel: 'HIGH',
        patchDescription: 'Delete node_modules to clear cache',
        rationale: 'Try clearing cache',
      }),
      apply: async () => {
        applyCalled = true;
        return true;
      },
    },
  });

  const incident: HealingIncident = {
    id: 'inc-deny-04',
    targetResource: 'workspace/node_modules',
    environment: 'development',
    errorMessage: 'Corrupt module cache',
    detectedAt: new Date().toISOString(),
  };

  const res = await engine.run(incident);

  assert.equal(res.status, 'escalated');
  assert.equal(applyCalled, false);
  assert.equal(res.attempts[0]?.permissionDecision, 'deny');
  assert.ok(res.escalationReason?.includes('Permission denied'));
});
