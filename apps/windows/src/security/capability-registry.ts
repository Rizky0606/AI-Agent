import { SecurityError } from './path-validator.ts';
import { DEFAULT_ALLOWED_COMMANDS } from './command-allowlist.ts';

export type CapabilityName =
  'filesystem' | 'powershell' | 'git' | 'browser' | 'screenshot' | 'vscode' | 'docker';

export interface CapabilityRule {
  enabled: boolean;
  description: string;
  requiresExplicitOptIn: boolean;
  allowedActions?: string[] | undefined;
  allowedResources?: string[] | undefined;
  /** Programs this capability may invoke. Absent or empty means "no command text at all". */
  allowedCommands?: string[] | undefined;
}

export class CapabilityDisabledError extends SecurityError {
  readonly capability: CapabilityName;

  constructor(capability: CapabilityName, message?: string) {
    super(
      'CAPABILITY_DISABLED',
      message ??
        `Capability "${capability}" is disabled by local policy (Default is OFF). Enable it in Windows Agent settings to use.`,
    );
    this.name = 'CapabilityDisabledError';
    this.capability = capability;
  }
}

export class CapabilityRegistry {
  private rules: Map<CapabilityName, CapabilityRule> = new Map();

  constructor() {
    this.initDefaultRules();
  }

  private initDefaultRules(): void {
    // CRITICAL REQUIREMENT: Default OFF for all capabilities!
    this.rules.set('filesystem', {
      enabled: false,
      description: 'Filesystem read/write/list operations within path allowlist',
      requiresExplicitOptIn: false,
      allowedActions: ['read', 'write', 'list', 'delete', 'stat'],
    });

    this.rules.set('powershell', {
      enabled: false,
      description: 'Execute PowerShell terminal commands within allowlist',
      requiresExplicitOptIn: false,
      allowedActions: ['exec', 'script'],
      allowedCommands: [...DEFAULT_ALLOWED_COMMANDS],
    });

    this.rules.set('git', {
      enabled: false,
      description: 'Perform Git repository operations',
      requiresExplicitOptIn: false,
      allowedActions: ['status', 'log', 'diff', 'commit', 'branch', 'checkout'],
    });

    this.rules.set('browser', {
      enabled: false,
      description: 'Launch and control local browser instance',
      requiresExplicitOptIn: false,
      allowedActions: ['launch', 'navigate', 'click', 'screenshot'],
    });

    this.rules.set('screenshot', {
      enabled: false,
      description: 'Capture screenshot of the Windows desktop screen',
      requiresExplicitOptIn: false,
      allowedActions: ['capture'],
    });

    this.rules.set('vscode', {
      enabled: false,
      description: 'VS Code editor and extension control (requires explicit opt-in)',
      requiresExplicitOptIn: true,
      allowedActions: ['open', 'diff', 'command'],
    });

    this.rules.set('docker', {
      enabled: false,
      description: 'Local Docker container operations (requires explicit opt-in)',
      requiresExplicitOptIn: true,
      allowedActions: ['ps', 'logs', 'exec', 'start', 'stop'],
    });
  }

  isEnabled(name: CapabilityName): boolean {
    return this.rules.get(name)?.enabled ?? false;
  }

  setCapability(name: CapabilityName, enabled: boolean): void {
    const existing = this.rules.get(name);
    if (!existing) {
      throw new SecurityError('UNKNOWN_CAPABILITY', `Unknown capability "${name}"`);
    }
    existing.enabled = enabled;
  }

  setGranularRule(
    name: CapabilityName,
    options: {
      enabled?: boolean | undefined;
      allowedActions?: string[] | undefined;
      allowedResources?: string[] | undefined;
      allowedCommands?: string[] | undefined;
    },
  ): void {
    const rule = this.rules.get(name);
    if (!rule) {
      throw new SecurityError('UNKNOWN_CAPABILITY', `Unknown capability "${name}"`);
    }
    if (options.enabled !== undefined) rule.enabled = options.enabled;
    if (options.allowedActions !== undefined) rule.allowedActions = options.allowedActions;
    if (options.allowedResources !== undefined) rule.allowedResources = options.allowedResources;
    if (options.allowedCommands !== undefined) rule.allowedCommands = options.allowedCommands;
  }

  /**
   * Programs `name` may invoke, read from the same local rules the capability flags live in. The
   * server only ever receives these rules in the handshake; nothing inbound can widen them.
   */
  getAllowedCommands(name: CapabilityName): string[] {
    return [...(this.rules.get(name)?.allowedCommands ?? [])];
  }

  assertCapabilityAllowed(name: CapabilityName, action?: string, resource?: string): void {
    const rule = this.rules.get(name);
    if (!rule || !rule.enabled) {
      throw new CapabilityDisabledError(name);
    }

    if (action && rule.allowedActions && rule.allowedActions.length > 0) {
      if (!rule.allowedActions.includes(action)) {
        throw new SecurityError(
          'ACTION_NOT_PERMITTED',
          `Action "${action}" is not allowed for capability "${name}". Allowed actions: [${rule.allowedActions.join(', ')}]`,
        );
      }
    }

    if (resource && rule.allowedResources && rule.allowedResources.length > 0) {
      const allowed = rule.allowedResources.some(
        (res) => resource === res || resource.startsWith(res),
      );
      if (!allowed) {
        throw new SecurityError(
          'RESOURCE_NOT_PERMITTED',
          `Resource "${resource}" is not allowed for capability "${name}".`,
        );
      }
    }
  }

  getAllRules(): Record<CapabilityName, CapabilityRule> {
    const obj = {} as Record<CapabilityName, CapabilityRule>;
    for (const [key, val] of this.rules.entries()) {
      obj[key] = { ...val };
    }
    return obj;
  }

  resetToDefaults(): void {
    this.initDefaultRules();
  }
}
