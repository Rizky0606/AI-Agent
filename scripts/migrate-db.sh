#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-apps/api/src/db/migrations}"

psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --quiet <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in "$MIGRATIONS_DIR"/*.sql; do
  filename="$(basename "$migration")"
  applied="$(psql "$DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --command "SELECT 1 FROM schema_migrations WHERE filename = '$filename' LIMIT 1")"
  if [ "$applied" = "1" ]; then
    echo "skipping $filename (already applied)"
    continue
  fi
  echo "applying $filename"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$migration"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --quiet \
    --command "INSERT INTO schema_migrations (filename) VALUES ('$filename')"
done
echo "migrations up to date"
