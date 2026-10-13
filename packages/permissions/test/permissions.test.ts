import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApprovalRequiredError,
  type AuditLogEntry,
  computeApprovalFingerprint,
  InvalidApprovalError,
  PermissionDeniedError,
  PermissionEngine,
  SecuredCapabilityGuard,
} from '../src/index.ts';

test('PermissionEngine enforces deny-by-default for unknown actions', () => {
  const engine = new PermissionEngine();

  const evalResult = engine.evaluate({
    actor: { id: 'user-1', role: 'user' },
    action: 'unknown:hack_the_planet',
    resource: 'system://core',
    scope: 'system',
  });

  assert.equal(evalResult.decision, 'deny');
  assert.equal(evalResult.riskLevel, 'HIGH');
  assert.match(evalResult.reason, /deny-by-default/);
});

test('PermissionEngine correctly classifies risks and escalates on destructive context', () => {
  const engine = new PermissionEngine();

  // 1. LOW risk: read is allowed
  const readRes = engine.evaluate({
    actor: { id: 'user-1' },
    action: 'fs:read_file',
    resource: '/src/main.ts',
    scope: 'workspace',
  });
  assert.equal(readRes.decision, 'allow');
  assert.equal(readRes.riskLevel, 'LOW');

  // 2. MEDIUM risk: write in workspace is allowed
  const writeRes = engine.evaluate({
    actor: { id: 'user-1' },
    action: 'fs:write_file',
    resource: '/src/output.txt',
    scope: 'workspace',
  });
  assert.equal(writeRes.decision, 'allow');
  assert.equal(writeRes.riskLevel, 'MEDIUM');

  // 3. MEDIUM risk outside workspace escalates to require_approval
  const writeRootRes = engine.evaluate({
    actor: { id: 'user-1' },
    action: 'fs:write_file',
    resource: '/etc/hosts',
    scope: 'system_root',
  });
  assert.equal(writeRootRes.decision, 'require_approval');

  // 4. HIGH risk: git push requires approval with binding fingerprint
  const pushRes = engine.evaluate({
    actor: { id: 'user-1' },
    action: 'git:push',
    resource: 'https://github.com/org/repo.git',
    scope: 'cloud',
  });
  assert.equal(pushRes.decision, 'require_approval');
  assert.equal(pushRes.riskLevel, 'HIGH');
  assert.ok(pushRes.requiredApproval);
  assert.ok(pushRes.requiredApproval.fingerprint);

  // 5. Destructive context escalates to CRITICAL
  const destructiveRes = engine.evaluate({
    actor: { id: 'user-1' },
    action: 'tool:exec_local_command',
    resource: 'rm -rf /',
    scope: 'workspace',
    context: { isDestructive: true },
  });
  assert.equal(destructiveRes.decision, 'require_approval');
  assert.equal(destructiveRes.riskLevel, 'CRITICAL');
});

test('PermissionEngine requires approval for untrusted MCP tool calls', () => {
  const engine = new PermissionEngine();

  // `McpHub` builds `tool:mcp_<serverId>_<toolName>`. Without a matching rule the engine
  // would deny by default, so every MCP tool would be registered but permanently unusable.
  const mcpRes = engine.evaluate({
    actor: { id: 'user-1', role: 'user' },
    action: 'tool:mcp_docs-server_read_doc',
    resource: 'external_mcp://docs-server/read_doc',
    scope: 'external_mcp',
  });

  assert.equal(mcpRes.decision, 'require_approval');
  assert.equal(mcpRes.riskLevel, 'MEDIUM');
  assert.ok(mcpRes.requiredApproval);
  assert.ok(mcpRes.requiredApproval.fingerprint);
});

test('Approval fingerprint binds strictly to specific action, resource, scope, and context', () => {
  const fp1 = computeApprovalFingerprint('git:push', 'repo-A', 'cloud', 'HIGH');
  const fp2 = computeApprovalFingerprint('git:push', 'repo-B', 'cloud', 'HIGH');
  const fp3 = computeApprovalFingerprint('db:drop', 'repo-A', 'cloud', 'CRITICAL');

  // Must not be equal for different resources or actions
  assert.notEqual(fp1, fp2);
  assert.notEqual(fp1, fp3);

  // Must be deterministic
  const fp1Again = computeApprovalFingerprint('git:push', 'repo-A', 'cloud', 'HIGH');
  assert.equal(fp1, fp1Again);
});

test('SecuredCapabilityGuard prevents execution without approval or with invalid/expired/reused approval', async () => {
  const engine = new PermissionEngine();

  // In-memory approval ledger simulator
  const approvals = new Map<
    string,
    {
      id: string;
      fingerprint: string;
      status: 'pending' | 'approved' | 'denied';
      expiresAt: Date;
      usedAt?: Date | undefined;
      userId: string;
    }
  >();

  const validator = {
    async validateAndConsume(approvalId: string, expectedFp: string, actorId: string) {
      const record = approvals.get(approvalId);
      if (!record) return { valid: false, reason: 'Approval not found' };
      if (record.userId !== actorId) return { valid: false, reason: 'Actor mismatch' };
      if (record.status !== 'approved') return { valid: false, reason: 'Not approved' };
      if (record.expiresAt.getTime() < Date.now())
        return { valid: false, reason: 'Approval expired' };
      if (record.usedAt) return { valid: false, reason: 'Approval already used' };
      if (record.fingerprint !== expectedFp)
        return { valid: false, reason: 'Fingerprint mismatch' };

      record.usedAt = new Date(); // Consume single-use approval
      return { valid: true };
    },
  };

  const auditEntries: Array<{ action: string; decision: string }> = [];
  const auditLogger = {
    async log(entry: AuditLogEntry) {
      auditEntries.push({ action: entry.action, decision: entry.decision });
    },
  };

  const guard = new SecuredCapabilityGuard(engine, {
    approvalValidator: validator,
    auditLogger,
  });

  let toolExecuted = false;
  const toolFn = async () => {
    toolExecuted = true;
    return 'ok';
  };

  const highRiskReq = {
    actor: { id: 'alice' },
    action: 'git:push',
    resource: 'https://github.com/repo.git',
    scope: 'cloud',
  };

  // 1. Calling without approval throws ApprovalRequiredError and does NOT execute tool
  toolExecuted = false;
  await assert.rejects(
    async () => guard.executeProtected(highRiskReq, toolFn),
    (err: unknown) => err instanceof ApprovalRequiredError,
  );
  assert.equal(toolExecuted, false);

  // 2. Calling unknown action throws PermissionDeniedError
  await assert.rejects(
    async () =>
      guard.executeProtected(
        { actor: { id: 'alice' }, action: 'malicious:cmd', resource: '/', scope: 'sys' },
        toolFn,
      ),
    (err: unknown) => err instanceof PermissionDeniedError,
  );
  assert.equal(toolExecuted, false);

  // 3. Create approval with mismatched fingerprint (approval was for repo-X, not repo.git)
  approvals.set('appr-mismatch', {
    id: 'appr-mismatch',
    fingerprint: 'wrong-fingerprint',
    status: 'approved',
    expiresAt: new Date(Date.now() + 60000),
    userId: 'alice',
  });
  await assert.rejects(
    async () => guard.executeProtected(highRiskReq, toolFn, { approvalId: 'appr-mismatch' }),
    (err: unknown) =>
      err instanceof InvalidApprovalError && /Fingerprint mismatch/.test(err.message),
  );
  assert.equal(toolExecuted, false);

  // 4. Create expired approval
  const validFp = computeApprovalFingerprint(
    'git:push',
    'https://github.com/repo.git',
    'cloud',
    'HIGH',
  );
  approvals.set('appr-expired', {
    id: 'appr-expired',
    fingerprint: validFp,
    status: 'approved',
    expiresAt: new Date(Date.now() - 1000), // Already expired
    userId: 'alice',
  });
  await assert.rejects(
    async () => guard.executeProtected(highRiskReq, toolFn, { approvalId: 'appr-expired' }),
    (err: unknown) => err instanceof InvalidApprovalError && /Approval expired/.test(err.message),
  );
  assert.equal(toolExecuted, false);

  // 5. Valid approval executes tool successfully
  approvals.set('appr-valid', {
    id: 'appr-valid',
    fingerprint: validFp,
    status: 'approved',
    expiresAt: new Date(Date.now() + 60000),
    userId: 'alice',
  });
  const result = await guard.executeProtected(highRiskReq, toolFn, { approvalId: 'appr-valid' });
  assert.equal(result, 'ok');
  assert.equal(toolExecuted, true);

  // 6. Reuse of same approval is blocked (Single-use / anti-replay)
  toolExecuted = false;
  await assert.rejects(
    async () => guard.executeProtected(highRiskReq, toolFn, { approvalId: 'appr-valid' }),
    (err: unknown) =>
      err instanceof InvalidApprovalError && /Approval already used/.test(err.message),
  );
  assert.equal(toolExecuted, false);

  // Verify audit logs were captured
  assert.ok(auditEntries.length >= 5);
});
