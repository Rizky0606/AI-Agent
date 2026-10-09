import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtifactManager, InMemoryArtifactStorage } from '@personal-ai-os/tools';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';

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
