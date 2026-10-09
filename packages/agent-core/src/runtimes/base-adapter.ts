import type { PermissionEngine, PermissionRequest } from '@personal-ai-os/permissions';
import type {
  AgentRuntime,
  RuntimeCapability,
  RuntimeExecuteInput,
  RuntimeExecuteResult,
  RuntimeHealth,
  RuntimeProposedAction,
  RuntimeStatus,
} from './types.ts';

export abstract class BaseAgentRuntime implements AgentRuntime {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly capabilities: readonly RuntimeCapability[];

  protected status: RuntimeStatus = 'uninitialized';
  protected pausedTasks = new Set<string>();
  protected cancelledTasks = new Set<string>();
  protected permissionEngine?: PermissionEngine | undefined;

  constructor(permissionEngine?: PermissionEngine | undefined) {
    this.permissionEngine = permissionEngine;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  async initialize(): Promise<void> {
    this.status = 'idle';
  }

  abstract execute(input: RuntimeExecuteInput): Promise<RuntimeExecuteResult>;

  async pause(taskId: string): Promise<void> {
    this.pausedTasks.add(taskId);
    if (this.status === 'running') {
      this.status = 'paused';
    }
  }

  async resume(taskId: string): Promise<void> {
    this.pausedTasks.delete(taskId);
    if (this.status === 'paused') {
      this.status = 'idle';
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId);
  }

  abstract healthCheck(): Promise<RuntimeHealth>;

  /**
   * Evaluates proposed actions against PermissionEngine.
   * Runtime output is ALWAYS treated as UNTRUSTED.
   * HIGH/CRITICAL or unapproved actions cannot be automatically applied.
   */
  protected async filterUntrustedActions(
    actions: RuntimeProposedAction[],
    userId = 'system',
  ): Promise<
    Array<{
      action: RuntimeProposedAction;
      permissionGranted: boolean;
      executed: boolean;
      result?: unknown | undefined;
    }>
  > {
    const results: Array<{
      action: RuntimeProposedAction;
      permissionGranted: boolean;
      executed: boolean;
      result?: unknown | undefined;
    }> = [];

    for (const action of actions) {
      if (!this.permissionEngine) {
        // If no permission engine configured, deny untrusted actions by default
        results.push({
          action,
          permissionGranted: false,
          executed: false,
          result: 'No PermissionEngine configured; untrusted action blocked by default',
        });
        continue;
      }

      const req: PermissionRequest = {
        actor: { id: userId, isAutomated: true, role: 'system' },
        action: action.action,
        resource: action.resource,
        scope: `runtime:${this.id}`,
        context: {
          type: action.type,
          payload: action.payload,
          riskLevel: action.riskLevel,
        },
      };

      const evalResult = await this.permissionEngine.evaluate(req);
      if (evalResult.decision === 'allow') {
        results.push({
          action,
          permissionGranted: true,
          executed: true,
          result: 'Action permitted by policy',
        });
      } else {
        results.push({
          action,
          permissionGranted: false,
          executed: false,
          result: `Action blocked or requires approval: ${evalResult.reason} (decision: ${evalResult.decision}, risk: ${evalResult.riskLevel})`,
        });
      }
    }

    return results;
  }
}
