#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/personal_ai_os-$stamp.dump"
umask 077
pg_dump "$DATABASE_URL" --format=custom --no-owner --file "$target"
printf '%s\n' "$target"
