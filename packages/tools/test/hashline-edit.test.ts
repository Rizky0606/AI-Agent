import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  computeLineHash,
  createHashlineEditTool,
  HashlineCollisionError,
  MAX_EDITS_PER_BATCH,
  MAX_FILE_SIZE_BYTES,
  MAX_REPLACEMENT_BYTES,
  parseLineAnchor,
  ToolError,
  ToolRegistry,
} from '../src/index.ts';

test('computeLineHash generates deterministic lowercase hex prefixes', () => {
  const line = 'const message = "hello world";';
  const hash3 = computeLineHash(line, 3);
  const hash4 = computeLineHash(line, 4);

  assert.equal(hash3.length, 3);
  assert.equal(hash4.length, 4);
  assert.equal(hash4.slice(0, 3), hash3);
  // Deterministic
  assert.equal(computeLineHash(line, 3), hash3);
  // Different content produces different hash
  assert.notEqual(computeLineHash('different line', 3), hash3);
});

test('parseLineAnchor parses valid anchors and rejects invalid formats', () => {
  const parsed1 = parseLineAnchor('42#a1f');
  assert.deepEqual(parsed1, { lineNumber: 42, expectedHash: 'a1f' });

  const parsed2 = parseLineAnchor('  1#E3C8  ');
  assert.deepEqual(parsed2, { lineNumber: 1, expectedHash: 'e3c8' });

  assert.throws(() => parseLineAnchor('invalid'), (err: unknown) => {
    return err instanceof ToolError && err.message.includes('Format lineAnchor tidak valid');
  });

  assert.throws(() => parseLineAnchor('0#abc'), (err: unknown) => {
    return err instanceof ToolError && err.message.includes('harus lebih besar dari 0');
  });

  assert.throws(() => parseLineAnchor('-5#abc'), (err: unknown) => {
    return err instanceof ToolError && err.message.includes('Format lineAnchor tidak valid');
  });
});

test('hashline_edit: replaces single line accurately when hash matches and generates diff', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const filePath = join(tempDir, 'sample.ts');
    const initialContent = [
      'export function greet(name: string): string {',
      '  const greeting = "Hello";',
      '  return `${greeting}, ${name}!`;',
      '}',
    ].join('\n');
    await writeFile(filePath, initialContent, 'utf-8');

    const line2 = '  const greeting = "Hello";';
    const hash2 = computeLineHash(line2, 3);

    const tool = createHashlineEditTool(tempDir);
    const result = await tool.execute(
      {
        filePath: 'sample.ts',
        edits: [
          {
            lineAnchor: `2#${hash2}`,
            replacement: '  const greeting = "Halo";',
          },
        ],
      },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.linesModified, 1);
    assert.equal(result.totalLines, 4);
    assert.ok(result.diff.includes('--- a/sample.ts'));
    assert.ok(result.diff.includes('+++ b/sample.ts'));
    assert.ok(result.diff.includes('-  const greeting = "Hello";'));
    assert.ok(result.diff.includes('+  const greeting = "Halo";'));
    assert.equal(typeof result.fileVersionHash, 'string');
    assert.equal(result.fileVersionHash.length, 12);

    const updated = await readFile(filePath, 'utf-8');
    const updatedLines = updated.split('\n');
    assert.equal(updatedLines[1], '  const greeting = "Halo";');
    assert.equal(updatedLines[0], 'export function greet(name: string): string {');
    assert.equal(updatedLines[2], '  return `${greeting}, ${name}!`;');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: applies multiple edits in descending order with multi-line expansions', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const filePath = join(tempDir, 'config.json');
    const initialLines = [
      '{',
      '  "name": "app",',
      '  "version": "1.0.0",',
      '  "debug": false',
      '}',
    ];
    await writeFile(filePath, initialLines.join('\n'), 'utf-8');

    const hash2 = computeLineHash(initialLines[1]!, 3); // line 2
    const hash4 = computeLineHash(initialLines[3]!, 3); // line 4

    const tool = createHashlineEditTool(tempDir);
    const result = await tool.execute(
      {
        filePath: 'config.json',
        edits: [
          {
            lineAnchor: `2#${hash2}`,
            replacement: '  "name": "my-cool-app",\n  "private": true,',
          },
          {
            lineAnchor: `4#${hash4}`,
            replacement: '  "debug": true',
          },
        ],
      },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.linesModified, 2);
    assert.equal(result.totalLines, 6); // 1 extra line from line 2 replacement

    const updated = await readFile(filePath, 'utf-8');
    const updatedLines = updated.split('\n');
    assert.equal(updatedLines[0], '{');
    assert.equal(updatedLines[1], '  "name": "my-cool-app",');
    assert.equal(updatedLines[2], '  "private": true,');
    assert.equal(updatedLines[3], '  "version": "1.0.0",');
    assert.equal(updatedLines[4], '  "debug": true');
    assert.equal(updatedLines[5], '}');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects atomically on hash collision with stale_anchor status (file untouched)', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const filePath = join(tempDir, 'data.txt');
    const initialContent = 'line 1\nline 2 original\nline 3\n';
    await writeFile(filePath, initialContent, 'utf-8');

    const tool = createHashlineEditTool(tempDir);

    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: 'data.txt',
            edits: [
              {
                lineAnchor: '2#fff', // Wrong hash!
                replacement: 'line 2 modified',
              },
            ],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        assert.ok(err instanceof HashlineCollisionError);
        const collisionErr = err as HashlineCollisionError;
        assert.equal(collisionErr.status, 'stale_anchor');
        assert.equal(collisionErr.line, 2);
        assert.equal(collisionErr.expectedHash, 'fff');
        assert.equal(collisionErr.currentLineContent, 'line 2 original');
        return true;
      },
    );

    // Verify file content was NOT touched
    const contentAfter = await readFile(filePath, 'utf-8');
    assert.equal(contentAfter, initialContent);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects line number out of range and duplicate line edits', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const filePath = join(tempDir, 'small.txt');
    await writeFile(filePath, 'one\ntwo\n', 'utf-8');

    const tool = createHashlineEditTool(tempDir);

    // Out of range (line 10 on a 2-line file)
    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: 'small.txt',
            edits: [{ lineAnchor: '10#abc', replacement: 'foo' }],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        return err instanceof ToolError && err.message.includes('melebihi jumlah baris file');
      },
    );

    // Duplicate line edit in same batch
    const hash1 = computeLineHash('one', 3);
    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: 'small.txt',
            edits: [
              { lineAnchor: `1#${hash1}`, replacement: 'first' },
              { lineAnchor: `1#${hash1}`, replacement: 'second' },
            ],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        return err instanceof ToolError && err.message.includes('Duplikasi edit terdeteksi');
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects path traversal outside workspace', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const tool = createHashlineEditTool(tempDir);

    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: '../outside.txt',
            edits: [{ lineAnchor: '1#abc', replacement: 'danger' }],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        return err instanceof ToolError && err.message.includes('Path traversal terdeteksi');
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects sensitive and credential files', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const tool = createHashlineEditTool(tempDir);
    const sensitiveFiles = ['.env', '.env.production', 'my_secret_token.txt', 'id_rsa', 'db_credential.json'];

    for (const f of sensitiveFiles) {
      await assert.rejects(
        async () =>
          tool.execute(
            {
              filePath: f,
              edits: [{ lineAnchor: '1#abc', replacement: 'leak' }],
            },
            { actor: { id: 'test-user', role: 'user' } },
          ),
        (err: unknown) => {
          return err instanceof ToolError && err.message.includes('Akses/modifikasi ke file sensitif/kredensial');
        },
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects symbolic links via lstat check', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const targetFile = join(tempDir, 'link.ts');
    await writeFile(targetFile, 'console.log("symlink target");\n', 'utf-8');

    const tool = createHashlineEditTool(tempDir, {
      fs: {
        lstat: async () => ({
          isSymbolicLink: () => true,
          isFile: () => true,
          size: 100,
        }),
      },
    });

    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: 'link.ts',
            edits: [{ lineAnchor: '1#abc', replacement: 'new' }],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        return err instanceof ToolError && err.message.includes('adalah symbolic link');
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects file exceeding MAX_FILE_SIZE_BYTES (5 MB)', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const targetFile = join(tempDir, 'large.txt');
    await writeFile(targetFile, 'placeholder\n', 'utf-8');

    const tool = createHashlineEditTool(tempDir, {
      fs: {
        lstat: async () => ({
          isSymbolicLink: () => false,
          isFile: () => true,
          size: MAX_FILE_SIZE_BYTES + 1024,
        }),
      },
    });

    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: 'large.txt',
            edits: [{ lineAnchor: '1#abc', replacement: 'new' }],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        return err instanceof ToolError && err.message.includes('melebihi batas maksimum 5242880 bytes');
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: input validator rejects batch exceeding MAX_EDITS_PER_BATCH and large replacement', () => {
  const tool = createHashlineEditTool('C:\\fake-workspace');

  // Over batch limit (101 edits)
  const tooManyEdits = Array.from({ length: MAX_EDITS_PER_BATCH + 1 }, (_, i) => ({
    lineAnchor: `${i + 1}#abc`,
    replacement: 'line',
  }));
  const val1 = tool.inputValidator?.({ filePath: 'app.ts', edits: tooManyEdits });
  assert.equal(val1?.valid, false);
  assert.ok(val1?.error?.includes(`melebihi batas maksimum ${MAX_EDITS_PER_BATCH}`));

  // Over replacement size limit (>64 KB)
  const giantReplacement = 'a'.repeat(MAX_REPLACEMENT_BYTES + 10);
  const val2 = tool.inputValidator?.({
    filePath: 'app.ts',
    edits: [{ lineAnchor: '1#abc', replacement: giantReplacement }],
  });
  assert.equal(val2?.valid, false);
  assert.ok(val2?.error?.includes(`melebihi batas maksimum ${MAX_REPLACEMENT_BYTES}`));
});

test('hashline_edit: preserves CRLF vs LF newlines accurately', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const crlfFile = join(tempDir, 'crlf.txt');
    await writeFile(crlfFile, 'line1\r\nline2\r\nline3', 'utf-8');

    const hash2 = computeLineHash('line2', 3);
    const tool = createHashlineEditTool(tempDir);

    await tool.execute(
      {
        filePath: 'crlf.txt',
        edits: [{ lineAnchor: `2#${hash2}`, replacement: 'modified2' }],
      },
      { actor: { id: 'test-user', role: 'user' } },
    );

    const updatedCrlf = await readFile(crlfFile, 'utf-8');
    assert.equal(updatedCrlf, 'line1\r\nmodified2\r\nline3');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: handles multi-byte Unicode and Japanese characters deterministically', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const unicodeFile = join(tempDir, 'unicode.txt');
    const line1 = 'const greeting = "こんにちは世界 🚀";';
    const line2 = 'const status = "aktif";';
    await writeFile(unicodeFile, `${line1}\n${line2}\n`, 'utf-8');

    const hash1 = computeLineHash(line1, 4);
    const tool = createHashlineEditTool(tempDir);

    const result = await tool.execute(
      {
        filePath: 'unicode.txt',
        edits: [
          {
            lineAnchor: `1#${hash1}`,
            replacement: 'const greeting = "Selamat Datang di Dunia AI 🌏✨";',
          },
        ],
      },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.linesModified, 1);
    const updated = await readFile(unicodeFile, 'utf-8');
    assert.ok(updated.includes('Selamat Datang di Dunia AI 🌏✨'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: rejects binary files containing null bytes', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const binaryFile = join(tempDir, 'image.bin');
    // Buffer with null bytes
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]);
    await writeFile(binaryFile, buf);

    const tool = createHashlineEditTool(tempDir);
    await assert.rejects(
      async () =>
        tool.execute(
          {
            filePath: 'image.bin',
            edits: [{ lineAnchor: '1#abc', replacement: 'hacked' }],
          },
          { actor: { id: 'test-user', role: 'user' } },
        ),
      (err: unknown) => {
        return err instanceof ToolError && err.message.includes('terdeteksi sebagai file biner');
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('hashline_edit: integrates with ToolRegistry and PermissionEngine', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hashline-test-'));
  try {
    const filePath = join(tempDir, 'app.ts');
    await writeFile(filePath, 'console.log("start");\n', 'utf-8');

    const line1 = 'console.log("start");';
    const hash1 = computeLineHash(line1, 3);

    const engine = new PermissionEngine();
    const guard = new SecuredCapabilityGuard(engine);
    const registry = new ToolRegistry(guard);

    registry.registerTool(createHashlineEditTool(tempDir));

    const result = await registry.executeTool({
      toolName: 'hashline_edit',
      input: {
        filePath: 'app.ts',
        edits: [{ lineAnchor: `1#${hash1}`, replacement: 'console.log("ready");' }],
      },
      context: {
        actor: { id: 'developer-1', role: 'user' },
      },
    });

    assert.equal(result.status, 'success');
    const updated = await readFile(filePath, 'utf-8');
    assert.equal(updated.trim(), 'console.log("ready");');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
