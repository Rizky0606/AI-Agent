import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  createLspDiagnosticsTool,
  inferLanguageFromFilePath,
  parseDiagnosticLine,
  ToolError,
  ToolRegistry,
  type LspDiagnosticsOutput,
  type SupportedLspLanguage,
} from '../src/index.ts';

test('inferLanguageFromFilePath maps known extensions accurately', () => {
  assert.equal(inferLanguageFromFilePath('src/main.ts'), 'typescript');
  assert.equal(inferLanguageFromFilePath('components/App.tsx'), 'typescript');
  assert.equal(inferLanguageFromFilePath('lib/index.js'), 'javascript');
  assert.equal(inferLanguageFromFilePath('scripts/run.py'), 'python');
  assert.equal(inferLanguageFromFilePath('src/main.rs'), 'rust');
  assert.equal(inferLanguageFromFilePath('cmd/server/main.go'), 'go');
  assert.equal(inferLanguageFromFilePath('doc.md'), null);
  assert.equal(inferLanguageFromFilePath('styles.css'), null);
});

test('parseDiagnosticLine extracts line, column, severity, and message', () => {
  const line1 = 'src/app.ts:14:5: error: Cannot find name "foo".';
  const item1 = parseDiagnosticLine(line1);
  assert.ok(item1);
  assert.equal(item1.line, 14);
  assert.equal(item1.column, 5);
  assert.equal(item1.severity, 'error');
  assert.ok(item1.message.includes('Cannot find name "foo"'));

  const line2 = 'main.py:22:1: warning: Unused import "os"';
  const item2 = parseDiagnosticLine(line2);
  assert.ok(item2);
  assert.equal(item2.line, 22);
  assert.equal(item2.column, 1);
  assert.equal(item2.severity, 'warning');

  assert.equal(parseDiagnosticLine('Just random log line with no position'), null);
});

test('lsp_diagnostics: returns unconfigured when language server is not installed on host (never claims passed)', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'sample.ts');
    await writeFile(filePath, 'const x: number = "broken";\n', 'utf-8');

    // Using a resolver that returns null (simulating absent language server on host)
    const tool = createLspDiagnosticsTool(tempDir, {
      serverResolver: async () => null,
    });

    const result = await tool.execute(
      { filePath: 'sample.ts' },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.serverStatus, 'unconfigured');
    assert.equal(result.language, 'typescript');
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 0);
    assert.ok(result.message?.includes('tidak dikonfigurasi atau tidak ditemukan'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: returns unconfigured for unsupported or unmapped file extension', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'data.xml');
    await writeFile(filePath, '<root></root>\n', 'utf-8');

    const tool = createLspDiagnosticsTool(tempDir);
    const result = await tool.execute(
      { filePath: 'data.xml' },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.serverStatus, 'unconfigured');
    assert.equal(result.language, 'unknown');
    assert.ok(result.message?.includes('tidak didukung'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: returns structured diagnostics when server is configured', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'app.ts');
    await writeFile(filePath, 'const a: number = "hello";\nconst b = 12;\n', 'utf-8');

    const tool = createLspDiagnosticsTool(tempDir, {
      serverResolver: async () => 'mock-tsserver',
      lspRunner: async () => ({
        diagnostics: [
          {
            line: 1,
            column: 7,
            severity: 'error',
            message: "Type 'string' is not assignable to type 'number'.",
            source: 'typescript',
          },
          {
            line: 2,
            column: 7,
            severity: 'warning',
            message: "'b' is declared but its value is never read.",
            source: 'typescript',
          },
        ],
        rawOutput: 'Found 1 error, 1 warning',
      }),
    });

    const result = await tool.execute(
      { filePath: 'app.ts' },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.serverStatus, 'configured');
    assert.equal(result.language, 'typescript');
    assert.equal(result.serverBinary, 'mock-tsserver');
    assert.equal(result.errorCount, 1);
    assert.equal(result.warningCount, 1);
    assert.equal(result.diagnostics.length, 2);
    assert.equal(result.diagnostics[0]?.severity, 'error');
    assert.equal(result.diagnostics[1]?.severity, 'warning');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: handles process timeout/cancellation without hanging worker', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'hang.py');
    await writeFile(filePath, 'import time\n', 'utf-8');

    const tool = createLspDiagnosticsTool(tempDir, {
      serverResolver: async () => 'pyright',
      lspRunner: async ({ signal }) => {
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        // Simulate cancellation / timeout
        const err = new Error('Eksekusi dibatalkan');
        Object.assign(err, { killed: true });
        throw err;
      },
    });

    const abortController = new AbortController();
    abortController.abort();

    const result = await tool.execute(
      { filePath: 'hang.py' },
      { actor: { id: 'test-user', role: 'user' }, signal: abortController.signal },
    );

    assert.equal(result.serverStatus, 'error');
    assert.equal(result.errorCount, 1);
    assert.ok(result.message?.includes('dibatalkan atau melampaui timeout'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: handles process crash without hanging worker', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'crash.rs');
    await writeFile(filePath, 'fn main() {}\n', 'utf-8');

    const tool = createLspDiagnosticsTool(tempDir, {
      serverResolver: async () => 'rust-analyzer',
      lspRunner: async () => {
        const crashErr = new Error('Process terminated with signal SIGSEGV');
        Object.assign(crashErr, { code: 'SIGSEGV', stderr: 'panic in rust-analyzer' });
        throw crashErr;
      },
    });

    const result = await tool.execute(
      { filePath: 'crash.rs' },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.serverStatus, 'error');
    assert.equal(result.errorCount, 1);
    assert.ok(result.message?.includes('rust-analyzer'));
    assert.ok(result.rawOutput?.includes('panic in rust-analyzer'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: handles malformed output safely', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'test.go');
    await writeFile(filePath, 'package main\n', 'utf-8');

    const tool = createLspDiagnosticsTool(tempDir, {
      serverResolver: async () => 'gopls',
      lspRunner: async () => ({
        diagnostics: [],
        rawOutput: '{{{ unparseable binary gibberish \x00\x01\x02',
      }),
    });

    const result = await tool.execute(
      { filePath: 'test.go' },
      { actor: { id: 'test-user', role: 'user' } },
    );

    assert.equal(result.serverStatus, 'configured');
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 0);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: rejects path traversal outside workspace', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const tool = createLspDiagnosticsTool(tempDir);

    await assert.rejects(
      async () =>
        tool.execute(
          { filePath: '../outside.ts' },
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

test('lsp_diagnostics: rejects sensitive and credential files', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const tool = createLspDiagnosticsTool(tempDir);
    const files = ['.env', '.env.local', 'secret_key.pem', 'id_rsa', 'app_credential.json'];

    for (const f of files) {
      await assert.rejects(
        async () =>
          tool.execute(
            { filePath: f },
            { actor: { id: 'test-user', role: 'user' } },
          ),
        (err: unknown) => {
          return err instanceof ToolError && err.message.includes('Akses diagnostik ke file sensitif/kredensial');
        },
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('lsp_diagnostics: inputValidator rejects languages not in allowlist', () => {
  const tool = createLspDiagnosticsTool('C:\\workspace');

  const val1 = tool.inputValidator?.({ filePath: 'main.ts', language: 'typescript' });
  assert.equal(val1?.valid, true);

  const val2 = tool.inputValidator?.({
    filePath: 'main.ts',
    language: 'cobol' as unknown as SupportedLspLanguage,
  });
  assert.equal(val2?.valid, false);
  assert.ok(val2?.error?.includes('Bahasa yang didukung'));
});

test('lsp_diagnostics: integrates with ToolRegistry and PermissionEngine', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'lsp-test-'));
  try {
    const filePath = join(tempDir, 'main.ts');
    await writeFile(filePath, 'console.log("hello");\n', 'utf-8');

    const engine = new PermissionEngine();
    const guard = new SecuredCapabilityGuard(engine);
    const registry = new ToolRegistry(guard);

    registry.registerTool(
      createLspDiagnosticsTool(tempDir, {
        serverResolver: async () => 'mock-lsp',
        lspRunner: async () => ({ diagnostics: [], rawOutput: 'ok' }),
      }),
    );

    const result = await registry.executeTool<unknown, LspDiagnosticsOutput>({
      toolName: 'lsp_diagnostics',
      input: { filePath: 'main.ts' },
      context: {
        actor: { id: 'dev-1', role: 'user' },
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.data?.serverStatus, 'configured');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
