import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DrizzleMemoryRepository } from '../src/db/memory-repository.ts';
import type { Database } from '../src/db/client.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Memory API: write policy, creation, correction, deletion, and context assembly', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const memoryRepo = new DrizzleMemoryRepository(null as unknown as Database);

  const user = await auth.register('alice-memory@example.com', 'ValidPassword123!');
  const token = user.accessToken;

  const app = await buildApp({
    auth,
    memory: { memoryRepo },
  });

  // 1. Evaluate candidate with write policy
  // Conversational noise must be rejected
  const evalNoiseRes = await app.inject({
    method: 'POST',
    url: '/v1/memories/evaluate',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content: 'Halo apa kabar?',
      type: 'session',
    },
  });
  assert.equal(evalNoiseRes.statusCode, 200);
  assert.equal(evalNoiseRes.json().data.shouldStore, false);

  // Substantive decision candidate must be accepted
  const evalDecisionRes = await app.inject({
    method: 'POST',
    url: '/v1/memories/evaluate',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content: 'Keputusan arsitektur: Gunakan Postgres dan pgvector untuk memori semantic',
      type: 'decision',
    },
  });
  assert.equal(evalDecisionRes.statusCode, 200);
  assert.equal(evalDecisionRes.json().data.shouldStore, true);

  // 2. Sensitive data rejected on direct store
  const sensitiveStoreRes = await app.inject({
    method: 'POST',
    url: '/v1/memories',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content: 'Kredensial database sk-1234567890abcdef1234567890 rahasia',
      type: 'knowledge',
    },
  });
  assert.equal(sensitiveStoreRes.statusCode, 400);
  assert.equal(sensitiveStoreRes.json().error.code, 'MEMORY_POLICY_REJECTED');

  // 3. Store valid memory
  const storeRes = await app.inject({
    method: 'POST',
    url: '/v1/memories',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content: 'Preferensi pengguna: Gunakan format markdown dan bahasa Indonesia',
      type: 'preference',
      scope: 'user:pref',
    },
  });
  assert.equal(storeRes.statusCode, 201);
  const memoryId = storeRes.json().data.id;
  assert.ok(memoryId);

  // 4. List memories
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/memories',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().data.length, 1);

  // 5. Get memory by ID
  const getRes = await app.inject({
    method: 'GET',
    url: `/v1/memories/${memoryId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json().data.id, memoryId);

  // 6. User correction via PATCH
  const patchRes = await app.inject({
    method: 'PATCH',
    url: `/v1/memories/${memoryId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content: 'Preferensi pengguna: Gunakan format markdown, ringkas, dan bahasa Indonesia',
    },
  });
  assert.equal(patchRes.statusCode, 200);
  assert.equal(
    patchRes.json().data.content,
    'Preferensi pengguna: Gunakan format markdown, ringkas, dan bahasa Indonesia',
  );

  // 7. Context assembly with ContextManager
  const contextRes = await app.inject({
    method: 'POST',
    url: '/v1/context/assemble',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      systemPolicies: [
        'Semua aksi HIGH/CRITICAL butuh approval.',
        'Jangan pernah membocorkan kunci rahasia.',
      ],
      userPrompt: 'Bagaimana preferensi saya diformat?',
      toolOutputs: [{ toolName: 'test_tool', output: 'X'.repeat(50) }],
    },
  });
  assert.equal(contextRes.statusCode, 200);
  const assembledData = contextRes.json().data;
  assert.ok(assembledData.assembledMessages.length >= 2);
  assert.equal(assembledData.preservedSecurityPoliciesCount, 2);

  // Verify security policy is preserved in system message
  const sysMsg = assembledData.assembledMessages.find((m: { role: string }) => m.role === 'system');
  assert.ok(sysMsg.content.includes('Semua aksi HIGH/CRITICAL butuh approval.'));

  // 8. Delete memory
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/v1/memories/${memoryId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(delRes.statusCode, 204);

  // After deletion, get returns 404
  const getDeletedRes = await app.inject({
    method: 'GET',
    url: `/v1/memories/${memoryId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(getDeletedRes.statusCode, 404);

  // 9. Route ordering: /v1/memories/search must NOT be caught by /:id returning 400
  const getSearchRes = await app.inject({
    method: 'GET',
    url: '/v1/memories/search?q=preferensi',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(getSearchRes.statusCode, 200, 'GET /v1/memories/search must return 200, not caught by /:id');
  const getSearchJson = getSearchRes.json();
  assert.equal(getSearchJson.semanticSearchActive, false);
  assert.equal(getSearchJson.searchMode, 'text_fallback');

  const postSearchRes = await app.inject({
    method: 'POST',
    url: '/v1/memories/search',
    headers: { authorization: `Bearer ${token}` },
    payload: { query: 'preferensi' },
  });
  assert.equal(postSearchRes.statusCode, 200, 'POST /v1/memories/search must return 200');

  // Non-uuid `:id` must still be rejected with 400
  for (const method of ['GET', 'DELETE'] as const) {
    const badIdRes = await app.inject({
      method,
      url: '/v1/memories/not-a-valid-uuid',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(badIdRes.statusCode, 400, `${method} /v1/memories/not-a-valid-uuid must be a 400`);
  }

  // DELETE /v1/memories/search has no search route handler, so it hits /:id and fails uuid check with 400
  const delSearchRes = await app.inject({
    method: 'DELETE',
    url: '/v1/memories/search',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(delSearchRes.statusCode, 400, 'DELETE /v1/memories/search without uuid must be a 400');

  // 10. Proposals workflow: AI proposes candidate, not stored silently in active memories
  const proposalRes = await app.inject({
    method: 'POST',
    url: '/v1/memories',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content: 'Usulan memori: Pengguna lebih menyukai pengujian terotomatisasi ketimbang manual',
      type: 'decision',
      isProposal: true,
    },
  });
  assert.equal(proposalRes.statusCode, 201);
  const proposalId = proposalRes.json().data.id;
  assert.ok(proposalId);
  assert.equal(proposalRes.json().data.status, 'proposed');

  // Verify active list does NOT contain proposals
  const activeListRes = await app.inject({
    method: 'GET',
    url: '/v1/memories',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(activeListRes.statusCode, 200);
  assert.ok(!activeListRes.json().data.some((m: { id: string }) => m.id === proposalId));

  // Verify proposal is listed in proposals queue
  const propListRes = await app.inject({
    method: 'GET',
    url: '/v1/memories/proposals',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(propListRes.statusCode, 200);
  assert.ok(propListRes.json().data.some((p: { id: string }) => p.id === proposalId));

  // User approves proposal
  const approveRes = await app.inject({
    method: 'POST',
    url: `/v1/memories/proposals/${proposalId}/approve`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(approveRes.statusCode, 200);
  assert.equal(approveRes.json().status, 'approved');

  // Now active memories contain the approved memory
  const postApproveList = await app.inject({
    method: 'GET',
    url: '/v1/memories',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.ok(postApproveList.json().data.some((m: { id: string }) => m.id === proposalId));

  // 11. Sweeper endpoint
  const sweepRes = await app.inject({
    method: 'POST',
    url: '/v1/memories/sweep',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(sweepRes.statusCode, 200);
  assert.equal(typeof sweepRes.json().data.sweptCount, 'number');
});

/**
 * The repository used to wrap every query in `catch {}` and fall back to a per-process store,
 * so a missing `memories` table produced a 201 and then silently lost the row on restart. The
 * database error must now propagate instead of being converted into a fake success.
 */
test('Memory API: database failures are not silently swallowed by an in-memory fallback', async () => {
  const brokenDb = {
    insert: () => {
      throw new Error('relation "memories" does not exist');
    },
  } as unknown as Database;

  const repo = new DrizzleMemoryRepository(brokenDb);

  await assert.rejects(
    () =>
      repo.createMemory({
        userId: 'user-broken-db',
        content: 'Pengguna lebih suka laporan dalam Bahasa Indonesia.',
        type: 'preference',
        scope: 'user',
        provenance: 'user_explicit',
      }),
    /relation "memories" does not exist/,
  );
});
