#!/usr/bin/env sh
set -eu

if [ -n "${DATABASE_URL_FILE:-}" ] && [ -f "$DATABASE_URL_FILE" ]; then
  DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
  export DATABASE_URL
fi

: "${DATABASE_URL:?DATABASE_URL or DATABASE_URL_FILE is required}"
exec "$(dirname "$0")/backup-postgres.sh"
