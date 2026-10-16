import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from '../src/db/schema.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '../src/db/migrations');

interface ColumnRow {
  table_name: string;
  column_name: string;
  column_type: string;
}

/**
 * Applies every migration to a scratch database and compares the result with `schema.ts`.
 *
 * The bug this guards against is drift in the direction that actually bit us: `schema.ts` declared
 * a `memories` table that no migration created, so production ran without it while the code
 * assumed it existed. Only the schema -> database direction fails the test; extra tables in the
 * database are allowed because the migration runner owns `schema_migrations`.
 */
test('schema.ts matches the database the migrations build', async (t) => {
  const baseUrl =
    process.env['DATABASE_URL'] ??
    'postgresql://personal_ai_os:personal_ai_secret@127.0.0.1:5432/personal_ai_os';

  const scratchName = `schema_parity_${randomBytes(6).toString('hex')}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false, connect_timeout: 2, onnotice: () => undefined });

  try {
    await admin`SELECT 1 as ok`;
  } catch (err) {
    try {
      await admin.end({ timeout: 1 });
    } catch {
      // ignore
    }
    t.skip(`PostgreSQL not reachable: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const scratchUrl = new URL(baseUrl);
  scratchUrl.pathname = `/${scratchName}`;
  const scratch = postgres(scratchUrl.toString(), { max: 1, prepare: false, onnotice: () => undefined });

  try {
    await admin.unsafe(`CREATE DATABASE "${scratchName}"`);

    const migrations = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
    assert.ok(migrations.length > 0, 'no migration files found');
    for (const file of migrations) {
      await scratch.unsafe(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
    }

    const rows = await scratch<ColumnRow[]>`
      select c.relname as table_name, a.attname as column_name,
             format_type(a.atttypid, a.atttypmod) as column_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    `;
    const migrated = new Map<string, Map<string, string>>();
    for (const row of rows) {
      const columns = migrated.get(row.table_name) ?? new Map<string, string>();
      columns.set(row.column_name, row.column_type.replace('character varying', 'varchar'));
      migrated.set(row.table_name, columns);
    }

    const mismatches: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      const migratedColumns = migrated.get(config.name);
      if (!migratedColumns) {
        mismatches.push(`table ${config.name} is declared in schema.ts but no migration creates it`);
        continue;
      }
      for (const column of config.columns) {
        const migratedType = migratedColumns.get(column.name);
        if (migratedType === undefined) {
          mismatches.push(`column ${config.name}.${column.name} is declared in schema.ts but no migration creates it`);
          continue;
        }
        const declaredType = column.getSQLType().replace('character varying', 'varchar');
        if (migratedType !== declaredType) {
          mismatches.push(
            `column ${config.name}.${column.name} is ${migratedType} after the migrations but ${declaredType} in schema.ts`,
          );
        }
      }
    }

    assert.deepEqual(mismatches, []);
  } finally {
    await scratch.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});
