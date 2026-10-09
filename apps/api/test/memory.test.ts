import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { DrizzleMemoryRepository } from '../src/db/memory-repository.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Memory API: write policy, creation, correction, deletion, and context assembly', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const memoryRepo = new DrizzleMemoryRepository(
    null as unknown as import('../src/db/client.ts').Database,
  );

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
});
