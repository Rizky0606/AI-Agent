import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityRegistry } from '../src/security/capability-registry.ts';
import { PathValidator, SecurityError } from '../src/security/path-validator.ts';
import { CommandExecutor } from '../src/security/command-executor.ts';

test('CommandExecutor: Capability OFF is rejected before spawning', async () => {
  const registry = new CapabilityRegistry();
  const validator = new PathValidator([process.cwd()]);
  const executor = new CommandExecutor(registry, validator);

  // powershell is default OFF
  await assert.rejects(
    async () => {
      await executor.executePowershell('Write-Output "test"', { cwd: process.cwd() });
    },
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, 'CAPABILITY_DISABLED');
      return true;
    },
  );
});

test('CommandExecutor: Directory outside allowlist is rejected', async () => {
  const registry = new CapabilityRegistry();
  registry.setCapability('powershell', true);
  const validator = new PathValidator(['C:\\AllowedProjectRoot']);
  const executor = new CommandExecutor(registry, validator);

  await assert.rejects(
    async () => {
      await executor.executePowershell('Get-Date', { cwd: 'C:\\Windows\\System32' });
    },
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, 'PATH_OUTSIDE_ALLOWLIST');
      return true;
    },
  );
});

const isWindows = process.platform === 'win32';
const skipReason = !isWindows ? 'PowerShell execution test requires Windows environment' : false;

test(
  'CommandExecutor: Runs permitted command and captures output',
  { skip: skipReason },
  async () => {
    const registry = new CapabilityRegistry();
    registry.setCapability('powershell', true);
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    const result = await executor.executePowershell('Write-Output "Hello from Windows Agent"', {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Hello from Windows Agent'));
    assert.equal(result.truncated, false);
    assert.ok(result.durationMs >= 0);
    assert.equal(result.killedByTimeout, false);
    assert.equal(result.killedByAbort, false);
  },
);

test(
  'CommandExecutor: AbortSignal cancels running command immediately',
  { skip: skipReason },
  async () => {
    const registry = new CapabilityRegistry();
    registry.setCapability('powershell', true);
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    const abortController = new AbortController();

    const promise = executor.executePowershell('Start-Sleep -Seconds 10; Write-Output "done"', {
      cwd: process.cwd(),
      timeoutMs: 30_000,
      signal: abortController.signal,
    });

    // Cancel after 150ms
    setTimeout(() => {
      abortController.abort();
    }, 150);

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof SecurityError);
      assert.equal(err.code, 'EXECUTION_ABORTED');
      return true;
    });
  },
);

test(
  'CommandExecutor: Enforces timeout and terminates process exceeding limit',
  { skip: skipReason },
  async () => {
    const registry = new CapabilityRegistry();
    registry.setCapability('powershell', true);
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    // Set tight timeout of 1000ms, while script attempts to sleep 5s
    await assert.rejects(
      async () => {
        await executor.executePowershell('Start-Sleep -Seconds 5; Write-Output "finished"', {
          cwd: process.cwd(),
          timeoutMs: 1_000,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof SecurityError);
        assert.equal(err.code, 'EXECUTION_TIMEOUT');
        return true;
      },
    );
  },
);

test(
  'CommandExecutor: Output buffer cap truncates output safely',
  { skip: skipReason },
  async () => {
    const registry = new CapabilityRegistry();
    registry.setCapability('powershell', true);
    const validator = new PathValidator([process.cwd()]);
    const executor = new CommandExecutor(registry, validator);

    // Generate 500 lines of output with a small maxOutputBytes limit of 256 bytes
    const result = await executor.executePowershell(
      '1..50 | ForEach-Object { "Line number $_ output text" }',
      {
        cwd: process.cwd(),
        maxOutputBytes: 256,
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 256);
  },
);
