import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAuthRepository, createAuthService } from '../src/auth/service.ts';

test('login, refresh rotation, and logout revoke tokens', async () => {
  const auth = createAuthService(
    new InMemoryAuthRepository(),
    'test-secret-test-secret-test-secret-32',
  );
  const registered = await auth.register('alice@example.com', 'correct horse battery staple');
  const loggedIn = await auth.login('alice@example.com', 'correct horse battery staple');
  assert.equal(loggedIn.user.id, registered.user.id);
  const rotated = await auth.refresh(loggedIn.refreshToken);
  assert.notEqual(rotated.refreshToken, loggedIn.refreshToken);
  await assert.rejects(() => auth.refresh(loggedIn.refreshToken), /refresh token reuse detected/);
  await auth.logout(rotated.refreshToken);
  await assert.rejects(() => auth.refresh(rotated.refreshToken), /refresh token reuse detected/);
});

test('invalid password and cross-user lookup are rejected', async () => {
  const repository = new InMemoryAuthRepository();
  const auth = createAuthService(repository, 'test-secret-test-secret-test-secret-32');
  const alice = await auth.register('alice@example.com', 'alice-password-123');
  const bob = await auth.register('bob@example.com', 'bob-password-123');
  await assert.rejects(
    () => auth.login('alice@example.com', 'wrong-password'),
    /invalid credentials/,
  );
  assert.equal(await auth.authorizeUser(alice.accessToken, bob.user.id), false);
});
