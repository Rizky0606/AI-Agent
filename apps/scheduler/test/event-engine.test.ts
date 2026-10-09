import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionEngine } from '@personal-ai-os/permissions';
import { EventEngine } from '../src/event-engine.ts';
import { EventValidationError } from '../src/types.ts';

test('EventEngine: validates event structure and rejects damaged or incomplete envelopes', async () => {
  const engine = new EventEngine();

  // Missing id
  await assert.rejects(
    async () => {
      await engine.processEvent({
        source: 'internal:test',
        type: 'test.event',
        timestamp: new Date().toISOString(),
        payload: {},
      });
    },
    (err: Error) => err instanceof EventValidationError && /id/i.test(err.message),
  );

  // Missing source
  await assert.rejects(
    async () => {
      await engine.processEvent({
        id: 'ev-1',
        type: 'test.event',
        timestamp: new Date().toISOString(),
        payload: {},
      });
    },
    (err: Error) => err instanceof EventValidationError && /source/i.test(err.message),
  );

  // Invalid timestamp
  await assert.rejects(
    async () => {
      await engine.processEvent({
        id: 'ev-1',
        source: 'internal:test',
        type: 'test.event',
        timestamp: 'invalid-date',
        payload: {},
      });
    },
    (err: Error) => err instanceof EventValidationError && /timestamp/i.test(err.message),
  );
});

test('EventEngine: deduplicates duplicate events from internal and external sources within window', async () => {
  const engine = new EventEngine({ dedupWindowMs: 5000 });

  const event = {
    id: 'evt-unique-123',
    source: 'external:github_webhook',
    type: 'github.push',
    timestamp: new Date().toISOString(),
    payload: { repo: 'ai-agent', ref: 'refs/heads/master' },
  };

  // 1. First event is accepted
  const res1 = await engine.processEvent(event);
  assert.equal(res1.accepted, true);
  assert.equal(res1.duplicate, false);

  // 2. Duplicate event within window is rejected
  const res2 = await engine.processEvent(event);
  assert.equal(res2.accepted, false);
  assert.equal(res2.duplicate, true);

  // 3. Different event id or payload is accepted
  const res3 = await engine.processEvent({
    ...event,
    id: 'evt-unique-124',
  });
  assert.equal(res3.accepted, true);
  assert.equal(res3.duplicate, false);
});

test('EventEngine: enforces Permission Engine gate on event-triggered tasks and prevents bypass', async () => {
  const permissionEngine = new PermissionEngine();
  const createdTasks: Array<{ ruleId: string; decision: string }> = [];

  const engine = new EventEngine({
    permissionEngine,
    taskDispatcher: async ({ ruleId, decision }) => {
      createdTasks.push({ ruleId, decision: decision.decision });
      return `task-${Date.now()}`;
    },
  });

  // Rule A: Safe Low-Risk Action (read logs) -> allowed
  engine.registerRule({
    id: 'rule-safe-metric',
    name: 'Log on task failure',
    eventType: 'task.failed',
    targetAction: {
      action: 'fs:read',
      resource: 'workspace://logs',
      scope: 'workspace',
      riskLevel: 'LOW',
    },
    createTaskPayload: () => ({ kind: 'diagnose', input: {} }),
  });

  // Rule B: High-Risk Action (push to Git or deploy) -> MUST require approval (Rule 9)
  engine.registerRule({
    id: 'rule-high-risk-deploy',
    name: 'Deploy on task complete',
    eventType: 'task.completed',
    targetAction: {
      action: 'deploy:production',
      resource: 'server://production',
      scope: 'production',
      riskLevel: 'HIGH',
    },
    createTaskPayload: () => ({ kind: 'deploy', input: {} }),
  });

  // 1. Process Low-Risk event
  const safeRes = await engine.processEvent({
    id: 'evt-low-1',
    source: 'internal:task_monitor',
    type: 'task.failed',
    timestamp: new Date().toISOString(),
    payload: { taskId: 't-123' },
  });

  assert.equal(safeRes.accepted, true);
  assert.equal(safeRes.dispatchedTasks.length, 1);
  assert.equal(safeRes.dispatchedTasks[0]?.permissionDecision, 'allow');
  assert.equal(safeRes.dispatchedTasks[0]?.approvalRequired, false);

  // 2. Process High-Risk event
  const highRiskRes = await engine.processEvent({
    id: 'evt-high-1',
    source: 'internal:ci_pipeline',
    type: 'task.completed',
    timestamp: new Date().toISOString(),
    payload: { taskId: 't-124' },
  });

  assert.equal(highRiskRes.accepted, true);
  assert.equal(highRiskRes.dispatchedTasks.length, 1);
  // HIGH RISK CANNOT BYPASS PERMISSION ENGINE!
  assert.equal(highRiskRes.dispatchedTasks[0]?.permissionDecision, 'require_approval');
  assert.equal(highRiskRes.dispatchedTasks[0]?.approvalRequired, true);
});
