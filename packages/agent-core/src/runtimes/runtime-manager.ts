import type { AgentRuntime, RuntimeHealth } from './types.ts';

export class RuntimeManager {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly cachedHealth = new Map<string, RuntimeHealth>();

  register(runtime: AgentRuntime): void {
    if (this.runtimes.has(runtime.id)) {
      throw new Error(`Runtime with id "${runtime.id}" is already registered.`);
    }
    this.runtimes.set(runtime.id, runtime);
  }

  unregister(runtimeId: string): boolean {
    this.cachedHealth.delete(runtimeId);
    return this.runtimes.delete(runtimeId);
  }

  getRuntime(runtimeId: string): AgentRuntime | undefined {
    return this.runtimes.get(runtimeId);
  }

  getAllRuntimes(): AgentRuntime[] {
    return Array.from(this.runtimes.values());
  }

  async initializeAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      if (runtime.getStatus() === 'uninitialized') {
        await runtime.initialize();
      }
    }
  }

  findRuntimesForCapability(capabilityName: string): AgentRuntime[] {
    return Array.from(this.runtimes.values()).filter((rt) =>
      rt.capabilities.some((cap) => cap.name === capabilityName),
    );
  }

  async getHealthyRuntimeForCapability(capabilityName: string): Promise<AgentRuntime | undefined> {
    const candidates = this.findRuntimesForCapability(capabilityName);
    for (const runtime of candidates) {
      const health = await this.healthCheck(runtime.id);
      if (health.healthy) {
        return runtime;
      }
    }
    return undefined;
  }

  async healthCheck(runtimeId: string): Promise<RuntimeHealth> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      return {
        healthy: false,
        lastChecked: new Date().toISOString(),
        error: `Runtime "${runtimeId}" not found`,
      };
    }

    try {
      const health = await runtime.healthCheck();
      this.cachedHealth.set(runtimeId, health);
      return health;
    } catch (err) {
      const failedHealth: RuntimeHealth = {
        healthy: false,
        lastChecked: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
      this.cachedHealth.set(runtimeId, failedHealth);
      return failedHealth;
    }
  }

  async healthCheckAll(): Promise<Map<string, RuntimeHealth>> {
    const results = new Map<string, RuntimeHealth>();
    for (const [id] of this.runtimes) {
      results.set(id, await this.healthCheck(id));
    }
    return results;
  }

  async pauseTask(runtimeId: string, taskId: string): Promise<void> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      throw new Error(`Runtime "${runtimeId}" not found`);
    }
    await runtime.pause(taskId);
  }

  async resumeTask(runtimeId: string, taskId: string): Promise<void> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      throw new Error(`Runtime "${runtimeId}" not found`);
    }
    await runtime.resume(taskId);
  }

  async cancelTask(runtimeId: string, taskId: string): Promise<void> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      throw new Error(`Runtime "${runtimeId}" not found`);
    }
    await runtime.cancel(taskId);
  }
}
