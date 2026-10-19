#!/usr/bin/env node
/**
 * Personal AI OS — Authenticated Backup Crypto Tool
 * Implements AES-256-GCM authenticated encryption/decryption for database backups.
 * Zero external dependencies: uses native Node.js crypto and fs.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const MAGIC_HEADER = Buffer.from('PAIOS_GCM_V1\n', 'utf8'); // 13 bytes
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC_HEADER.length + SALT_LEN + IV_LEN + TAG_LEN; // 57 bytes

function assertSafeKeyFile(keyFile) {
  if (!fs.existsSync(keyFile)) {
    console.error(`[backup-crypto] ERROR: Kunci enkripsi '${keyFile}' tidak ditemukan!`);
    process.exit(1);
  }

  const stat = fs.statSync(keyFile);
  if (!stat.isFile()) {
    console.error(`[backup-crypto] ERROR: '${keyFile}' bukan file regular!`);
    process.exit(1);
  }

  // Enforce strict 0600 file permissions on Unix-like systems (Linux/macOS)
  // Skip NTFS mounts under /mnt/ in WSL where POSIX permissions are emulated as 0777
  if (process.platform !== 'win32' && !keyFile.startsWith('/mnt/')) {
    const permissions = stat.mode & 0o777;
    // Check if group or others have any permissions (read, write, or execute)
    if ((permissions & 0o077) !== 0) {
      console.error(
        `[backup-crypto] FATAL: Izin file kunci '${keyFile}' terlalu longgar: ${permissions.toString(8)}. Wajib 0600 atau lebih ketat!`,
      );
      process.exit(1);
    }
  }

  const keyContent = fs.readFileSync(keyFile, 'utf8').trim();
  if (keyContent.length === 0) {
    console.error(`[backup-crypto] ERROR: File kunci '${keyFile}' kosong!`);
    process.exit(1);
  }

  return Buffer.from(keyContent, 'utf8');
}

function deriveKey(secretBuffer, saltBuffer) {
  // Scrypt KDF to derive 32-byte (256-bit) key
  return crypto.scryptSync(secretBuffer, saltBuffer, 32, { N: 16384, r: 8, p: 1 });
}

function encryptFile(inputFile, outputFile, keyFile) {
  if (!fs.existsSync(inputFile)) {
    console.error(`[backup-crypto] ERROR: File input '${inputFile}' tidak ditemukan!`);
    process.exit(1);
  }

  const keySecret = assertSafeKeyFile(keyFile);
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const derivedKey = deriveKey(keySecret, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const inputData = fs.readFileSync(inputFile);
  const encrypted = Buffer.concat([cipher.update(inputData), cipher.final()]);
  const tag = cipher.getAuthTag();

  // File structure: MAGIC_HEADER (13B) + SALT (16B) + IV (12B) + TAG (16B) + CIPHERTEXT
  const outputFd = fs.openSync(outputFile, 'w', 0o600);
  try {
    fs.writeSync(outputFd, MAGIC_HEADER);
    fs.writeSync(outputFd, salt);
    fs.writeSync(outputFd, iv);
    fs.writeSync(outputFd, tag);
    fs.writeSync(outputFd, encrypted);
  } finally {
    fs.closeSync(outputFd);
  }

  console.log(`[backup-crypto] File berhasil dienkripsi (AES-256-GCM terautentikasi): ${outputFile}`);
}

function decryptFile(inputFile, outputFile, keyFile) {
  if (!fs.existsSync(inputFile)) {
    console.error(`[backup-crypto] ERROR: File input '${inputFile}' tidak ditemukan!`);
    process.exit(1);
  }

  const keySecret = assertSafeKeyFile(keyFile);
  const fd = fs.openSync(inputFile, 'r');
  const leadBuf = Buffer.alloc(16);
  fs.readSync(fd, leadBuf, 0, 16, 0);
  fs.closeSync(fd);

  // 1. Check for Modern Authenticated Format (PAIOS_GCM_V1)
  if (leadBuf.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)) {
    const fileData = fs.readFileSync(inputFile);
    if (fileData.length < HEADER_LEN) {
      console.error(`[backup-crypto] ERROR: File '${inputFile}' rusak atau terlalu pendek!`);
      process.exit(1);
    }

    let offset = MAGIC_HEADER.length;
    const salt = fileData.subarray(offset, offset + SALT_LEN);
    offset += SALT_LEN;
    const iv = fileData.subarray(offset, offset + IV_LEN);
    offset += IV_LEN;
    const tag = fileData.subarray(offset, offset + TAG_LEN);
    offset += TAG_LEN;
    const ciphertext = fileData.subarray(offset);

    const derivedKey = deriveKey(keySecret, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);

    try {
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      fs.writeFileSync(outputFile, decrypted, { mode: 0o600 });
      console.log(`[backup-crypto] File berhasil didekripsi & terautentikasi (AES-256-GCM): ${outputFile}`);
      return;
    } catch (err) {
      console.error(
        `[backup-crypto] FATAL: Autentikasi integritas gagal! File backup '${inputFile}' rusak atau telah dimanipulasi: ${err.message}`,
      );
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      process.exit(1);
    }
  }

  // 2. Backward Compatibility: Check for Legacy OpenSSL Salted Format (Salted__)
  if (leadBuf.subarray(0, 8).toString('utf8') === 'Salted__') {
    console.warn(`[backup-crypto] PERINGATAN: File '${inputFile}' memakai format legacy OpenSSL AES-256-CBC.`);
    console.warn(`[backup-crypto] Mencoba dekripsi backward compatibility via openssl CLI...`);

    const opensslRes = spawnSync('openssl', [
      'enc',
      '-d',
      '-aes-256-cbc',
      '-pbkdf2',
      '-pass',
      `file:${keyFile}`,
      '-in',
      inputFile,
      '-out',
      outputFile,
    ]);

    if (opensslRes.status !== 0) {
      console.error(
        `[backup-crypto] ERROR: Dekripsi legacy OpenSSL gagal: ${opensslRes.stderr?.toString() || 'Exit code ' + opensslRes.status}`,
      );
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      process.exit(1);
    }

    console.log(`[backup-crypto] File legacy berhasil didekripsi: ${outputFile}`);
    return;
  }

  console.error(`[backup-crypto] ERROR: Format file enkripsi '${inputFile}' tidak dikenali!`);
  process.exit(1);
}

const [,, command, inputPath, outputPath, keyFilePath] = process.argv;

if (!command || !inputPath || !outputPath || !keyFilePath) {
  console.log('Penggunaan:');
  console.log('  node scripts/backup-crypto.js encrypt <inputFile> <outputFile> <keyFile>');
  console.log('  node scripts/backup-crypto.js decrypt <inputFile> <outputFile> <keyFile>');
  process.exit(1);
}

if (command === 'encrypt') {
  encryptFile(inputPath, outputPath, keyFilePath);
} else if (command === 'decrypt') {
  decryptFile(inputPath, outputPath, keyFilePath);
} else {
  console.error(`[backup-crypto] Perintah '${command}' tidak dikenali. Gunakan 'encrypt' atau 'decrypt'.`);
  process.exit(1);
}
