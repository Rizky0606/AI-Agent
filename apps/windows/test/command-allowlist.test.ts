import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { AgentConnection } from '../src/connection/agent-connection.ts';
import { DeviceIdentityManager } from '../src/connection/device-identity.ts';
import { CapabilityRegistry } from '../src/security/capability-registry.ts';
import { PathValidator } from '../src/security/path-validator.ts';
import { CommandExecutor } from '../src/security/command-executor.ts';
import {
  assertCommandAllowed,
  CommandNotAllowedError,
  DEFAULT_ALLOWED_COMMANDS,
} from '../src/security/command-allowlist.ts';

const defaultAllowlist: string[] = [...DEFAULT_ALLOWED_COMMANDS];

/** Runs the gate and hands back the typed rejection, or fails the test if it let the command run. */
const captureRejection = (
  command: string,
  allowed: readonly string[] = defaultAllowlist,
): CommandNotAllowedError => {
  try {
    assertCommandAllowed(command, allowed);
  } catch (err) {
    assert.ok(err instanceof CommandNotAllowedError, `${command} threw ${String(err)}`);
    return err;
  }
  throw new assert.AssertionError({ message: `expected "${command}" to be rejected` });
};

const expectRejection = (
  command: string,
  reason: string,
  allowed: readonly string[] = defaultAllowlist,
): void => {
  const error = captureRejection(command, allowed);
  assert.equal(error.code, 'COMMAND_NOT_ALLOWED');
  assert.equal(error.reason, reason);
  assert.ok(
    error.message.includes(reason),
    `${command} should name ${reason}, got: ${error.message}`,
  );
};

test('Command allowlist: allowlisted binaries pass', () => {
  // `hostname` is what the M4 device-dispatch smoke dispatches; the rest are the programs this
  // package's own tests exercise.
  for (const command of [
    'hostname',
    '  hostname  ',
    'dir',
    'Get-Date',
    'Write-Output "Hello from Windows Agent"',
    'Start-Sleep -Seconds 5',
    '1..50 | ForEach-Object { "Line number $_ output text" }',
  ]) {
    assert.doesNotThrow(() => assertCommandAllowed(command, defaultAllowlist), command);
  }
});

test('Command allowlist: disallowed binary is rejected and named', () => {
  const error = captureRejection('Remove-Item -Recurse C:\\');
  assert.equal(error.code, 'COMMAND_NOT_ALLOWED');
  assert.equal(error.token, 'Remove-Item');
  assert.equal(error.reason, 'COMMAND_NOT_ALLOWED');
  assert.ok(error.message.includes('Remove-Item'));
});

test('Command allowlist: empty command is rejected', () => {
  expectRejection('   ', 'EMPTY_COMMAND');
});

test('Command allowlist: chained commands are rejected segment by segment', () => {
  expectRejection('hostname; Remove-Item -Recurse C:\\', 'COMMAND_NOT_ALLOWED');
  expectRejection('hostname && Remove-Item -Recurse C:\\', 'COMMAND_NOT_ALLOWED');
  expectRejection('hostname || Remove-Item -Recurse C:\\', 'COMMAND_NOT_ALLOWED');
  expectRejection('hostname | Remove-Item -Recurse C:\\', 'COMMAND_NOT_ALLOWED');
  expectRejection('hostname\nRemove-Item -Recurse C:\\', 'COMMAND_NOT_ALLOWED');
  // The first segment being dangerous is caught too, not just the second.
  expectRejection('Remove-Item C:\\ ; hostname', 'COMMAND_NOT_ALLOWED');
});

test('Command allowlist: subshells and the call operator are rejected', () => {
  expectRejection('$(hostname)', 'SUBSHELL');
  expectRejection('Write-Output (hostname)', 'SUBSHELL');
  expectRejection('hostname `; Remove-Item C:\\`', 'SUBSHELL');
  expectRejection('& hostname', 'CALL_OPERATOR');
  expectRejection('hostname & Remove-Item C:\\', 'CALL_OPERATOR');
});

test('Command allowlist: -EncodedCommand is rejected, however it is abbreviated', () => {
  expectRejection('powershell -EncodedCommand aABpAA==', 'ENCODED_COMMAND');
  expectRejection('hostname -enc aABpAA==', 'ENCODED_COMMAND');
  expectRejection('hostname -encodedc aABpAA==', 'ENCODED_COMMAND');
  // `-ea` is `-ErrorAction`, not an abbreviation of `-EncodedCommand`, so it must not be flagged.
  assert.doesNotThrow(() => assertCommandAllowed('Get-Date -ea SilentlyContinue', defaultAllowlist));
});

test('Command allowlist: Invoke-Expression and iex are rejected', () => {
  expectRejection("Invoke-Expression 'hostname'", 'DYNAMIC_EXECUTION');
  expectRejection("iex 'hostname'", 'DYNAMIC_EXECUTION');
  expectRejection('IEX (Get-Date)', 'SUBSHELL');
});

test('Command allowlist: cmd /c and other shells are rejected even when allowlisted', () => {
  expectRejection('cmd /c hostname', 'SHELL_WRAPPER');
  expectRejection('cmd.exe /c hostname', 'SHELL_WRAPPER');
  expectRejection('powershell.exe -Command hostname', 'SHELL_WRAPPER');
  expectRejection('pwsh -Command hostname', 'SHELL_WRAPPER');
  expectRejection('wsl hostname', 'SHELL_WRAPPER');
  // Listing a shell in the local allowlist must not make it usable.
  expectRejection('cmd /c hostname', 'SHELL_WRAPPER', ['cmd', 'hostname']);
});

test('Command allowlist: executable paths are rejected, bare names are not', () => {
  expectRejection('C:\\Windows\\System32\\evil.exe', 'PATH_QUALIFIED_COMMAND');
  expectRejection('C:/Windows/System32/evil.exe', 'PATH_QUALIFIED_COMMAND');
  expectRejection('.\\evil.exe', 'PATH_QUALIFIED_COMMAND');
  expectRejection('..\\evil.exe', 'PATH_QUALIFIED_COMMAND');
  expectRejection('\\\\attacker\\share\\evil.exe', 'PATH_QUALIFIED_COMMAND');
  expectRejection('hostname; .\\evil.exe', 'PATH_QUALIFIED_COMMAND');
  assert.doesNotThrow(() => assertCommandAllowed('hostname', defaultAllowlist));
});

test('Command allowlist: allowlist is configurable through the capability registry', () => {
  const registry = new CapabilityRegistry();
  // The built-in default keeps the supported workflows working.
  assert.deepEqual(registry.getAllowedCommands('powershell'), defaultAllowlist);

  registry.setGranularRule('powershell', { allowedCommands: ['hostname'] });
  assert.deepEqual(registry.getAllowedCommands('powershell'), ['hostname']);
  assert.doesNotThrow(() =>
    assertCommandAllowed('hostname', registry.getAllowedCommands('powershell')),
  );
  expectRejection('dir', 'COMMAND_NOT_ALLOWED', registry.getAllowedCommands('powershell'));

  // Emptying it denies every command rather than allowing everything.
  registry.setGranularRule('powershell', { allowedCommands: [] });
  expectRejection('hostname', 'COMMAND_NOT_ALLOWED', registry.getAllowedCommands('powershell'));

  // A capability with no command allowlist at all denies everything.
  assert.deepEqual(registry.getAllowedCommands('git'), []);
  expectRejection('hostname', 'COMMAND_NOT_ALLOWED', registry.getAllowedCommands('git'));

  // Capability names are case-insensitive, as PowerShell is.
  registry.setGranularRule('powershell', { allowedCommands: ['HOSTNAME'] });
  assert.doesNotThrow(() => assertCommandAllowed('hostname', registry.getAllowedCommands('powershell')));

  registry.resetToDefaults();
  assert.deepEqual(registry.getAllowedCommands('powershell'), defaultAllowlist);
});

test('CommandExecutor: disallowed command is rejected before spawning', async () => {
  const registry = new CapabilityRegistry();
  registry.setCapability('powershell', true);
  const executor = new CommandExecutor(registry, new PathValidator([process.cwd()]));

  await assert.rejects(
    async () => {
      await executor.executePowershell('Remove-Item -Recurse C:\\', { cwd: process.cwd() });
    },
    (err: unknown) => {
      assert.ok(err instanceof CommandNotAllowedError);
      assert.equal(err.code, 'COMMAND_NOT_ALLOWED');
      assert.equal(err.token, 'Remove-Item');
      return true;
    },
  );
  assert.equal(executor.getActiveExecutionCount(), 0, 'nothing was spawned');
});

test('CommandExecutor: allowlisted command clears the gate and reaches spawn', async () => {
  const registry = new CapabilityRegistry();
  registry.setCapability('powershell', true);
  const executor = new CommandExecutor(registry, new PathValidator([process.cwd()]));

  if (process.platform === 'win32') {
    const result = await executor.executePowershell('hostname', { cwd: process.cwd() });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.trim().length > 0);
    return;
  }

  // Off Windows there is no powershell.exe, so the only thing this proves is that the allowlist
  // gate let the command through: the failure is the spawn, not the policy.
  await assert.rejects(
    async () => {
      await executor.executePowershell('hostname', { cwd: process.cwd() });
    },
    (err: unknown) => {
      assert.ok(!(err instanceof CommandNotAllowedError), `gate rejected: ${String(err)}`);
      return true;
    },
  );
});

/** Minimal WSS stand-in: enough to drive one inbound `command.execute` frame. */
class MockAgentWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockAgentWebSocket.CONNECTING;
  readonly sentMessages: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    queueMicrotask(() => {
      this.readyState = MockAgentWebSocket.OPEN;
      this.emit('open');
      this.onopen?.();
    });
  }

  private readonly sendWaiters: Array<{
    matches: (frame: Record<string, unknown>) => boolean;
    resolve: (frame: Record<string, unknown>) => void;
  }> = [];

  /** Resolves with the next frame matching `matches`, so tests await real sends, not timers. */
  waitForSend(
    matches: (frame: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    this.sendWaiters.push({ matches, resolve });
    return promise;
  }

  send(data: string): void {
    this.sentMessages.push(data);
    const frame = JSON.parse(data) as Record<string, unknown>;
    const index = this.sendWaiters.findIndex((waiter) => waiter.matches(frame));
    if (index === -1) return;
    const [waiter] = this.sendWaiters.splice(index, 1);
    waiter?.resolve(frame);
  }

  close(): void {
    this.readyState = MockAgentWebSocket.CLOSED;
    this.emit('close');
    this.onclose?.();
  }

  simulateServerMessage(msg: Record<string, unknown>): void {
    const event = { data: JSON.stringify(msg) };
    this.emit('message', event);
    this.onmessage?.(event);
  }
}

test('AgentConnection: a dispatched command cannot widen the allowlist from the wire', async () => {
  const originalWs = globalThis.WebSocket;
  const createdSockets: MockAgentWebSocket[] = [];
  globalThis.WebSocket = class extends MockAgentWebSocket {
    constructor(url: string) {
      super(url);
      createdSockets.push(this);
    }
  } as unknown as typeof WebSocket;

  try {
    const identityMgr = new DeviceIdentityManager({ name: 'Test Windows Machine' });
    const registry = new CapabilityRegistry();
    registry.setCapability('powershell', true);
    const executor = new CommandExecutor(registry, new PathValidator([process.cwd()]));
    const connection = new AgentConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'jwt-auth-token-123',
      identity: identityMgr.getIdentity(),
      keyStore: identityMgr.keys,
      executor,
    });

    await connection.connect();
    const mockWs = createdSockets[0];
    assert.ok(mockWs);

    const handshake = mockWs.waitForSend((frame) => frame['type'] === 'device.handshake');
    mockWs.simulateServerMessage({ type: 'device.challenge', challenge: 'nonce-01' });
    await handshake;

    // The frame carries an allowlist field the server has no business setting.
    const result = mockWs.waitForSend((frame) => frame['type'] === 'command.result');
    mockWs.simulateServerMessage({
      type: 'command.execute',
      commandId: 'cmd-1',
      command: 'Remove-Item -Recurse C:\\',
      cwd: process.cwd(),
      allowedCommands: ['Remove-Item'],
    });

    const frame = await result;
    assert.equal(frame['success'], false);
    assert.deepEqual(frame['error'], {
      code: 'COMMAND_NOT_ALLOWED',
      message: 'Command rejected (COMMAND_NOT_ALLOWED): "Remove-Item" is not on the local command allowlist.',
    });
    assert.deepEqual(registry.getAllowedCommands('powershell'), defaultAllowlist);
    connection.disconnect();
  } finally {
    globalThis.WebSocket = originalWs;
  }
});
