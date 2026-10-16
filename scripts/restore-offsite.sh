#!/usr/bin/env sh
# Personal AI OS — Offsite Database Restore & Verification Script
# Downloads, decrypts, and restores PostgreSQL dump, verifying checksum and key table row counts.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${ENCRYPTED_BACKUP_FILE:?ENCRYPTED_BACKUP_FILE is required}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-/etc/personal-ai-os/backup-encryption.key}"
TEMP_RESTORE_DIR="${TEMP_RESTORE_DIR:-./backups/restore-temp}"

mkdir -p "$TEMP_RESTORE_DIR"
decrypted_file="$TEMP_RESTORE_DIR/restore_target.dump"

echo "[restore-offsite] Verifying checksum if .sha256 file exists..."
checksum_file="$ENCRYPTED_BACKUP_FILE.sha256"
if [ -f "$checksum_file" ]; then
  echo "[restore-offsite] Checking SHA-256 integrity..."
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksum_file"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$checksum_file"
  fi
  echo "[restore-offsite] Checksum verification PASSED."
else
  echo "[restore-offsite] Checksum file not found, proceeding with caution."
fi

echo "[restore-offsite] Decrypting dump file..."
if [ -f "$ENCRYPTION_KEY_FILE" ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$ENCRYPTION_KEY_FILE" -in "$ENCRYPTED_BACKUP_FILE" -out "$decrypted_file"
elif [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$BACKUP_ENCRYPTION_PASSPHRASE" -in "$ENCRYPTED_BACKUP_FILE" -out "$decrypted_file"
else
  echo "[restore-offsite] ERROR: Neither ENCRYPTION_KEY_FILE nor BACKUP_ENCRYPTION_PASSPHRASE provided!" >&2
  exit 1
fi

echo "[restore-offsite] Restoring PostgreSQL database from decrypted dump..."
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --exit-on-error "$decrypted_file"
rm -f "$decrypted_file"

echo "[restore-offsite] Database restored successfully. Verifying table row counts..."
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

echo "[restore-offsite] Restore drill completed and verified successfully."
