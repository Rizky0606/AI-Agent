#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/personal_ai_os-$stamp.dump"
umask 077
pg_dump "$DATABASE_URL" --format=custom --no-owner --file "$target"
printf '%s\n' "$target"

# retention: delete dumps older than RETENTION_DAYS (default 14)
if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_DIR" -name 'personal_ai_os-*.dump' -type f -mtime "+$RETENTION_DAYS" -print -delete
fi
