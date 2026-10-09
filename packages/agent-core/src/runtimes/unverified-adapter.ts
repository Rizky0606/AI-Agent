import { BaseAgentRuntime } from './base-adapter.ts';
import type {
  RuntimeCapability,
  RuntimeExecuteInput,
  RuntimeExecuteResult,
  RuntimeHealth,
} from './types.ts';

export class UnverifiedRuntimeAdapter extends BaseAgentRuntime {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly RuntimeCapability[];
  readonly unverifiedReason: string;

  constructor(options: {
    id: string;
    name: string;
    version?: string | undefined;
    capabilities?: RuntimeCapability[] | undefined;
    unverifiedReason: string;
  }) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.version = options.version ?? 'unverified';
    this.capabilities = options.capabilities ?? [];
    this.unverifiedReason = options.unverifiedReason;
    this.status = 'error';
  }

  override async initialize(): Promise<void> {
    throw new Error(
      `Cannot initialize unverified runtime "${this.id}": ${this.unverifiedReason}. Refusing execution per Rule 6.`,
    );
  }

  async healthCheck(): Promise<RuntimeHealth> {
    return {
      healthy: false,
      lastChecked: new Date().toISOString(),
      error: `Runtime "${this.id}" is NOT verified/installed: ${this.unverifiedReason}`,
    };
  }

  async execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult> {
    return {
      taskId: input.taskId,
      status: 'failed',
      output: '',
      durationMs: 0,
      error: `Execution rejected: Runtime "${this.id}" is not verified or installed on host (${this.unverifiedReason}).`,
    };
  }
}

export class HermesRuntimeAdapter extends UnverifiedRuntimeAdapter {
  constructor() {
    super({
      id: 'hermes',
      name: 'Hermes Agent Runtime',
      unverifiedReason:
        'Tidak ada CLI/API/SDK lokal yang dapat diverifikasi pada assessment host (hanya plugin pi-hermes-memory terdeteksi)',
      capabilities: [
        { name: 'coding', level: 'write' },
        { name: 'terminal', level: 'execute' },
      ],
    });
  }
}

export class OpenHandsRuntimeAdapter extends UnverifiedRuntimeAdapter {
  constructor() {
    super({
      id: 'openhands',
      name: 'OpenHands Runtime',
      unverifiedReason:
        'Tidak ada CLI/API/SDK lokal yang dapat diverifikasi pada assessment host (oh di PowerShell adalah alias Out-Host, bukan OpenHands)',
      capabilities: [
        { name: 'coding', level: 'write' },
        { name: 'terminal', level: 'execute' },
      ],
    });
  }
}
