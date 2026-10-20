import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contained, prepareWorkspace } from '../src/workspace-manager.ts';
import { cleanEnv, parseOmpLine, TOKEN_REGEX, MAX_LINE_BUFFER_BYTES } from '../src/index.ts';

test('token: validates format against strict TOKEN_REGEX', () => {
  // Valid tokens: alphanumeric, 32-512 chars, valid RFC 6750 URL-safe chars
  assert.equal(TOKEN_REGEX.test('a'.repeat(32)), true);
  assert.equal(TOKEN_REGEX.test('A'.repeat(64)), true);
  assert.equal(TOKEN_REGEX.test('valid-token_with.chars~and+slash/1234567890'), true);

  // Invalid tokens
  assert.equal(TOKEN_REGEX.test('short'), false); // < 32 chars
  assert.equal(TOKEN_REGEX.test('a'.repeat(31)), false);
  assert.equal(TOKEN_REGEX.test('a'.repeat(513)), false); // > 512 chars
  assert.equal(TOKEN_REGEX.test('token with space'.repeat(3)), false);
  assert.equal(TOKEN_REGEX.test('token;injection;value;'.repeat(2)), false);
  assert.equal(TOKEN_REGEX.test('token\0nullbyte'.repeat(4)), false);
  assert.equal(TOKEN_REGEX.test('Bearer invalid'), false);
});

test('workspace: contained() enforces strict hierarchy across platforms and casing', () => {
  const root = process.platform === 'win32' ? 'C:\\srv\\aios\\workspaces' : '/srv/aios/workspaces';
  const validChild = process.platform === 'win32'
    ? 'C:\\srv\\aios\\workspaces\\proj1\\task1'
    : '/srv/aios/workspaces/proj1/task1';
  const siblingEscape = process.platform === 'win32'
    ? 'C:\\srv\\aios\\workspaces_other\\task1'
    : '/srv/aios/workspaces_other/task1';
  const parentEscape = process.platform === 'win32'
    ? 'C:\\srv\\aios\\escape'
    : '/srv/aios/escape';

  assert.equal(contained(root, validChild), true);
  assert.equal(contained(root, root), true);
  assert.equal(contained(root, siblingEscape), false);
  assert.equal(contained(root, parentEscape), false);

  if (process.platform === 'win32') {
    // Windows case insensitivity check
    const upperRoot = 'C:\\SRV\\AIOS\\WORKSPACES';
    const lowerChild = 'c:\\srv\\aios\\workspaces\\proj1\\task1';
    assert.equal(contained(upperRoot, lowerChild), true);
  }
});

test('workspace: prepareWorkspace rejects path traversal, backslashes, drive letters, and colons', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'rb-ws-test-'));

  // Traversal with ..
  await assert.rejects(
    () => prepareWorkspace(testRoot, '../escape', 't1'),
    /invalid workspaceId/
  );
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'proj/../../escape', 't1'),
    /invalid workspaceId/
  );

  // Windows backslash traversal
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'proj\\..\\escape', 't1'),
    /invalid workspaceId/
  );

  // Drive letter or colon
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'C:\\proj', 't1'),
    /invalid workspaceId/
  );
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'proj:stream', 't1'),
    /invalid workspaceId/
  );

  // Invalid taskId
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'proj', '../task-escape'),
    /invalid taskId/
  );
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'proj', 'task/with/slash'),
    /invalid taskId/
  );
  await assert.rejects(
    () => prepareWorkspace(testRoot, 'proj', 'task\0null'),
    /invalid taskId/
  );
});

test('environment: cleanEnv strictly enforces allowlist and blocks attack vectors', () => {
  const tainted = {
    // Attack vectors
    NODE_OPTIONS: '--inspect=0.0.0.0:9229 --eval=evil()',
    LD_PRELOAD: '/tmp/evil.so',
    LD_LIBRARY_PATH: '/tmp',
    DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
    GIT_SSH_COMMAND: 'rm -rf /',
    GIT_CONFIG: '/tmp/gitconfig',
    PERL5OPT: '-d',
    PYTHONPATH: '/tmp/malicious',

    // Secrets
    DATABASE_URL: 'postgres://root:secret@db:5432/prod',
    NINEROUTER_API_KEY: 'sk-9router-secret-key',
    JWT_SECRET: 'my-jwt-secret-token',
    AUTH_HEADER: 'Bearer secret',

    // Legitimate allowed variables
    NODE_ENV: 'production',
    CI: 'true',
    TERM: 'xterm-256color',
    SAFE_PROJECT_NAME: 'PersonalAI',
    PROJECT_STAGE: 'qa',
    APP_DEBUG: '0',
    TASK_PRIORITY: 'high',

    // Value with null byte / newline (must be rejected)
    SAFE_MALFORMED: 'ok\0evil',
  };

  const cleaned = cleanEnv(tainted);

  // Blocked attack vectors
  assert.equal(cleaned['NODE_OPTIONS'], undefined);
  assert.equal(cleaned['LD_PRELOAD'], undefined);
  assert.equal(cleaned['LD_LIBRARY_PATH'], undefined);
  assert.equal(cleaned['DYLD_INSERT_LIBRARIES'], undefined);
  assert.equal(cleaned['GIT_SSH_COMMAND'], undefined);
  assert.equal(cleaned['GIT_CONFIG'], undefined);
  assert.equal(cleaned['PERL5OPT'], undefined);
  assert.equal(cleaned['PYTHONPATH'], undefined);

  // Blocked secrets
  assert.equal(cleaned['DATABASE_URL'], undefined);
  assert.equal(cleaned['NINEROUTER_API_KEY'], undefined);
  assert.equal(cleaned['JWT_SECRET'], undefined);
  assert.equal(cleaned['AUTH_HEADER'], undefined);

  // Blocked malformed
  assert.equal(cleaned['SAFE_MALFORMED'], undefined);

  // Allowed safe variables
  assert.equal(cleaned['NODE_ENV'], 'production');
  assert.equal(cleaned['CI'], 'true');
  assert.equal(cleaned['TERM'], 'xterm-256color');
  assert.equal(cleaned['SAFE_PROJECT_NAME'], 'PersonalAI');
  assert.equal(cleaned['PROJECT_STAGE'], 'qa');
  assert.equal(cleaned['APP_DEBUG'], '0');
  assert.equal(cleaned['TASK_PRIORITY'], 'high');

  // Baseline variables must be present
  assert.ok(cleaned['PATH']);
  assert.ok(cleaned['HOME']);
  assert.equal(cleaned['OMP_NO_UPDATE_CHECK'], '1');
});

test('output bounds: parseOmpLine bounds event text, diff, and planItems payloads', () => {
  // Massive text (> 64KB)
  const hugeText = 'A'.repeat(100_000);
  const textEvent = parseOmpLine(JSON.stringify({
    type: 'message_update',
    text: hugeText,
  }));
  assert.ok(textEvent);
  assert.equal(textEvent.data.text?.length, 65_536);

  // Massive diff (> 64KB, but within line limit of 128KB)
  const hugeDiff = 'D'.repeat(100_000);
  const diffEvent = parseOmpLine(JSON.stringify({
    type: 'file_edit',
    path: 'test.ts',
    diff: hugeDiff,
  }));
  assert.ok(diffEvent);
  assert.equal(diffEvent.data.diff?.length, 65_536);

  // Massive plan items (> 100 items, each > 512 chars, total line < 128KB)
  const massiveTodos = Array.from({ length: 150 }, (_, i) => `item ${i}: ${'x'.repeat(600)}`);
  const planEvent = parseOmpLine(JSON.stringify({
    type: 'plan',
    todos: massiveTodos,
  }));
  assert.ok(planEvent);
  assert.equal(planEvent.data.planItems?.length, 100);
  assert.equal(planEvent.data.planItems?.[0]?.length, 512);

  // Line exceeding MAX_LINE_BUFFER_BYTES is dropped
  const oversizedLine = JSON.stringify({ type: 'message_update', text: 'x'.repeat(MAX_LINE_BUFFER_BYTES + 10) });
  assert.equal(parseOmpLine(oversizedLine), undefined);
});
