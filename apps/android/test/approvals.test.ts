import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';

test('Approval Inbox API: listing, approving, and denying with strict audit fields', async () => {
  const storage = new InMemoryTokenStorage();
  await storage.setAccessToken('approver-token');

  let approvedId: string | null = null;
  let approveReason: string | null = null;
  let deniedId: string | null = null;
  let denyReason: string | null = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('/v1/approvals') && method === 'GET') {
      return new Response(
        JSON.stringify({
          approvals: [
            {
              id: 'appr-01',
              userId: 'user-1',
              action: 'git:push',
              resource: 'repo://github.com/my-org/core',
              scope: 'git',
              riskLevel: 'HIGH',
              consequence: 'Pushing changes to remote git repository',
              status: 'pending',
              fingerprint: 'fp-sha256-hash',
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              createdAt: new Date().toISOString(),
            },
            {
              id: 'appr-02',
              userId: 'user-1',
              action: 'db:drop_database',
              resource: 'postgres://main',
              scope: 'system',
              riskLevel: 'CRITICAL',
              consequence: 'Permanent deletion of all database records',
              status: 'pending',
              fingerprint: 'fp-critical-hash',
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.endsWith('/v1/approvals/appr-01/approve') && method === 'POST') {
      approvedId = 'appr-01';
      const body = JSON.parse(init?.body as string);
      approveReason = body.reason;
      return new Response(
        JSON.stringify({
          approval: {
            id: 'appr-01',
            status: 'approved',
            decisionReason: body.reason,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.endsWith('/v1/approvals/appr-02/deny') && method === 'POST') {
      deniedId = 'appr-02';
      const body = JSON.parse(init?.body as string);
      denyReason = body.reason;
      return new Response(
        JSON.stringify({
          approval: {
            id: 'appr-02',
            status: 'denied',
            decisionReason: body.reason,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
  };

  try {
    const client = new ApiClient({ storage, baseUrl: 'http://test-server.local' });

    // 1. List approvals
    const res = await client.listApprovals({ status: 'pending' });
    assert.equal(res.approvals.length, 2);
    assert.equal(res.approvals[0]?.riskLevel, 'HIGH');
    assert.equal(res.approvals[1]?.riskLevel, 'CRITICAL');

    // 2. Approve HIGH risk action
    const approveRes = await client.approve('appr-01', 'Diverifikasi oleh admin');
    assert.equal(approvedId, 'appr-01');
    assert.equal(approveReason, 'Diverifikasi oleh admin');
    assert.equal(approveRes.approval.status, 'approved');

    // 3. Deny CRITICAL risk action
    const denyRes = await client.deny('appr-02', 'Operasi terlalu berbahaya');
    assert.equal(deniedId, 'appr-02');
    assert.equal(denyReason, 'Operasi terlalu berbahaya');
    assert.equal(denyRes.approval.status, 'denied');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
