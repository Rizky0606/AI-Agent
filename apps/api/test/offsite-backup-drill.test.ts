import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import test from 'node:test';

interface KeyTableRecord {
  table: 'users' | 'tasks' | 'memories' | 'audit_logs' | 'schedules';
  id: string;
  data: Record<string, unknown>;
}

interface BackupSnapshot {
  schemaVersion: number;
  timestamp: string;
  source: string;
  records: KeyTableRecord[];
}

/**
 * Enkripsi payload snapshot menggunakan AES-256-CBC dengan PBKDF2 derivation.
 */
function encryptSnapshot(payload: string, passphrase: string): {
  encryptedData: Buffer;
  salt: Buffer;
  iv: Buffer;
  checksum: string;
} {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');

  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const combined = Buffer.concat([salt, iv, encrypted]);

  const checksum = createHash('sha256').update(combined).digest('hex');
  return { encryptedData: combined, salt, iv, checksum };
}

/**
 * Dekripsi payload snapshot dari data terenkripsi setelah verifikasi checksum.
 */
function decryptSnapshot(
  combinedData: Buffer,
  passphrase: string,
  expectedChecksum?: string,
): { payload: string; verifiedChecksum: boolean } {
  if (expectedChecksum) {
    const actualChecksum = createHash('sha256').update(combinedData).digest('hex');
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch! Expected: ${expectedChecksum}, got: ${actualChecksum}`);
    }
  }

  const salt = combinedData.subarray(0, 16);
  const iv = combinedData.subarray(16, 32);
  const encrypted = combinedData.subarray(32);

  const key = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return { payload: decrypted.toString('utf8'), verifiedChecksum: true };
}

test('Offsite Backup & Restore Drill: integritas enkripsi, checksum SHA256, dan jumlah baris tabel kunci', () => {
  const mockDbSnapshot: BackupSnapshot = {
    schemaVersion: 10,
    timestamp: '2026-10-16T09:00:00.000Z',
    source: 'production-vps-arm64',
    records: [
      { table: 'users', id: 'usr-1', data: { email: 'admin@personal-ai.local', role: 'owner' } },
      { table: 'users', id: 'usr-2', data: { email: 'worker@personal-ai.local', role: 'system' } },
      { table: 'tasks', id: 'tsk-1', data: { kind: 'coding', status: 'completed' } },
      { table: 'tasks', id: 'tsk-2', data: { kind: 'research', status: 'completed' } },
      { table: 'tasks', id: 'tsk-3', data: { kind: 'generic', status: 'waiting_approval' } },
      { table: 'memories', id: 'mem-1', data: { content: 'User prefers Bahasa Indonesia', status: 'active' } },
      { table: 'memories', id: 'mem-2', data: { content: 'Host VPS IP 172.20.0.1', status: 'active' } },
      { table: 'audit_logs', id: 'aud-1', data: { action: 'device:command', outcome: 'success' } },
      { table: 'audit_logs', id: 'aud-2', data: { action: 'artifact:write', outcome: 'success' } },
      { table: 'audit_logs', id: 'aud-3', data: { action: 'approval:approved', outcome: 'success' } },
      { table: 'schedules', id: 'sch-1', data: { cron: '0 8 * * *', taskKind: 'smoke.echo' } },
    ],
  };

  const payloadString = JSON.stringify(mockDbSnapshot);
  const passphrase = 'SuperSecretOffsitePassphraseNeverStoredOnServer-2026!';

  // 1. Eksekusi enkripsi offsite
  const { encryptedData, checksum } = encryptSnapshot(payloadString, passphrase);
  assert.ok(encryptedData.length > 0, 'Data terenkripsi tidak boleh kosong');
  assert.equal(checksum.length, 64, 'Checksum SHA256 harus 64 karakter hex');

  // 2. Verifikasi drill: tamper detection
  const tamperedData = Buffer.from(encryptedData);
  tamperedData[tamperedData.length - 1] ^= 0xff; // Flip bits
  assert.throws(
    () => decryptSnapshot(tamperedData, passphrase, checksum),
    /Checksum mismatch/,
    'Data yang dimanipulasi harus ditolak oleh validasi checksum',
  );

  // 3. Verifikasi drill: dekripsi dan pemulihan
  const { payload, verifiedChecksum } = decryptSnapshot(encryptedData, passphrase, checksum);
  assert.ok(verifiedChecksum, 'Verifikasi checksum harus berhasil');

  const restored: BackupSnapshot = JSON.parse(payload);
  assert.equal(restored.schemaVersion, mockDbSnapshot.schemaVersion);

  // 4. Verifikasi jumlah baris tabel kunci (Key Table Row Counts)
  const counts = restored.records.reduce<Record<string, number>>((acc, rec) => {
    acc[rec.table] = (acc[rec.table] ?? 0) + 1;
    return acc;
  }, {});

  assert.equal(counts.users, 2, 'Tabel users harus memiliki tepat 2 baris');
  assert.equal(counts.tasks, 3, 'Tabel tasks harus memiliki tepat 3 baris');
  assert.equal(counts.memories, 2, 'Tabel memories harus memiliki tepat 2 baris');
  assert.equal(counts.audit_logs, 3, 'Tabel audit_logs harus memiliki tepat 3 baris');
  assert.equal(counts.schedules, 1, 'Tabel schedules harus memiliki tepat 1 baris');
});
