import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawnSync } from 'node:child_process';

const execFileAsync = promisify(execFile);

test('Offsite Backup & Restore: Crypto tool enforces permissions and authenticated AES-256-GCM', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'crypto-test-'));
  const rootDir = resolve(import.meta.dirname, '../../..');
  const cryptoScript = join(rootDir, 'scripts/backup-crypto.js');

  const keyFile = join(tempDir, 'backup.key');
  const plainFile = join(tempDir, 'plain.dump');
  const encFile = join(tempDir, 'plain.dump.enc');
  const decFile = join(tempDir, 'decrypted.dump');

  await writeFile(plainFile, 'PostgreSQL custom dump binary content simulated', 'utf8');
  await writeFile(keyFile, 'super-secret-backup-passphrase-256bit', 'utf8');
  if (process.platform !== 'win32') {
    await chmod(keyFile, 0o600);
  }

  try {
    // 1. Encryption creates valid AES-256-GCM file
    const encRes = spawnSync(process.execPath, [cryptoScript, 'encrypt', plainFile, encFile, keyFile]);
    assert.equal(encRes.status, 0, `Encryption failed: ${encRes.stderr?.toString()}`);

    const encBytes = await readFile(encFile);
    // Check magic header
    assert.equal(encBytes.subarray(0, 13).toString('utf8'), 'PAIOS_GCM_V1\n');

    // 2. Decryption recovers exact original plaintext
    const decRes = spawnSync(process.execPath, [cryptoScript, 'decrypt', encFile, decFile, keyFile]);
    assert.equal(decRes.status, 0, `Decryption failed: ${decRes.stderr?.toString()}`);

    const decContent = await readFile(decFile, 'utf8');
    assert.equal(decContent, 'PostgreSQL custom dump binary content simulated');

    // 3. Tamper detection: modifying a byte in ciphertext causes decryption to fail hard
    const tamperedFile = join(tempDir, 'tampered.enc');
    const tamperedDec = join(tempDir, 'tampered.dec');
    const tamperedBytes = Buffer.from(encBytes);
    // Flip a bit in ciphertext area (past header)
    tamperedBytes[tamperedBytes.length - 1] ^= 0x01;
    await writeFile(tamperedFile, tamperedBytes);

    const tamperRes = spawnSync(process.execPath, [cryptoScript, 'decrypt', tamperedFile, tamperedDec, keyFile]);
    assert.notEqual(tamperRes.status, 0, 'Tampered ciphertext must fail decryption');
    assert.match(tamperRes.stderr?.toString() || '', /Autentikasi integritas gagal|rusak atau telah dimanipulasi/i);

    // 4. Missing key file fails hard
    const missingKeyRes = spawnSync(process.execPath, [cryptoScript, 'encrypt', plainFile, encFile, join(tempDir, 'nonexistent.key')]);
    assert.notEqual(missingKeyRes.status, 0);

    // 5. Unix file permission check: permissions > 0600 must fail
    if (process.platform !== 'win32') {
      const looseKey = join(tempDir, 'loose.key');
      await writeFile(looseKey, 'secret', 'utf8');
      await chmod(looseKey, 0o644); // readable by group and others

      const looseRes = spawnSync(process.execPath, [cryptoScript, 'encrypt', plainFile, encFile, looseKey]);
      assert.notEqual(looseRes.status, 0);
      assert.match(looseRes.stderr?.toString() || '', /Izin file kunci.*terlalu longgar/i);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Offsite Backup Script: Validates S3 parameters, enforces key presence, and purges raw dump', async (t) => {
  let shellCmd = 'bash';
  try {
    const { execSync } = await import('node:child_process');
    execSync('bash --version', { stdio: 'ignore' });
  } catch {
    try {
      const { execSync } = await import('node:child_process');
      execSync('sh -c "exit 0"', { stdio: 'ignore' });
      shellCmd = 'sh';
    } catch {
      t.skip('Shell (bash/sh) not available on this platform to test shell scripts');
      return;
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'backup-offsite-drill-'));
  const rootDir = resolve(import.meta.dirname, '../../..');

  const toShellPath = (p: string) => {
    const normalized = p.replace(/\\/g, '/');
    if (process.platform === 'win32') {
      return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    }
    return normalized;
  };

  const backupScript = toShellPath(join(rootDir, 'scripts/backup-offsite.sh'));
  const restoreScript = toShellPath(join(rootDir, 'scripts/restore-offsite.sh'));
  const fakeBinDir = join(tempDir, 'fake-bin');
  const fakeKeyFile = join(tempDir, 'backup.key');
  await writeFile(fakeKeyFile, 'dummy-key-content-for-testing', 'utf8');
  if (process.platform !== 'win32') {
    await chmod(fakeKeyFile, 0o600);
  }

  // Create fake bin dir with mock pg_dump, aws, pg_restore, psql
  const { mkdir } = await import('node:fs/promises');
  await mkdir(fakeBinDir, { recursive: true });

  // Mock pg_dump
  const mockPgDump = join(fakeBinDir, 'pg_dump');
  await writeFile(
    mockPgDump,
    '#!/usr/bin/env sh\nfor arg in "$@"; do if [ "$prev" = "--file" ]; then echo "DUMP_CONTENT" > "$arg"; fi; prev="$arg"; done\nexit 0\n',
    { mode: 0o755 },
  );

  // Mock aws CLI
  const mockAws = join(fakeBinDir, 'aws');
  await writeFile(
    mockAws,
    '#!/usr/bin/env sh\necho "MOCK AWS CP $@"\nexit 0\n',
    { mode: 0o755 },
  );

  // Mock pg_restore
  const mockPgRestore = join(fakeBinDir, 'pg_restore');
  await writeFile(mockPgRestore, '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });

  // Mock psql
  const mockPsql = join(fakeBinDir, 'psql');
  await writeFile(mockPsql, '#!/usr/bin/env sh\necho "users 10"; echo "tasks 5"\nexit 0\n', { mode: 0o755 });

  const runShell = (scriptPath: string, env: Record<string, string> = {}) => {
    const shellFakeBin = toShellPath(fakeBinDir);
    const fullEnv = {
      ...env,
      PATH: `${shellFakeBin}:/usr/bin:/bin:$PATH`,
    };
    const envPrefix = Object.entries(fullEnv)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    const cmd = `${envPrefix} "${scriptPath}"`;
    return execFileAsync(shellCmd, ['-c', cmd]);
  };

  try {
    // 1. Fails hard if ENCRYPTION_KEY_FILE is missing
    await assert.rejects(
      async () =>
        runShell(backupScript, {
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          ENCRYPTION_KEY_FILE: toShellPath(join(tempDir, 'missing.key')),
          S3_BUCKET: 'test-bucket',
          S3_ENDPOINT_URL: 'https://s3.oracle.com',
        }),
      (err: Error) => /Kunci enkripsi.*tidak ditemukan/i.test(err.message),
    );

    // 2. Fails hard if S3_BUCKET or S3_ENDPOINT_URL is missing (Mandatory in offsite mode)
    await assert.rejects(
      async () =>
        runShell(backupScript, {
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          ENCRYPTION_KEY_FILE: toShellPath(fakeKeyFile),
          S3_BUCKET: '',
          S3_ENDPOINT_URL: 'https://s3.oracle.com',
        }),
      (err: Error) => /Konfigurasi S3 tidak lengkap/i.test(err.message),
    );

    // 3. Successful backup: encrypts, writes checksum, uploads, and deletes raw dump
    const backupDir = join(tempDir, 'postgres-dumps');
    const offsiteDir = join(tempDir, 'offsite-dumps');
    const out = await runShell(backupScript, {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      ENCRYPTION_KEY_FILE: toShellPath(fakeKeyFile),
      BACKUP_DIR: toShellPath(backupDir),
      OFFSITE_DIR: toShellPath(offsiteDir),
      S3_BUCKET: 'my-offsite-bucket',
      S3_ENDPOINT_URL: 'https://compat.objectstorage.oracle.com',
    });

    assert.match(out.stdout, /Generating PostgreSQL dump/);
    assert.match(out.stdout, /Encrypting dump with AES-256-GCM/);
    assert.match(out.stdout, /Removing raw unencrypted dump immediately/);

    // Verify raw dump is purged
    const { readdir } = await import('node:fs/promises');
    const rawFiles = await readdir(backupDir).catch(() => []);
    assert.equal(rawFiles.filter((f) => f.endsWith('.dump')).length, 0, 'Raw dump must be purged immediately');

    // Verify encrypted file and checksum exist
    const encFiles = await readdir(offsiteDir);
    const encFile = encFiles.find((f) => f.endsWith('.enc'));
    const shaFile = encFiles.find((f) => f.endsWith('.enc.sha256'));
    assert.ok(encFile, 'Encrypted backup must exist');
    assert.ok(shaFile, 'Checksum file must exist');

    // 4. Restore: fails if checksum file is missing
    const fullEncPath = toShellPath(join(offsiteDir, encFile!));

    await rm(join(offsiteDir, shaFile!));
    await assert.rejects(
      async () =>
        runShell(restoreScript, {
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          ENCRYPTED_BACKUP_FILE: fullEncPath,
          ENCRYPTION_KEY_FILE: toShellPath(fakeKeyFile),
          TEMP_RESTORE_DIR: toShellPath(join(tempDir, 'restore-temp')),
        }),
      (err: Error) => /File checksum.*tidak ditemukan/i.test(err.message),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
