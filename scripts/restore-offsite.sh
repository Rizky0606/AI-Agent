#!/usr/bin/env sh
# Personal AI OS — Offsite Database Restore & Verification Script
# Verifies SHA-256 checksum, decrypts authenticated AES-256-GCM (with backward compatibility for legacy OpenSSL CBC),
# restores PostgreSQL dump, and verifies key table row counts.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${ENCRYPTED_BACKUP_FILE:?ENCRYPTED_BACKUP_FILE is required}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-/etc/personal-ai-os/backup-encryption.key}"
TEMP_RESTORE_DIR="${TEMP_RESTORE_DIR:-./backups/restore-temp}"

if [ ! -f "$ENCRYPTION_KEY_FILE" ]; then
  echo "[restore-offsite] ERROR: Kunci enkripsi '$ENCRYPTION_KEY_FILE' tidak ditemukan!" >&2
  exit 1
fi

if [ ! -f "$ENCRYPTED_BACKUP_FILE" ]; then
  echo "[restore-offsite] ERROR: File backup terenkripsi '$ENCRYPTED_BACKUP_FILE' tidak ditemukan!" >&2
  exit 1
fi

mkdir -p "$TEMP_RESTORE_DIR"
decrypted_file="$TEMP_RESTORE_DIR/restore_target_$(date -u +%Y%m%dT%H%M%SZ).dump"

# Cleanup trap to ensure decrypted dump is never left behind
cleanup() {
  if [ -f "$decrypted_file" ]; then
    rm -f "$decrypted_file"
  fi
}
trap cleanup EXIT INT TERM

echo "[restore-offsite] Memverifikasi integritas checksum SHA-256..."
checksum_file="$ENCRYPTED_BACKUP_FILE.sha256"
if [ ! -f "$checksum_file" ]; then
  echo "[restore-offsite] ERROR: File checksum '$checksum_file' tidak ditemukan! Pemulihan dibatalkan demi keamanan." >&2
  exit 1
fi

# Verify SHA256 integrity
if command -v sha256sum >/dev/null 2>&1; then
  # Strip path differences if necessary
  expected_hash="$(awk '{print $1}' "$checksum_file")"
  actual_hash="$(sha256sum "$ENCRYPTED_BACKUP_FILE" | awk '{print $1}')"
  if [ "$expected_hash" != "$actual_hash" ]; then
    echo "[restore-offsite] FATAL: Checksum SHA-256 tidak cocok! File telah dimanipulasi atau korup." >&2
    exit 1
  fi
else
  node -e "
    const fs = require('fs');
    const crypto = require('crypto');
    const expected = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
    if (expected.toLowerCase() !== actual.toLowerCase()) {
      console.error('[restore-offsite] FATAL: Checksum SHA-256 mismatch! Expected ' + expected + ', got ' + actual);
      process.exit(1);
    }
  " "$ENCRYPTED_BACKUP_FILE" "$checksum_file"
fi
echo "[restore-offsite] Verifikasi checksum SHA-256 LULUS."

echo "[restore-offsite] Mendekripsi file dump via authenticated crypto..."
if ! node "$SCRIPT_DIR/backup-crypto.js" decrypt "$ENCRYPTED_BACKUP_FILE" "$decrypted_file" "$ENCRYPTION_KEY_FILE"; then
  echo "[restore-offsite] FATAL: Dekripsi gagal! Kunci salah atau file terenkripsi telah dimanipulasi." >&2
  exit 1
fi

echo "[restore-offsite] Memulihkan basis data PostgreSQL dari dump terdekripsi..."
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --exit-on-error "$decrypted_file"

# Immediately purge decrypted dump
echo "[restore-offsite] Menghapus dump mentah terdekripsi..."
rm -f "$decrypted_file"

echo "[restore-offsite] Basis data berhasil dipulihkan. Memverifikasi jumlah baris tabel utama..."
psql "$DATABASE_URL" -t -c "
SELECT 'users' AS table_name, count(*) AS row_count FROM users
UNION ALL
SELECT 'tasks', count(*) FROM tasks
UNION ALL
SELECT 'memories', count(*) FROM memories
UNION ALL
SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL
SELECT 'schedules', count(*) FROM schedules;
"

echo "[restore-offsite] Pemulihan dan verifikasi integritas backup offsite selesai dengan sukses."
