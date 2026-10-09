import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.ts';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';
import { InMemoryChatRepository } from '../src/db/chat-repository.ts';
import { InMemoryProjectRepository } from '../src/db/project-repository.ts';

const setupProjectTest = async () => {
  const authRepo = new InMemoryAuthRepository();
  const auth = createAuthService(authRepo, 'test-secret-test-secret-test-secret-32');
  const projectRepo = new InMemoryProjectRepository();
  const chatRepo = new InMemoryChatRepository();

  const app = await buildApp({
    auth,
    health: { database: async () => true, redis: async () => true },
    project: { projectRepo, chatRepo },
  });

  const alice = await auth.register('alice@projects.com', 'password-123456');
  const bob = await auth.register('bob@projects.com', 'password-123456');

  return { app, auth, projectRepo, chatRepo, alice, bob };
};

test('Project CRUD and multi-tenant user isolation', async () => {
  const { app, alice, bob } = await setupProjectTest();

  // 1. Alice creates Project A
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { name: 'Alice Project', description: 'Personal project' },
  });
  assert.equal(createRes.statusCode, 201);
  const projectA = createRes.json();
  assert.equal(projectA.name, 'Alice Project');
  assert.equal(projectA.userId, alice.user.id);

  // 2. Alice lists projects
  const listRes = await app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { name: 'Alice Second Project' },
  });
  assert.equal(listRes.statusCode, 201);

  const getAliceProjects = await app.inject({
    method: 'GET',
    url: '/v1/projects',
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getAliceProjects.statusCode, 200);
  assert.equal(getAliceProjects.json().projects.length, 2);

  // 3. Bob cannot see Alice's projects in list
  const getBobProjects = await app.inject({
    method: 'GET',
    url: '/v1/projects',
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(getBobProjects.statusCode, 200);
  assert.equal(getBobProjects.json().projects.length, 0);

  // 4. Bob cannot get Alice's project by ID (isolation returns 404)
  const crossGet = await app.inject({
    method: 'GET',
    url: `/v1/projects/${projectA.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(crossGet.statusCode, 404);

  // 5. Bob cannot update Alice's project (404)
  const crossPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/projects/${projectA.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
    payload: { name: 'Hacked by Bob' },
  });
  assert.equal(crossPatch.statusCode, 404);

  // 6. Bob cannot delete Alice's project (404)
  const crossDelete = await app.inject({
    method: 'DELETE',
    url: `/v1/projects/${projectA.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(crossDelete.statusCode, 404);

  // 7. Alice updates her project
  const patchRes = await app.inject({
    method: 'PATCH',
    url: `/v1/projects/${projectA.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { name: 'Alice Renamed Project', description: 'Updated description' },
  });
  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.json().name, 'Alice Renamed Project');
  assert.equal(patchRes.json().description, 'Updated description');

  // 8. Alice deletes her project
  const deleteRes = await app.inject({
    method: 'DELETE',
    url: `/v1/projects/${projectA.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(deleteRes.statusCode, 204);

  // Verify it is gone
  const getAfterDelete = await app.inject({
    method: 'GET',
    url: `/v1/projects/${projectA.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(getAfterDelete.statusCode, 404);

  await app.close();
});

test('Conversation CRUD with per user/project isolation', async () => {
  const { app, alice, bob } = await setupProjectTest();

  // Create Project for Alice
  const projectRes = await app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { name: 'Alice Work' },
  });
  const aliceProject = projectRes.json();

  // 1. Alice creates conversation in her project
  const createConv = await app.inject({
    method: 'POST',
    url: `/v1/projects/${aliceProject.id}/conversations`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { title: 'First Conversation' },
  });
  assert.equal(createConv.statusCode, 201);
  const conv = createConv.json();
  assert.equal(conv.title, 'First Conversation');
  assert.equal(conv.projectId, aliceProject.id);

  // 2. Bob cannot create conversation in Alice's project (404)
  const bobCrossCreate = await app.inject({
    method: 'POST',
    url: `/v1/projects/${aliceProject.id}/conversations`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
    payload: { title: 'Bob Sneak Conv' },
  });
  assert.equal(bobCrossCreate.statusCode, 404);

  // 3. Bob cannot list conversations from Alice's project (404)
  const bobCrossList = await app.inject({
    method: 'GET',
    url: `/v1/projects/${aliceProject.id}/conversations`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobCrossList.statusCode, 404);

  // 4. Bob cannot get Alice's conversation by ID (404)
  const bobCrossGet = await app.inject({
    method: 'GET',
    url: `/v1/conversations/${conv.id}`,
    headers: { authorization: `Bearer ${bob.accessToken}` },
  });
  assert.equal(bobCrossGet.statusCode, 404);

  // 5. Alice updates conversation title
  const updateConv = await app.inject({
    method: 'PATCH',
    url: `/v1/conversations/${conv.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { title: 'Updated Discussion Title' },
  });
  assert.equal(updateConv.statusCode, 200);
  assert.equal(updateConv.json().title, 'Updated Discussion Title');

  // 6. Alice deletes conversation
  const deleteConv = await app.inject({
    method: 'DELETE',
    url: `/v1/conversations/${conv.id}`,
    headers: { authorization: `Bearer ${alice.accessToken}` },
  });
  assert.equal(deleteConv.statusCode, 204);

  await app.close();
});
