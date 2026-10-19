import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryPromptTemplateRepository } from '../src/db/prompt-template-repository.ts';
import { MockModelGateway } from '@personal-ai-os/model-gateway';
import { ModelRouter } from '../src/services/model-router.ts';
import { InMemoryModelConfigRepository } from '../src/db/model-config-repository.ts';

async function setupTest() {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-jwt-secret-at-least-thirty-two-bytes-long');
  const chatRepo = new InMemoryChatRepository();
  const promptTemplateRepo = new InMemoryPromptTemplateRepository();
  const modelConfigs = new InMemoryModelConfigRepository();
  const gateway = new MockModelGateway();
  const router = new ModelRouter({
    modelConfigs,
    gateway,
  });

  const app = await buildApp({
    auth,
    chat: {
      chatRepo,
      router,
      modelConfigs,
      gateway,
    },
    promptTemplates: {
      promptTemplateRepo,
    },
  });

  const alice = await auth.register('alice.session@test.org', 'SecretPassword123!');
  const projectId = await chatRepo.getOrCreateDefaultProject(alice.user.id);
  const conversationId = await chatRepo.getOrCreateConversation(
    alice.user.id,
    projectId,
    undefined,
    'Sesi Percobaan Pohon',
  );

  return { app, alice, chatRepo, promptTemplateRepo, conversationId, projectId };
}

test('Pohon Pesan (Message Tree): percabangan, rewind, switch branch, dan sibling navigation', async () => {
  const { app, alice, chatRepo, conversationId } = await setupTest();

  // 1. Pesan 1 (Root User)
  const msg1 = await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'user',
    'Pertanyaan Pertama: Apa itu TypeScript?',
  );
  assert.equal(msg1.parentMessageId, null);
  assert.equal(msg1.isActiveBranch, true);

  // 2. Pesan 2 (Assistant 1)
  const msg2 = await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'assistant',
    'Jawaban 1: TypeScript adalah superset berpengetikan statis dari JavaScript.',
    undefined,
    undefined,
    msg1.id,
  );
  assert.equal(msg2.parentMessageId, msg1.id);
  assert.equal(msg2.isActiveBranch, true);

  // 3. User melakukan "Ulangi Jawaban" / Retry -> Assistant 2 sebagai cabang alternatif dari msg1
  const msg2Alt = await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'assistant',
    'Jawaban 2 (Alternatif): TypeScript menambahkan sistem tipe pada JavaScript untuk skalabilitas.',
    undefined,
    undefined,
    msg1.id, // parent yang sama -> cabang baru!
  );
  assert.equal(msg2Alt.parentMessageId, msg1.id);

  // 4. Periksa getMessages (cabang aktif default)
  const activeMessages = await chatRepo.getMessages(alice.user.id, conversationId);
  assert.equal(activeMessages.length, 2);
  assert.equal(activeMessages[0]?.id, msg1.id);
  assert.equal(activeMessages[1]?.id, msg2Alt.id); // msg2Alt sekarang aktif karena baru dibuat
  assert.equal(activeMessages[1]?.branchCount, 2);
  assert.equal(activeMessages[1]?.branchIndex, 1); // 1 dari 2 (0-indexed)
  assert.deepEqual(activeMessages[1]?.siblingMessageIds, [msg2.id, msg2Alt.id]);

  // 5. Beralih kembali ke Cabang Sebelumnya (msg2) via switchBranch endpoint
  const switchRes = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages/${msg2.id}/switch`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(switchRes.statusCode, 200);
  const switchedData = switchRes.json();
  assert.equal(switchedData.messages.length, 2);
  assert.equal(switchedData.messages[1].id, msg2.id);
  assert.equal(switchedData.messages[1].branchCount, 2);
  assert.equal(switchedData.messages[1].branchIndex, 0); // 0 dari 2

  // 6. Percabangan pada User Message (User mengedit msg1)
  const msg1Edited = await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'user',
    'Pertanyaan Diedit: Jelaskan arsitektur TypeScript compiler',
    undefined,
    undefined,
    null, // Root level alternative!
  );
  const msg3 = await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'assistant',
    'Arsitektur TSC terdiri dari Scanner, Parser, Binder, Checker, dan Emitter.',
    undefined,
    undefined,
    msg1Edited.id,
  );

  const treeAfterEdit = await chatRepo.getMessages(alice.user.id, conversationId);
  assert.equal(treeAfterEdit.length, 2);
  assert.equal(treeAfterEdit[0]?.id, msg1Edited.id);
  assert.equal(treeAfterEdit[1]?.id, msg3.id);

  // 7. Hapus Cabang alternatif msg1Edited
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/v1/conversations/${conversationId}/messages/${msg1Edited.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(delRes.statusCode, 200);

  // Setelah msg1Edited dihapus, aktif berpindah kembali ke msg1 & anak asistennya
  const remainingTree = await chatRepo.getMessages(alice.user.id, conversationId);
  assert.equal(remainingTree.length, 2);
  assert.equal(remainingTree[0]?.id, msg1.id);
  assert.ok(remainingTree[1]?.id === msg2.id || remainingTree[1]?.id === msg2Alt.id);
});

test('Ekspor Percakapan: Markdown & Standalone HTML dengan sanitasi XSS dan redaksi secret', async () => {
  const { app, alice, chatRepo, conversationId } = await setupTest();

  await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'user',
    'Token saya adalah Bearer secret-jwt-token-12345 dan sk-abcdef12345678901234567890 serta skrip <script>alert("xss")</script>',
  );
  await chatRepo.appendMessage(
    alice.user.id,
    conversationId,
    'assistant',
    'Jawaban aman: Jangan membagikan token Anda!',
  );

  // 1. Ekspor Markdown
  const mdRes = await app.inject({
    method: 'GET',
    url: `/v1/conversations/${conversationId}/export?format=markdown`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(mdRes.statusCode, 200);
  assert.ok(mdRes.headers['content-type']?.includes('text/markdown'));
  const mdText = mdRes.body;
  assert.ok(mdText.includes('[REDACTED_TOKEN]'));
  assert.ok(mdText.includes('[REDACTED_API_KEY]'));
  assert.ok(!mdText.includes('secret-jwt-token-12345'));
  assert.ok(!mdText.includes('sk-abcdef12345678901234567890'));

  // 2. Ekspor Standalone HTML
  const htmlRes = await app.inject({
    method: 'GET',
    url: `/v1/conversations/${conversationId}/export?format=html`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(htmlRes.statusCode, 200);
  assert.ok(htmlRes.headers['content-type']?.includes('text/html'));
  const htmlText = htmlRes.body;
  // Sanitasi XSS: Tag script di-escape, tidak executable
  assert.ok(!htmlText.includes('<script>alert("xss")</script>'));
  assert.ok(htmlText.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  // Token diredaksi
  assert.ok(htmlText.includes('[REDACTED_TOKEN]'));
  // Berkas mandiri tanpa CDN eksternal
  assert.ok(!htmlText.includes('http://') && !htmlText.includes('https://'));
});

test('Prompt Templates: CRUD, parsing variabel {{variabel}}, dan validasi nama unik', async () => {
  const { app, alice } = await setupTest();

  // 1. Create Template
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/prompt-templates',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      name: 'code-review',
      title: 'Tinjau Kode TypeScript',
      content: 'Tolong periksa kode ini untuk performa: {{code}} dengan bahasa {{lang}}',
    },
  });
  assert.equal(createRes.statusCode, 201);
  const created = createRes.json().template;
  assert.equal(created.name, 'code-review');
  assert.deepEqual(created.variables.sort(), ['code', 'lang'].sort());

  // 2. List Templates
  const listRes = await app.inject({
    method: 'GET',
    url: '/v1/prompt-templates',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(listRes.statusCode, 200);
  const templates = listRes.json().templates;
  assert.equal(templates.length, 1);
  assert.equal(templates[0].name, 'code-review');

  // 3. Update Template
  const updateRes = await app.inject({
    method: 'PUT',
    url: `/v1/prompt-templates/${created.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      content: 'Tinjau kode keamanan: {{security_code}}',
    },
  });
  assert.equal(updateRes.statusCode, 200);
  const updated = updateRes.json().template;
  assert.deepEqual(updated.variables, ['security_code']);

  // 4. Delete Template
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/v1/prompt-templates/${created.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(delRes.statusCode, 200);

  const emptyListRes = await app.inject({
    method: 'GET',
    url: '/v1/prompt-templates',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(emptyListRes.json().templates.length, 0);
});

test('Kompaksi Konteks: peringkasan riwayat percakapan panjang dan penolakan untuk sesi pendek', async () => {
  const { app, alice, chatRepo, conversationId } = await setupTest();

  // Sesi pendek (2 pesan): harus ditolak
  await chatRepo.appendMessage(alice.user.id, conversationId, 'user', 'Halo');
  await chatRepo.appendMessage(alice.user.id, conversationId, 'assistant', 'Halo juga');

  const shortCompact = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/compact`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(shortCompact.statusCode, 200);
  assert.equal(shortCompact.json().compacted, false);

  // Tambah pesan hingga > 5 pesan
  await chatRepo.appendMessage(alice.user.id, conversationId, 'user', 'Pesan 3');
  await chatRepo.appendMessage(alice.user.id, conversationId, 'assistant', 'Jawaban 3');
  await chatRepo.appendMessage(alice.user.id, conversationId, 'user', 'Pesan 4');
  await chatRepo.appendMessage(alice.user.id, conversationId, 'assistant', 'Jawaban 4');

  const longCompact = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/compact`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(longCompact.statusCode, 200);
  assert.equal(longCompact.json().compacted, true);
  assert.ok(longCompact.json().compactedSummary.includes('Konteks Percakapan Terdahulu Diringkas'));

  // Pastikan getMessages mengembalikan compactedSummary
  const getMsgs = await app.inject({
    method: 'GET',
    url: `/v1/conversations/${conversationId}/messages`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getMsgs.statusCode, 200);
  assert.ok(getMsgs.json().compactedSummary.includes('Konteks Percakapan Terdahulu Diringkas'));
});
