import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IllegalTaskStateTransitionError,
  TaskStateMachine,
  createVersionedCheckpoint,
  verifyCheckpointIntegrity,
  verifyStepBeforeExternalAction,
} from '../src/index.ts';

test('TaskStateMachine allows valid transitions', () => {
  // queued -> planning -> running -> waiting_approval -> running -> completed
  assert.equal(TaskStateMachine.canTransition('queued', 'planning'), true);
  assert.equal(TaskStateMachine.canTransition('planning', 'running'), true);
  assert.equal(TaskStateMachine.canTransition('running', 'waiting_approval'), true);
  assert.equal(TaskStateMachine.canTransition('waiting_approval', 'running'), true);
  assert.equal(TaskStateMachine.canTransition('running', 'completed'), true);

  // queued -> running
  assert.equal(TaskStateMachine.canTransition('queued', 'running'), true);

  // running -> paused -> queued / running
  assert.equal(TaskStateMachine.canTransition('running', 'paused'), true);
  assert.equal(TaskStateMachine.canTransition('paused', 'queued'), true);
  assert.equal(TaskStateMachine.canTransition('paused', 'running'), true);

  // running -> failed -> queued (retry)
  assert.equal(TaskStateMachine.canTransition('running', 'failed'), true);
  assert.equal(TaskStateMachine.canTransition('failed', 'queued'), true);

  // cancellation from active states
  assert.equal(TaskStateMachine.canTransition('queued', 'cancelled'), true);
  assert.equal(TaskStateMachine.canTransition('planning', 'cancelled'), true);
  assert.equal(TaskStateMachine.canTransition('running', 'cancelled'), true);
  assert.equal(TaskStateMachine.canTransition('paused', 'cancelled'), true);
});

test('TaskStateMachine rejects illegal transitions', () => {
  // Cannot complete directly from queued or paused
  assert.equal(TaskStateMachine.canTransition('queued', 'completed'), false);
  assert.equal(TaskStateMachine.canTransition('paused', 'completed'), false);

  // Completed is terminal
  assert.equal(TaskStateMachine.canTransition('completed', 'running'), false);
  assert.equal(TaskStateMachine.canTransition('completed', 'queued'), false);
  assert.equal(TaskStateMachine.canTransition('completed', 'cancelled'), false);

  // Cancelled is terminal
  assert.equal(TaskStateMachine.canTransition('cancelled', 'running'), false);
  assert.equal(TaskStateMachine.canTransition('cancelled', 'queued'), false);
  assert.equal(TaskStateMachine.canTransition('cancelled', 'completed'), false);

  // assertTransition throws IllegalTaskStateTransitionError
  assert.throws(
    () => TaskStateMachine.assertTransition('completed', 'running'),
    (err) => err instanceof IllegalTaskStateTransitionError,
  );
});

test('TaskStateMachine checks terminal states correctly', () => {
  assert.equal(TaskStateMachine.isTerminal('completed'), true);
  assert.equal(TaskStateMachine.isTerminal('cancelled'), true);
  assert.equal(TaskStateMachine.isTerminal('running'), false);
  assert.equal(TaskStateMachine.isTerminal('queued'), false);
  assert.equal(TaskStateMachine.isTerminal('failed'), false);
});

test('Versioned checkpoint creation, integrity check, and external action verification', () => {
  // 1. Create versioned checkpoint
  const cp1 = createVersionedCheckpoint({
    version: 1,
    stepIndex: 2,
    totalSteps: 5,
    lastExecutedAction: 'fetch_data',
    actionType: 'internal',
    actionState: { itemsCount: 42 },
  });

  assert.equal(cp1.version, 1);
  assert.equal(cp1.stepIndex, 2);
  assert.equal(typeof cp1.checksum, 'string');
  assert.equal(verifyCheckpointIntegrity(cp1), true);

  // 2. Tampered checkpoint fails integrity
  const tampered = { ...cp1, lastExecutedAction: 'tampered_action' };
  assert.equal(verifyCheckpointIntegrity(tampered), false);

  // 3. Verification before external action:
  // Clean start (no prior checkpoint) -> can proceed
  const cleanResult = verifyStepBeforeExternalAction(null, {
    name: 'deploy_service',
    isExternal: true,
  });
  assert.equal(cleanResult.canProceed, true);

  // Unverified external tool checkpoint after restart -> blocked
  const unverifiedExternalCp = createVersionedCheckpoint({
    version: 2,
    stepIndex: 3,
    totalSteps: 5,
    lastExecutedAction: 'execute_git_push',
    actionType: 'external_tool',
    verified: false,
  });
  const blockedResult = verifyStepBeforeExternalAction(unverifiedExternalCp, {
    name: 'call_external_webhook',
    isExternal: true,
  });
  assert.equal(blockedResult.canProceed, false);
  assert.equal(blockedResult.requiresVerification, true);

  // Verified external tool checkpoint -> can proceed
  const verifiedExternalCp = { ...unverifiedExternalCp, verified: true };
  const allowedResult = verifyStepBeforeExternalAction(verifiedExternalCp, {
    name: 'call_external_webhook',
    isExternal: true,
  });
  assert.equal(allowedResult.canProceed, true);
});
