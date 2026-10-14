import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshHealthFile } from '../src/index.ts';

const STALE_MS = 120_000;

const createHealthFile = (): { dir: string; healthFile: string; stale: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-worker-health-'));
  const healthFile = join(dir, 'healthy');
  const stale = String(Date.now() - STALE_MS);
  writeFileSync(healthFile, stale);
  return { dir, healthFile, stale };
};

test('Health file stays stale and the failure is logged when the database probe fails', async () => {
  const { dir, healthFile, stale } = createHealthFile();
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    logged.push(String(message));
  };

  let refreshed = false;
  try {
    refreshed = await refreshHealthFile(healthFile, {
      database: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      },
      redis: async () => 'PONG',
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(refreshed, false);
  assert.equal(readFileSync(healthFile, 'utf8'), stale);
  assert.deepEqual(JSON.parse(logged[0] ?? '{}'), {
    service: 'agent-worker',
    event: 'healthcheck_failed',
    error: 'connect ECONNREFUSED 127.0.0.1:5432',
  });
  rmSync(dir, { recursive: true, force: true });
});

test('Health file stays stale when the redis probe fails', async () => {
  const { dir, healthFile, stale } = createHealthFile();

  const refreshed = await refreshHealthFile(healthFile, {
    database: async () => [{ '?column?': 1 }],
    redis: async () => {
      throw new Error('Connection is closed.');
    },
  });

  assert.equal(refreshed, false);
  assert.equal(readFileSync(healthFile, 'utf8'), stale);
  rmSync(dir, { recursive: true, force: true });
});

test('Health file is refreshed once both probes answer', async () => {
  const { dir, healthFile, stale } = createHealthFile();
  const startedAt = Date.now();

  const refreshed = await refreshHealthFile(healthFile, {
    database: async () => [{ '?column?': 1 }],
    redis: async () => 'PONG',
  });

  assert.equal(refreshed, true);
  const written = Number(readFileSync(healthFile, 'utf8'));
  assert.notEqual(String(written), stale);
  assert.ok(written >= startedAt && written <= Date.now(), `unexpected timestamp ${written}`);
  rmSync(dir, { recursive: true, force: true });
});
