import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ArtifactAccessDeniedError,
  ArtifactManager,
  ArtifactQuotaExceededError,
  DiskArtifactStorage,
  InMemoryArtifactStorage,
  ArtifactNotFoundError,
  InvalidFilenameError,
  InvalidMimeTypeError,
} from '../src/index.ts';

test('ArtifactManager creates artifact and validates ownership strictly', async () => {
  const storage = new InMemoryArtifactStorage();
  const manager = new ArtifactManager({ storage });

  const artifact = await manager.createArtifact({
    ownerId: 'alice',
    filename: 'report.json',
    mimeType: 'application/json',
    content: JSON.stringify({ summary: 'Architecture evaluation' }),
    retention: 'project_lifetime',
  });

  assert.ok(artifact.id);
  assert.equal(artifact.ownerId, 'alice');
  assert.equal(artifact.filename, 'report.json');
  assert.equal(artifact.mimeType, 'application/json');
  assert.ok(artifact.checksum);

  // 1. Owner can access
  const metaAlice = await manager.getArtifact(artifact.id, 'alice');
  assert.equal(metaAlice.id, artifact.id);
  const contentAlice = await manager.getArtifactContent(artifact.id, 'alice');
  assert.match(contentAlice.toString('utf-8'), /Architecture evaluation/);

  // 2. Different user (Bob) is rejected with ArtifactAccessDeniedError
  await assert.rejects(
    async () => manager.getArtifact(artifact.id, 'bob'),
    (err: unknown) => err instanceof ArtifactAccessDeniedError,
  );
  await assert.rejects(
    async () => manager.getArtifactContent(artifact.id, 'bob'),
    (err: unknown) => err instanceof ArtifactAccessDeniedError,
  );
  await assert.rejects(
    async () => manager.deleteArtifact(artifact.id, 'bob'),
    (err: unknown) => err instanceof ArtifactAccessDeniedError,
  );
});

test('ArtifactManager generates signed temporary access tokens with expiry', async () => {
  const storage = new InMemoryArtifactStorage();
  const manager = new ArtifactManager({
    storage,
    signingSecret: 'test-secret-key-for-artifacts-1234',
  });

  const artifact = await manager.createArtifact({
    ownerId: 'alice',
    filename: 'data.txt',
    mimeType: 'text/plain',
    content: 'Temporary shared content',
  });

  // Generate signed token valid for 500ms
  const { token } = await manager.createSignedAccessToken(artifact.id, 'alice', 500);

  // 1. Accessing via valid signed token succeeds for third party
  const contentWithToken = await manager.getArtifactContent(artifact.id, undefined, token);
  assert.equal(contentWithToken.toString('utf-8'), 'Temporary shared content');

  // 2. Tampered token fails
  const tamperedToken = `${token}tampered`;
  await assert.rejects(
    async () => manager.getArtifactContent(artifact.id, undefined, tamperedToken),
    (err: unknown) => err instanceof ArtifactAccessDeniedError,
  );

  // 3. Expired token fails
  await new Promise((r) => setTimeout(r, 600));
  await assert.rejects(
    async () => manager.getArtifactContent(artifact.id, undefined, token),
    (err: unknown) => err instanceof ArtifactAccessDeniedError,
  );
});

test('ArtifactManager strictly prevents path traversal in filename', async () => {
  const storage = new InMemoryArtifactStorage();
  const manager = new ArtifactManager({ storage });

  const traversalFilenames = [
    '../../etc/passwd',
    '..\\windows\\system32',
    '/root/.ssh/id_rsa',
    'test\0hidden.png',
  ];

  for (const fn of traversalFilenames) {
    await assert.rejects(
      async () =>
        manager.createArtifact({
          ownerId: 'alice',
          filename: fn,
          mimeType: 'text/plain',
          content: 'data',
        }),
      (err: unknown) => err instanceof InvalidFilenameError,
    );
  }
});

test('ArtifactManager rejects disallowed MIME types', async () => {
  const storage = new InMemoryArtifactStorage();
  const manager = new ArtifactManager({ storage });

  await assert.rejects(
    async () =>
      manager.createArtifact({
        ownerId: 'alice',
        filename: 'malware.exe',
        mimeType: 'application/x-msdownload',
        content: 'binary',
      }),
    (err: unknown) => err instanceof InvalidMimeTypeError,
  );
});

test('ArtifactManager strictly enforces user storage quotas', async () => {
  const storage = new InMemoryArtifactStorage();
  const manager = new ArtifactManager({
    storage,
    userQuotaBytes: 1000, // 1000 bytes quota
    maxSingleArtifactBytes: 500, // 500 bytes single
  });

  // 1. Single artifact larger than maxSingleArtifactBytes is rejected
  await assert.rejects(
    async () =>
      manager.createArtifact({
        ownerId: 'alice',
        filename: 'large.txt',
        mimeType: 'text/plain',
        content: 'A'.repeat(600),
      }),
    (err: unknown) => err instanceof ArtifactQuotaExceededError,
  );

  // 2. Cumulative usage exceeding quota is rejected
  await manager.createArtifact({
    ownerId: 'alice',
    filename: 'file1.txt',
    mimeType: 'text/plain',
    content: 'A'.repeat(400),
  });

  await manager.createArtifact({
    ownerId: 'alice',
    filename: 'file2.txt',
    mimeType: 'text/plain',
    content: 'A'.repeat(400),
  });

  // Third file exceeds 1000 bytes
  await assert.rejects(
    async () =>
      manager.createArtifact({
        ownerId: 'alice',
        filename: 'file3.txt',
        mimeType: 'text/plain',
        content: 'A'.repeat(300),
      }),
    (err: unknown) => err instanceof ArtifactQuotaExceededError,
  );
});

test('DiskArtifactStorage stores and streams files safely with atomic write', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'disk-artifact-'));
  const diskStorage = new DiskArtifactStorage(tmpDir);

  try {
    const putRes = await diskStorage.put(
      'user-1/art-1/test.txt',
      'Disk storage content for streaming',
    );
    assert.ok(putRes.size > 0);
    assert.ok(putRes.checksum);

    // Read back buffer
    const buf = await diskStorage.get('user-1/art-1/test.txt');
    assert.equal(buf.toString('utf-8'), 'Disk storage content for streaming');

    // Stream back
    const stream = await diskStorage.getStream('user-1/art-1/test.txt');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    assert.equal(Buffer.concat(chunks).toString('utf-8'), 'Disk storage content for streaming');

    // Path traversal in storage key is blocked
    await assert.rejects(
      async () => diskStorage.get('../../etc/passwd'),
      /Path traversal terdeteksi/,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('ArtifactManager resolves artifacts written by another process over shared storage', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'artifact-shared-'));
  try {
    // The worker writes the artifact; the API serves it from a separate manager instance.
    const writer = new ArtifactManager({ storage: new DiskArtifactStorage(tmpDir) });
    const artifact = await writer.createArtifact({
      ownerId: 'alice',
      filename: 'screenshot.png',
      mimeType: 'image/png',
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    const reader = new ArtifactManager({ storage: new DiskArtifactStorage(tmpDir) });
    const content = await reader.getArtifactContent(artifact.id, 'alice');
    assert.equal(content.toString('hex'), '89504e47');

    const { token } = await reader.createSignedAccessToken(artifact.id, 'alice');
    const shared = await reader.getArtifactContent(artifact.id, undefined, token);
    assert.equal(shared.toString('hex'), '89504e47');

    await assert.rejects(
      async () => reader.getArtifactContent(artifact.id, 'bob'),
      (err: unknown) => err instanceof ArtifactAccessDeniedError,
    );

    await reader.deleteArtifact(artifact.id, 'alice');
    const third = new ArtifactManager({ storage: new DiskArtifactStorage(tmpDir) });
    await assert.rejects(
      async () => third.getArtifact(artifact.id, 'alice'),
      (err: unknown) => err instanceof ArtifactNotFoundError,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('ArtifactManager lists artifacts written by another process', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'artifact-list-'));
  try {
    const writer = new ArtifactManager({ storage: new DiskArtifactStorage(tmpDir) });
    await writer.createArtifact({
      ownerId: 'alice',
      filename: 'worker-screenshot.png',
      mimeType: 'image/png',
      content: Buffer.from([0x89, 0x50]),
    });
    await writer.createArtifact({
      ownerId: 'bob',
      filename: 'other-user.txt',
      mimeType: 'text/plain',
      content: 'not alice',
    });

    const reader = new ArtifactManager({ storage: new DiskArtifactStorage(tmpDir) });
    const listed = await reader.listArtifactsByUser('alice');
    assert.deepEqual(
      listed.map((artifact) => artifact.filename),
      ['worker-screenshot.png'],
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
