import assert from 'node:assert/strict';
import test from 'node:test';
import { MockEmbeddingProvider } from '@personal-ai-os/model-gateway';
import {
  ContextManager,
  detectSensitiveData,
  InMemoryMemoryStore,
  MemoryWritePolicy,
  redactSensitiveData,
} from '../src/index.ts';

test('Sensitive Data Filter: detects and redacts credentials and secrets', () => {
  const textWithSecrets =
    'Gunakan OpenAI key sk-1234567890abcdef1234567890 dan bearer token Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sdfsdfsd';

  const detection = detectSensitiveData(textWithSecrets);
  assert.equal(detection.found, true);
  assert.equal(detection.categories.includes('api_key'), true);

  const redaction = redactSensitiveData(textWithSecrets);
  assert.equal(redaction.sanitized.includes('sk-1234567890abcdef1234567890'), false);
  assert.equal(redaction.sanitized.includes('[REDACTED_API_KEY]'), true);
});

test('Memory Write Policy: rejects conversational noise and chat banter', () => {
  const policy = new MemoryWritePolicy();

  // Low info / noise phrases must be rejected
  const noise1 = policy.evaluate({
    userId: 'user-1',
    type: 'session',
    content: 'Halo apa kabar?',
    scope: 'chat',
    provenance: 'conversation_extraction',
  });
  assert.equal(noise1.shouldStore, false);
  assert.match(noise1.reason, /noise|rendah/i);

  const noise2 = policy.evaluate({
    userId: 'user-1',
    type: 'session',
    content: 'terima kasih',
    scope: 'chat',
    provenance: 'conversation_extraction',
  });
  assert.equal(noise2.shouldStore, false);
});

test('Memory Write Policy: rejects sensitive credentials and accepts high-value decisions', () => {
  const policy = new MemoryWritePolicy({ rejectOnSensitiveCredentials: true });

  // Critical secret candidate must be rejected
  const secretCandidate = policy.evaluate({
    userId: 'user-1',
    type: 'knowledge',
    content: 'Database password sk-99887766554433221100 untuk produksi',
    scope: 'db',
    provenance: 'user_explicit',
  });
  assert.equal(secretCandidate.shouldStore, false);
  assert.match(secretCandidate.reason, /kredensial sensitif/i);

  // High-value architecture decision candidate must be accepted
  const decisionCandidate = policy.evaluate({
    userId: 'user-1',
    type: 'decision',
    content: 'Keputusan ADR: Gunakan Fastify dan Drizzle ORM sebagai fondasi backend control plane',
    scope: 'project:arch',
    provenance: 'user_explicit',
  });
  assert.equal(decisionCandidate.shouldStore, true);
  assert.equal(decisionCandidate.candidateType, 'decision');

  // User preference candidate must be accepted
  const prefCandidate = policy.evaluate({
    userId: 'user-1',
    type: 'preference',
    content:
      'Preferensi pengguna: Selalu gunakan TypeScript strict mode dan tanpa library eksternal tanpa alasan',
    scope: 'user:pref',
    provenance: 'user_explicit',
  });
  assert.equal(prefCandidate.shouldStore, true);
});

test('MemoryStore: strict isolation between users and projects', async () => {
  const store = new InMemoryMemoryStore();

  // User 1 stores data
  const mem1 = await store.store({
    userId: 'user-alice',
    projectId: 'proj-alpha',
    type: 'decision',
    content: 'Alice decision for Alpha',
    scope: 'arch',
    provenance: 'user_explicit',
  });

  // User 2 stores data
  await store.store({
    userId: 'user-bob',
    projectId: 'proj-alpha',
    type: 'decision',
    content: 'Bob decision for Alpha',
    scope: 'arch',
    provenance: 'user_explicit',
  });

  // 1. User Bob cannot get Alice's memory by ID
  const bobFetch = await store.get('user-bob', mem1.id);
  assert.equal(bobFetch, null);

  // 2. User Bob listing memories only sees his own
  const bobList = await store.list('user-bob');
  assert.equal(bobList.length, 1);
  assert.equal(bobList[0]?.content, 'Bob decision for Alpha');

  // 3. Project isolation for same user
  await store.store({
    userId: 'user-alice',
    projectId: 'proj-beta',
    type: 'project',
    content: 'Alice notes for Beta',
    scope: 'notes',
    provenance: 'user_explicit',
  });

  const aliceAlphaMemories = await store.list('user-alice', { projectId: 'proj-alpha' });
  assert.equal(aliceAlphaMemories.length, 1);
  assert.equal(aliceAlphaMemories[0]?.content, 'Alice decision for Alpha');
});

test('MemoryStore: deletion and user correction', async () => {
  const store = new InMemoryMemoryStore();

  const mem = await store.store({
    userId: 'user-alice',
    type: 'preference',
    content: 'Preferensi: gunakan Node 18',
    scope: 'runtime',
    provenance: 'user_explicit',
  });

  // User correction
  const corrected = await store.correct(
    'user-alice',
    mem.id,
    'Preferensi: gunakan Node 22 LTS',
    'user_correction',
  );
  assert.equal(corrected.content, 'Preferensi: gunakan Node 22 LTS');
  assert.equal(corrected.provenance, 'user_correction');

  // Delete memory
  const deleted = await store.delete('user-alice', mem.id);
  assert.equal(deleted, true);

  // Deleted memory is not returned by get or list
  assert.equal(await store.get('user-alice', mem.id), null);
  const list = await store.list('user-alice');
  assert.equal(list.length, 0);
});

test('MemoryStore: semantic retrieval via embedding similarity', async () => {
  const store = new InMemoryMemoryStore();
  const embedder = new MockEmbeddingProvider({ dimensions: 128 });

  const text1 = 'Arsitektur PostgreSQL dengan ekstensi pgvector untuk pencarian vektor';
  const text2 = 'Pengaturan audio dan microfon untuk voice call';

  const [vec1, vec2] = await embedder.embed([text1, text2]);

  await store.store(
    {
      userId: 'user-alice',
      type: 'knowledge',
      content: text1,
      scope: 'database',
      provenance: 'user_explicit',
    },
    vec1,
  );

  await store.store(
    {
      userId: 'user-alice',
      type: 'knowledge',
      content: text2,
      scope: 'audio',
      provenance: 'user_explicit',
    },
    vec2,
  );

  // Query similar to database & vector
  const [queryVec] = await embedder.embed(['pgvector semantic search']);
  const results = await store.searchSemantic('user-alice', {
    query: 'pgvector semantic search',
    queryEmbedding: queryVec,
    threshold: 0.0,
    limit: 5,
  });

  assert.equal(results.length, 2);
  // Top result must be database/pgvector
  assert.equal(results[0]?.memory.content, text1);
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test('ContextManager: respects token budget, caps tool output, and preserves security policy 100%', () => {
  const manager = new ContextManager({
    defaultTokenBudget: 500,
    defaultToolOutputMaxChars: 150,
  });

  const securityPolicies = [
    'Semua tindakan HIGH/CRITICAL memerlukan approval eksplisit.',
    'Dilarang membocorkan API key atau secret ke log atau client.',
  ];

  const longToolOutput = 'A'.repeat(500); // Exceeds 150 chars limit

  const result = manager.assemble({
    systemPolicies: securityPolicies,
    userPrompt: 'Bagaimana status sistem saat ini?',
    toolOutputs: [{ toolName: 'fetch_system_metrics', output: longToolOutput }],
    conversationHistory: [
      { role: 'user', content: 'Halo pesan pertama' },
      { role: 'assistant', content: 'Halo balasan pertama' },
      { role: 'user', content: 'Pesan kedua' },
      { role: 'assistant', content: 'Balasan kedua' },
      { role: 'user', content: 'Pesan ketiga' },
      { role: 'assistant', content: 'Balasan ketiga' },
      { role: 'user', content: 'Pesan keempat' },
      { role: 'assistant', content: 'Balasan keempat' },
    ],
    relevantMemories: [
      {
        id: 'mem-1',
        userId: 'user-1',
        type: 'preference',
        content: 'Format jawaban ringkas dan to-the-point',
        scope: 'pref',
        provenance: 'user_explicit',
        metadata: {},
        retention: 'permanent',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });

  // 1. Tool output must be capped
  const toolMsg = result.assembledMessages.find((m) => m.role === 'tool');
  assert.ok(toolMsg);
  assert.ok(typeof toolMsg.content === 'string');
  assert.ok(toolMsg.content.includes('[... truncated by Context Manager'));

  // 2. Budget tracking
  assert.ok(result.totalEstimatedTokens <= 500);
  assert.equal(result.preservedSecurityPoliciesCount, 2);

  // 3. Security policies MUST NEVER BE LOST in system message
  const sysMsg = result.assembledMessages.find((m) => m.role === 'system');
  assert.ok(sysMsg);
  const sysContent = sysMsg.content as string;
  for (const pol of securityPolicies) {
    assert.ok(
      sysContent.includes(pol),
      `Security policy '${pol}' was omitted from context assembly!`,
    );
  }
});
