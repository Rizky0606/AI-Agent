#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
for migration in apps/api/src/db/migrations/*.sql; do
  echo "applying ${migration}"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file "$migration"
done
