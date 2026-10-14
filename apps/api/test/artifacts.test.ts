import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtifactManager, InMemoryArtifactStorage } from '@personal-ai-os/tools';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { sweepExpiredArtifacts } from '../src/services/artifact-retention-sweeper.ts';

const secret = 'test-secret-at-least-thirty-two-chars-long';

test('Artifacts API: upload, download, ownership isolation, and signed URL generation', async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, secret);
  const storage = new InMemoryArtifactStorage();
  const artifactManager = new ArtifactManager({ storage });

  const alice = await auth.register('alice-artifact@example.com', 'ValidPassword123!');
  const bob = await auth.register('bob-artifact@example.com', 'ValidPassword123!');

  const app = await buildApp({
    auth,
    artifacts: { artifactManager },
  });

  // 1. Alice uploads artifact
  const uploadRes = await app.inject({
    method: 'POST',
    url: '/v1/artifacts',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: {
      filename: 'architecture_diagram.json',
      mimeType: 'application/json',
      content: JSON.stringify({ nodes: ['Fastify', 'Postgres', 'Redis'] }),
    },
  });
  assert.equal(uploadRes.statusCode, 201);
  const created = uploadRes.json().data;
  assert.ok(created.id);
  assert.equal(created.filename, 'architecture_diagram.json');

  // 2. Alice downloads artifact successfully
  const downloadAlice = await app.inject({
    method: 'GET',
    url: `/v1/artifacts/${created.id}/download`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(downloadAlice.statusCode, 200);
  assert.match(downloadAlice.body, /Fastify/);

  // 3. Bob attempts to access Alice's artifact -> 403 Forbidden
  const downloadBob = await app.inject({
    method: 'GET',
    url: `/v1/artifacts/${created.id}/download`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(downloadBob.statusCode, 403);

  // 4. Alice generates signed temporary download URL
  const signedUrlRes = await app.inject({
    method: 'POST',
    url: `/v1/artifacts/${created.id}/signed-url`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { expiresInMs: 3600000 },
  });
  assert.equal(signedUrlRes.statusCode, 200);
  const { token, downloadUrl } = signedUrlRes.json().data;
  assert.ok(token);

  // 5. Bob (or unauthenticated requester) can download using valid signed token
  const downloadViaSignedToken = await app.inject({
    method: 'GET',
    url: downloadUrl,
  });
  assert.equal(downloadViaSignedToken.statusCode, 200);
  assert.match(downloadViaSignedToken.body, /Fastify/);

  // 6. Delete artifact
  const deleteRes = await app.inject({
    method: 'DELETE',
    url: `/v1/artifacts/${created.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(deleteRes.statusCode, 200);

  // 7. After deletion, access gives 404
  const getAfterDelete = await app.inject({
    method: 'GET',
    url: `/v1/artifacts/${created.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getAfterDelete.statusCode, 404);
});

test('Artifacts API: streams a >1 MiB binary upload and rejects a declared MIME mismatch', async () => {
  const auth = createAuthService(new InMemoryAuthRepository(), secret);
  const artifactManager = new ArtifactManager({ storage: new InMemoryArtifactStorage() });
  const alice = await auth.register('alice-stream@example.com', 'ValidPassword123!');
  const app = await buildApp({ auth, artifacts: { artifactManager } });

  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2 * 1024 * 1024, 0x41),
  ]);
  const streamHeaders = {
    authorization: `Bearer ${alice.accessToken}`,
    'content-type': 'application/octet-stream',
  };

  const upload = await app.inject({
    method: 'POST',
    url: '/v1/artifacts/stream?filename=big.png&mimeType=image/png',
    headers: streamHeaders,
    payload: bytes,
  });
  assert.equal(upload.statusCode, 201);
  const created = upload.json().data;
  assert.equal(created.size, bytes.length);
  assert.equal(created.filename, 'big.png');

  const download = await app.inject({
    method: 'GET',
    url: `/v1/artifacts/${created.id}/download`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(download.statusCode, 200);
  assert.ok(download.rawPayload.equals(bytes));

  // A declared PNG whose bytes are plain text is rejected on both upload routes.
  const streamMismatch = await app.inject({
    method: 'POST',
    url: '/v1/artifacts/stream?filename=fake.png&mimeType=image/png',
    headers: streamHeaders,
    payload: Buffer.from('definitely not a png'),
  });
  assert.equal(streamMismatch.statusCode, 400);
  assert.match(streamMismatch.json().error, /image\/png/);

  const jsonMismatch = await app.inject({
    method: 'POST',
    url: '/v1/artifacts',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { filename: 'fake.png', mimeType: 'image/png', content: 'definitely not a png' },
  });
  assert.equal(jsonMismatch.statusCode, 400);
});

test('Artifact retention sweep deletes expired artifacts and keeps live and permanent ones', async () => {
  const storage = new InMemoryArtifactStorage();
  const artifactManager = new ArtifactManager({ storage });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ephemeral = await artifactManager.createArtifact({
    ownerId: 'alice',
    filename: 'scratch.txt',
    mimeType: 'text/plain',
    content: 'scratch',
    retention: 'ephemeral',
  });
  const permanent = await artifactManager.createArtifact({
    ownerId: 'alice',
    filename: 'archive.txt',
    mimeType: 'text/plain',
    content: 'archive',
    retention: 'permanent',
  });
  const runningTask = await artifactManager.createArtifact({
    ownerId: 'alice',
    filename: 'running.png',
    mimeType: 'image/png',
    content: png,
    taskId: 'task-running',
    retention: 'task_duration',
  });
  const finishedTask = await artifactManager.createArtifact({
    ownerId: 'bob',
    filename: 'finished.png',
    mimeType: 'image/png',
    content: png,
    taskId: 'task-finished',
    retention: 'task_duration',
  });
  const orphanedProject = await artifactManager.createArtifact({
    ownerId: 'bob',
    filename: 'orphan.txt',
    mimeType: 'text/plain',
    content: 'orphan',
    projectId: 'project-gone',
    retention: 'project_lifetime',
  });

  const result = await sweepExpiredArtifacts({
    artifactManager,
    getTaskStatus: async (_ownerId, taskId) => (taskId === 'task-finished' ? 'completed' : 'running'),
    projectExists: async (_ownerId, projectId) => projectId !== 'project-gone',
    ephemeralTtlMs: 1000,
    now: Date.now() + 5000,
  });

  assert.equal(result.scanned, 5);
  assert.equal(result.deleted, 3);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(
    (await artifactManager.listAllArtifacts()).map((artifact) => artifact.id).sort(),
    [permanent.id, runningTask.id].sort(),
  );
  // The bytes are reclaimed too, not just the metadata sidecars.
  for (const deleted of [ephemeral, finishedTask, orphanedProject]) {
    await assert.rejects(async () => storage.get(deleted.storageKey), /tidak ditemukan/);
  }
});
