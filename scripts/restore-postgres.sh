#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner --exit-on-error "$BACKUP_FILE"
