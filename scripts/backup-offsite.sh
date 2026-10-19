#!/usr/bin/env sh
# Personal AI OS — Offsite Database Backup Script
# Creates an authenticated AES-256-GCM encrypted snapshot of PostgreSQL and uploads it to S3-compatible Oracle Object Storage.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load secret environment if present
S3_CREDENTIALS_FILE="${S3_CREDENTIALS_FILE:-/etc/personal-ai-os/s3-backup.env}"
if [ -f "$S3_CREDENTIALS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$S3_CREDENTIALS_FILE"
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
OFFSITE_DIR="${OFFSITE_DIR:-./backups/offsite}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-/etc/personal-ai-os/backup-encryption.key}"

trigger_alert() {
  msg="[ALERT] Offsite Backup FAILED: $1"
  echo "$msg" >&2
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    if command -v curl >/dev/null 2>&1; then
      curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${TELEGRAM_CHAT_ID}" \
        -d text="$msg" >/dev/null 2>&1 || true
    fi
  fi
}

fail() {
  trigger_alert "$1"
  exit 1
}

# 1. Strict encryption key verification (Hard fail if missing or unsafe)
if [ ! -f "$ENCRYPTION_KEY_FILE" ]; then
  fail "Kunci enkripsi '$ENCRYPTION_KEY_FILE' tidak ditemukan! Enkripsi offsite wajib menggunakan berkas kunci yang valid."
fi

# 2. Strict S3 configuration validation (Offsite upload is mandatory)
if [ -z "${S3_BUCKET:-}" ] || [ -z "${S3_ENDPOINT_URL:-}" ]; then
  fail "Konfigurasi S3 tidak lengkap (S3_BUCKET atau S3_ENDPOINT_URL kosong). Mode offsite mewajibkan destinasi S3."
fi

if ! command -v aws >/dev/null 2>&1; then
  fail "AWS CLI ('aws') tidak terpasang di sistem. Unggahan S3 offsite tidak dapat dilakukan."
fi

mkdir -p "$BACKUP_DIR" "$OFFSITE_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/personal_ai_os-$stamp.dump"
encrypted_file="$OFFSITE_DIR/personal_ai_os-$stamp.dump.enc"
checksum_file="$OFFSITE_DIR/personal_ai_os-$stamp.dump.enc.sha256"

# Cleanup trap to ensure unencrypted dump is never left behind on unexpected abort
cleanup() {
  if [ -f "$dump_file" ]; then
    rm -f "$dump_file"
  fi
}
trap cleanup EXIT INT TERM

umask 077

echo "[backup-offsite] Generating PostgreSQL dump..."
pg_dump "$DATABASE_URL" --format=custom --no-owner --file "$dump_file"

echo "[backup-offsite] Encrypting dump with AES-256-GCM (authenticated encryption)..."
if ! node "$SCRIPT_DIR/backup-crypto.js" encrypt "$dump_file" "$encrypted_file" "$ENCRYPTION_KEY_FILE"; then
  fail "Proses enkripsi AES-256-GCM gagal!"
fi

echo "[backup-offsite] Calculating SHA256 checksum..."
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$encrypted_file" > "$checksum_file"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$encrypted_file" > "$checksum_file"
else
  node -e "
    const fs = require('fs');
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
    fs.writeFileSync(process.argv[2], hash + '  ' + process.argv[1] + '\n');
  " "$encrypted_file" "$checksum_file"
fi

echo "[backup-offsite] Uploading to S3 bucket $S3_BUCKET at $S3_ENDPOINT_URL..."
if ! aws --endpoint-url "$S3_ENDPOINT_URL" s3 cp "$encrypted_file" "s3://$S3_BUCKET/backups/personal_ai_os-$stamp.dump.enc"; then
  fail "Gagal mengunggah file backup terenkripsi ke S3!"
fi

if ! aws --endpoint-url "$S3_ENDPOINT_URL" s3 cp "$checksum_file" "s3://$S3_BUCKET/backups/personal_ai_os-$stamp.dump.enc.sha256"; then
  fail "Gagal mengunggah file checksum ke S3!"
fi
echo "[backup-offsite] S3 upload completed successfully."

# Remove raw unencrypted dump immediately after successful encryption and upload
echo "[backup-offsite] Removing raw unencrypted dump immediately..."
rm -f "$dump_file"

# Retention policy: remove local encrypted backups older than RETENTION_DAYS
if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  echo "[backup-offsite] Cleaning up local encrypted backups older than $RETENTION_DAYS days..."
  find "$OFFSITE_DIR" -name 'personal_ai_os-*.dump.enc*' -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
fi

echo "[backup-offsite] Backup offsite workflow completed successfully for $stamp."
