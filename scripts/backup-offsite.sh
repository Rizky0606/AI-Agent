#!/usr/bin/env sh
# Personal AI OS — Offsite Database Backup Script
# Creates an encrypted snapshot of PostgreSQL and uploads it to S3-compatible Oracle Object Storage.
set -eu

# Load secret environment if present
S3_CREDENTIALS_FILE="${S3_CREDENTIALS_FILE:-/etc/personal-ai-os/s3-backup.env}"
if [ -f "$S3_CREDENTIALS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$S3_CREDENTIALS_FILE"
fi

: "${DATABASE_URL:?DATABASE_URL or DATABASE_URL_FILE is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
OFFSITE_DIR="${OFFSITE_DIR:-./backups/offsite}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-/etc/personal-ai-os/backup-encryption.key}"

mkdir -p "$BACKUP_DIR" "$OFFSITE_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/personal_ai_os-$stamp.dump"
encrypted_file="$OFFSITE_DIR/personal_ai_os-$stamp.dump.enc"
checksum_file="$OFFSITE_DIR/personal_ai_os-$stamp.dump.enc.sha256"

umask 077

echo "[backup-offsite] Generating PostgreSQL dump..."
pg_dump "$DATABASE_URL" --format=custom --no-owner --file "$dump_file"

echo "[backup-offsite] Encrypting dump with AES-256..."
if [ -f "$ENCRYPTION_KEY_FILE" ]; then
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass file:"$ENCRYPTION_KEY_FILE" -in "$dump_file" -out "$encrypted_file"
elif [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:"$BACKUP_ENCRYPTION_PASSPHRASE" -in "$dump_file" -out "$encrypted_file"
else
  echo "[backup-offsite] PERINGATAN: Tidak ada ENCRYPTION_KEY_FILE atau BACKUP_ENCRYPTION_PASSPHRASE. Menggunakan kunci fallback lokal sementara." >&2
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:"personal-ai-os-default-key-$stamp" -in "$dump_file" -out "$encrypted_file"
fi

echo "[backup-offsite] Calculating SHA256 checksum..."
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$encrypted_file" > "$checksum_file"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$encrypted_file" > "$checksum_file"
else
  openssl dgst -sha256 "$encrypted_file" > "$checksum_file"
fi

echo "[backup-offsite] Encrypted backup created: $encrypted_file"
cat "$checksum_file"

# Upload to S3-compatible Oracle Object Storage if configured
if [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ENDPOINT_URL:-}" ]; then
  echo "[backup-offsite] Uploading to S3 bucket $S3_BUCKET at $S3_ENDPOINT_URL..."
  if command -v aws >/dev/null 2>&1; then
    aws --endpoint-url "$S3_ENDPOINT_URL" s3 cp "$encrypted_file" "s3://$S3_BUCKET/backups/personal_ai_os-$stamp.dump.enc"
    aws --endpoint-url "$S3_ENDPOINT_URL" s3 cp "$checksum_file" "s3://$S3_BUCKET/backups/personal_ai_os-$stamp.dump.enc.sha256"
    echo "[backup-offsite] S3 upload completed successfully."
  else
    echo "[backup-offsite] AWS CLI tidak ditemukan, snapshot tersimpan di OFFSITE_DIR: $OFFSITE_DIR"
  fi
fi

# Retention policy: remove local unencrypted dumps older than RETENTION_DAYS
if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  echo "[backup-offsite] Cleaning up local unencrypted dumps older than $RETENTION_DAYS days..."
  find "$BACKUP_DIR" -name 'personal_ai_os-*.dump' -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
fi

echo "[backup-offsite] Backup offsite workflow completed for $stamp."
