import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ArtifactManager,
  BrowserConcurrencyLimitError,
  BrowserController,
  BrowserSensitiveActionRequiresApprovalError,
  BrowserStepLimitExceededError,
  type DnsResolver,
  InMemoryArtifactStorage,
  MockPlaywrightRunner,
  SsrfViolationError,
} from '../src/index.ts';

const fakeDnsResolver: DnsResolver = async (hostname: string) => {
  if (hostname === 'blocked-malware.com') {
    return [{ address: '93.184.216.34', family: 4 }];
  }
  return [{ address: '93.184.216.34', family: 4 }];
};

test('BrowserController enforces isolated session, SSRF protection, and domain deny', async () => {
  const runner = new MockPlaywrightRunner();
  const controller = new BrowserController({
    runner,
    maxConcurrency: 2,
    dnsResolver: fakeDnsResolver,
  });

  const sessionId = await controller.createSession({
    sessionId: 'session-1',
    actorId: 'alice',
    deniedDomains: ['blocked-malware.com'],
  });

  // 1. Safe navigation succeeds
  const navRes = await controller.navigate(sessionId, 'https://example.com/docs');
  assert.equal(navRes.success, true);
  assert.equal(navRes.stepNumber, 1);

  // 2. Navigation to internal IP (SSRF) is blocked
  await assert.rejects(
    async () => controller.navigate(sessionId, 'http://169.254.169.254/latest/meta-data'),
    (err: unknown) => err instanceof SsrfViolationError,
  );

  // 3. Navigation to blocked domain is blocked
  await assert.rejects(
    async () => controller.navigate(sessionId, 'https://blocked-malware.com/evil'),
    /daftar blokir/i,
  );

  await controller.closeSession(sessionId);
});

test('BrowserController strictly enforces step limits per session', async () => {
  const runner = new MockPlaywrightRunner();
  const controller = new BrowserController({
    runner,
    maxConcurrency: 2,
    dnsResolver: fakeDnsResolver,
  });

  const maxSteps = 3;
  const sessionId = await controller.createSession({
    sessionId: 'session-steps',
    actorId: 'alice',
    maxSteps,
  });

  // Step 1
  await controller.navigate(sessionId, 'https://example.com/1');
  // Step 2
  await controller.click(sessionId, '#button-next');
  // Step 3
  await controller.type(sessionId, '#search-input', 'keyword');

  // Step 4 exceeds maxSteps (3)
  await assert.rejects(
    async () => controller.navigate(sessionId, 'https://example.com/overflow'),
    (err: unknown) => err instanceof BrowserStepLimitExceededError && err.maxSteps === 3,
  );

  await controller.closeSession(sessionId);
});

test('BrowserController requires user approval for sensitive form submission', async () => {
  const runner = new MockPlaywrightRunner();
  const controller = new BrowserController({ runner, dnsResolver: fakeDnsResolver });

  const sessionId = await controller.createSession({
    sessionId: 'session-submit',
    actorId: 'alice',
  });

  await controller.navigate(sessionId, 'https://example.com/login');

  // 1. Submit without approval fails
  await assert.rejects(
    async () => controller.submit(sessionId, '#login-form', false),
    (err: unknown) =>
      err instanceof BrowserSensitiveActionRequiresApprovalError && err.action === 'submit',
  );

  // 2. Submit with approval succeeds
  const submitRes = await controller.submit(sessionId, '#login-form', true);
  assert.equal(submitRes.success, true);
  assert.equal(submitRes.action, 'submit');

  await controller.closeSession(sessionId);
});

test('BrowserController captures screenshot and persists as an artifact', async () => {
  const runner = new MockPlaywrightRunner();
  const storage = new InMemoryArtifactStorage();
  const artifactManager = new ArtifactManager({ storage });
  const controller = new BrowserController({
    runner,
    artifactManager,
    dnsResolver: fakeDnsResolver,
  });

  const sessionId = await controller.createSession({
    sessionId: 'session-shot',
    actorId: 'alice',
  });

  await controller.navigate(sessionId, 'https://example.com/dashboard');
  const shotRes = await controller.screenshot(sessionId);

  assert.equal(shotRes.success, true);
  assert.ok(shotRes.screenshotArtifactId);

  // Verify the artifact exists in ArtifactManager
  const artifact = await artifactManager.getArtifact(shotRes.screenshotArtifactId, 'alice');
  assert.equal(artifact.mimeType, 'image/png');
  assert.match(artifact.filename, /^screenshot_\d+\.png$/);

  await controller.closeSession(sessionId);
});

test('BrowserController enforces concurrency limit (ARM64 friendly)', async () => {
  const runner = new MockPlaywrightRunner();
  const controller = new BrowserController({
    runner,
    maxConcurrency: 2,
    dnsResolver: fakeDnsResolver,
  });

  await controller.createSession({ sessionId: 'session-c1', actorId: 'alice' });
  await controller.createSession({ sessionId: 'session-c2', actorId: 'bob' });

  // 3rd concurrent session exceeds limit of 2
  await assert.rejects(
    async () => controller.createSession({ sessionId: 'session-c3', actorId: 'charlie' }),
    (err: unknown) => err instanceof BrowserConcurrencyLimitError,
  );

  // After closing session 1, creating a new session succeeds
  await controller.closeSession('session-c1');
  const s3 = await controller.createSession({
    sessionId: 'session-c3',
    actorId: 'charlie',
  });
  assert.equal(s3, 'session-c3');

  await controller.closeSession('session-c2');
  await controller.closeSession('session-c3');
});
