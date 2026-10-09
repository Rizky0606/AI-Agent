import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';
import { InMemoryTaskRepository } from '../src/db/task-repository.ts';
import { InMemoryApprovalRepository } from '../src/db/approval-repository.ts';
import { InMemoryAuditRepository } from '../src/db/audit-repository.ts';
import { InMemoryTaskEventBroadcaster } from '../src/services/event-broadcaster.ts';
import { InMemoryTaskQueue } from '../src/services/task-queue.ts';
import { computeApprovalFingerprint } from '@personal-ai-os/permissions';

const setupApprovalTest = async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-secret-test-secret-test-secret-32');
  const projectRepo = new InMemoryProjectRepository();
  const taskRepo = new InMemoryTaskRepository();
  const approvalRepo = new InMemoryApprovalRepository();
  const auditRepo = new InMemoryAuditRepository();
  const taskQueue = new InMemoryTaskQueue({ autoDispatch: false });
  const broadcaster = new InMemoryTaskEventBroadcaster();

  const app = await buildApp({
    auth,
    task: { projectRepo, taskRepo, taskQueue, broadcaster },
    approval: {
      approvalRepo,
      taskRepo,
      taskQueue,
      broadcaster,
      auditRepo,
    },
  });

  const alice = await auth.register('alice@approval.com', 'password-123456');
  const bob = await auth.register('bob@approval.com', 'password-123456');
  const project = await projectRepo.createProject(alice.user.id, 'Alice Project');

  return {
    app,
    auth,
    alice,
    bob,
    project,
    taskRepo,
    approvalRepo,
    auditRepo,
    taskQueue,
    broadcaster,
  };
};

test('Approval Inbox: list, detail, and strict multi-tenant authorization', async () => {
  const { app, alice, bob, project, approvalRepo } = await setupApprovalTest();

  const fingerprint = computeApprovalFingerprint(
    'git:push',
    'repo://personal-ai-os',
    'workspace',
    'HIGH',
  );

  const approval1 = await approvalRepo.createApproval({
    userId: alice.user.id,
    projectId: project.id,
    action: 'git:push',
    resource: 'repo://personal-ai-os',
    scope: 'workspace',
    riskLevel: 'HIGH',
    consequence: 'Pushing changes directly to remote repository',
    fingerprint,
    expiresInSeconds: 3600,
  });

  // 1. Alice lists approvals inbox
  const aliceListRes = await app.inject({
    method: 'GET',
    url: '/v1/approvals',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(aliceListRes.statusCode, 200);
  const aliceList = aliceListRes.json().approvals;
  assert.equal(aliceList.length, 1);
  assert.equal(aliceList[0].id, approval1.id);
  assert.equal(aliceList[0].riskLevel, 'HIGH');

  // 2. Bob lists approvals inbox (multi-tenant isolation)
  const bobListRes = await app.inject({
    method: 'GET',
    url: '/v1/approvals',
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobListRes.statusCode, 200);
  assert.equal(bobListRes.json().approvals.length, 0);

  // 3. Bob attempts to access Alice's approval detail -> 404
  const bobDetailRes = await app.inject({
    method: 'GET',
    url: `/v1/approvals/${approval1.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobDetailRes.statusCode, 404);

  // 4. Alice accesses her own approval detail -> 200
  const aliceDetailRes = await app.inject({
    method: 'GET',
    url: `/v1/approvals/${approval1.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(aliceDetailRes.statusCode, 200);
  assert.equal(aliceDetailRes.json().id, approval1.id);
  assert.equal(aliceDetailRes.json().status, 'pending');

  await app.close();
});

test('Approve workflow: transitions task to queued, re-enqueues, emits event, and writes redacted audit log', async () => {
  const { app, alice, project, taskRepo, approvalRepo, auditRepo, taskQueue, broadcaster } =
    await setupApprovalTest();

  // Create a task waiting for approval
  const { task } = await taskRepo.createTask({
    userId: alice.user.id,
    projectId: project.id,
    kind: 'deploy_task',
    payload: { target: 'production' },
  });
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'running');
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'waiting_approval');

  const fingerprint = computeApprovalFingerprint(
    'system:deploy',
    'cluster://production',
    'infra',
    'HIGH',
  );

  const approval = await approvalRepo.createApproval({
    userId: alice.user.id,
    taskId: task.id,
    projectId: project.id,
    action: 'system:deploy',
    resource: 'cluster://production',
    scope: 'infra',
    riskLevel: 'HIGH',
    consequence: 'Triggering deployment pipeline to production',
    fingerprint,
    expiresInSeconds: 3600,
  });

  // Track events emitted
  const events: string[] = [];
  broadcaster.subscribeUser(alice.user.id, (evt) => {
    events.push(evt.eventType);
  });

  // Alice approves the request
  const approveRes = await app.inject({
    method: 'POST',
    url: `/v1/approvals/${approval.id}/approve`,
    headers: {
      authorization: `Bearer ${alice.accessToken}`,
      'x-trace-id': 'trace-approval-test-123',
    },
    payload: {
      reason: 'Deployment verified and signed off',
    },
  });

  assert.equal(approveRes.statusCode, 200);
  const updatedApproval = approveRes.json().approval;
  assert.equal(updatedApproval.status, 'approved');
  assert.equal(updatedApproval.approverId, alice.user.id);

  // Verify task status was updated to 'running' so worker picks it up
  const updatedTask = await taskRepo.getTask(alice.user.id, task.id);
  assert.equal(updatedTask?.status, 'running');

  // Verify task re-enqueued in taskQueue
  assert.ok(taskQueue.getEnqueuedJob(task.id));

  // Verify task.resumed event emitted
  assert.ok(events.includes('task.resumed'));

  // Verify audit log captured without secrets
  const logs = await auditRepo.listAuditLogs(alice.user.id);
  assert.ok(logs.length >= 1);
  const auditEntry = logs.find((l) => l.action === 'approval:approved');
  assert.ok(auditEntry);
  assert.equal(auditEntry.decision, 'allow');
  assert.equal(auditEntry.traceId, 'trace-approval-test-123');
  assert.equal(auditEntry.resourceId, approval.id);

  // Attempting to approve again fails (single-use / final state)
  const duplicateApproveRes = await app.inject({
    method: 'POST',
    url: `/v1/approvals/${approval.id}/approve`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(duplicateApproveRes.statusCode, 400);

  await app.close();
});

test('Deny workflow: transitions task to failed, emits task.failed event, and audits rejection', async () => {
  const { app, alice, project, taskRepo, approvalRepo, auditRepo, broadcaster } =
    await setupApprovalTest();

  const { task } = await taskRepo.createTask({
    userId: alice.user.id,
    projectId: project.id,
    kind: 'destructive_task',
    payload: { command: 'drop database' },
  });
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'running');
  await taskRepo.updateTaskStatus(alice.user.id, task.id, 'waiting_approval');

  const fingerprint = computeApprovalFingerprint(
    'db:drop_database',
    'postgres://main',
    'system',
    'CRITICAL',
  );

  const approval = await approvalRepo.createApproval({
    userId: alice.user.id,
    taskId: task.id,
    projectId: project.id,
    action: 'db:drop_database',
    resource: 'postgres://main',
    scope: 'system',
    riskLevel: 'CRITICAL',
    consequence: 'Permanent deletion of all data',
    fingerprint,
    expiresInSeconds: 3600,
  });

  const events: string[] = [];
  broadcaster.subscribeUser(alice.user.id, (evt) => {
    events.push(evt.eventType);
  });

  const denyRes = await app.inject({
    method: 'POST',
    url: `/v1/approvals/${approval.id}/deny`,
    headers: {
      authorization: `Bearer ${alice.accessToken}`,
      'x-trace-id': 'trace-deny-critical-001',
    },
    payload: {
      reason: 'Too dangerous, operation rejected',
    },
  });

  assert.equal(denyRes.statusCode, 200);
  const updatedApproval = denyRes.json().approval;
  assert.equal(updatedApproval.status, 'denied');

  // Verify task status moved to failed
  const updatedTask = await taskRepo.getTask(alice.user.id, task.id);
  assert.equal(updatedTask?.status, 'failed');
  assert.ok(updatedTask?.error?.includes('Ditolak'));

  // Verify task.failed event emitted
  assert.ok(events.includes('task.failed'));

  // Verify audit log captured
  const logs = await auditRepo.listAuditLogs(alice.user.id);
  const auditEntry = logs.find((l) => l.action === 'approval:denied');
  assert.ok(auditEntry);
  assert.equal(auditEntry.decision, 'deny');
  assert.equal(auditEntry.traceId, 'trace-deny-critical-001');

  await app.close();
});

test('Expired approval cannot be approved', async () => {
  const { app, alice, project, approvalRepo } = await setupApprovalTest();

  const fingerprint = computeApprovalFingerprint('action:timed', 'res://timed', 'test', 'HIGH');

  const approval = await approvalRepo.createApproval({
    userId: alice.user.id,
    projectId: project.id,
    action: 'action:timed',
    resource: 'res://timed',
    scope: 'test',
    riskLevel: 'HIGH',
    consequence: 'Time sensitive operation',
    fingerprint,
    expiresInSeconds: -10, // Already expired
  });

  const res = await app.inject({
    method: 'POST',
    url: `/v1/approvals/${approval.id}/approve`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, 'APPROVAL_EXPIRED');

  await app.close();
});

test('Audit log redacts secrets and sensitive tokens automatically', async () => {
  const { alice, auditRepo } = await setupApprovalTest();

  await auditRepo.log({
    userId: alice.user.id,
    actorId: alice.user.id,
    action: 'security:test_credentials',
    resourceType: 'auth_service',
    decision: 'allow',
    metadata: {
      apiKey: 'sk-proj-secret-1234567890abcdef',
      password: 'super-secret-password-xyz',
      jwtToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
      normalField: 'hello-world',
    },
  });

  const logs = await auditRepo.listAuditLogs(alice.user.id);
  const log = logs.find((l) => l.action === 'security:test_credentials');
  assert.ok(log);

  const metadata = log.metadata as Record<string, unknown>;
  assert.equal(metadata.apiKey, '[REDACTED]');
  assert.equal(metadata.password, '[REDACTED]');
  assert.equal(metadata.jwtToken, '[REDACTED]');
  assert.equal(metadata.normalField, 'hello-world');
});
