import { IntentAnalyzer } from './intent-analyzer.ts';
import { Planner } from './planner.ts';
import type { RuntimeManager } from '../runtimes/runtime-manager.ts';
import type { AgentRoute, IntentAnalysisResult, RouterContext, TaskPlan } from '../types.ts';

export interface RouteResolution {
  analysis: IntentAnalysisResult;
  plan: TaskPlan;
  route: AgentRoute;
}

export class AgentRouter {
  private readonly analyzer: IntentAnalyzer;
  private readonly planner: Planner;
  private readonly runtimeManager?: RuntimeManager | undefined;

  constructor(
    analyzer?: IntentAnalyzer | undefined,
    planner?: Planner | undefined,
    runtimeManager?: RuntimeManager | undefined,
  ) {
    this.analyzer = analyzer ?? new IntentAnalyzer();
    this.planner = planner ?? new Planner();
    this.runtimeManager = runtimeManager;
  }

  route(prompt: string, context: RouterContext): RouteResolution {
    const analysis = this.analyzer.analyze(prompt);
    const plan = this.planner.createPlan(analysis, prompt);

    let modelId = 'glm-4-flash';
    let requiresWindowsAgent = false;
    let requiresSandbox = false;
    let maxAttempts = 3;
    let reason = analysis.reasoning;
    let selectedRuntimeId: string | undefined = undefined;

    switch (analysis.intent) {
      case 'simple_chat':
        modelId = context.modelPreferences?.fastModel ?? 'glm-4-flash';
        maxAttempts = 1;
        break;

      case 'coding':
        modelId = context.modelPreferences?.codingModel ?? 'claude-3-7-sonnet';
        maxAttempts = 3;
        selectedRuntimeId = context.preferredRuntimeId ?? 'omp';
        break;

      case 'research':
        modelId = context.modelPreferences?.researchModel ?? 'gemini-2.5-pro';
        maxAttempts = 3;
        break;

      case 'windows_local':
        requiresWindowsAgent = true;
        modelId = context.modelPreferences?.fastModel ?? 'glm-4-flash';
        if (context.isWindowsOnline === false) {
          reason = `${reason} PERINGATAN: Perangkat Windows pengguna terdeteksi OFFLINE.`;
        }
        break;

      case 'heavy_untrusted':
        requiresSandbox = true;
        modelId = context.modelPreferences?.codingModel ?? 'claude-3-7-sonnet';
        if (context.isSandboxAvailable === false) {
          reason = `${reason} PERINGATAN: Lingkungan sandbox isolasi belum tersedia pada host saat ini.`;
        }
        break;
    }

    const route: AgentRoute = {
      intent: analysis.intent,
      runtime: analysis.recommendedRuntime,
      modelId,
      requiresWindowsAgent,
      requiresSandbox,
      maxAttempts,
      reason,
      selectedRuntimeId,
    };

    return {
      analysis,
      plan,
      route,
    };
  }

  /**
   * Evaluates runtime health via RuntimeManager and automatically applies
   * fallback if the primary runtime is unhealthy.
   */
  async routeWithHealth(prompt: string, context: RouterContext): Promise<RouteResolution> {
    const resolution = this.route(prompt, context);
    const { route, analysis } = resolution;

    if (!this.runtimeManager || analysis.intent !== 'coding') {
      return resolution;
    }

    const primaryRuntimeId = context.preferredRuntimeId ?? 'omp';
    const primaryHealth = await this.runtimeManager.healthCheck(primaryRuntimeId);

    if (primaryHealth.healthy) {
      route.selectedRuntimeId = primaryRuntimeId;
      return resolution;
    }

    // Primary runtime is unhealthy! Look for a fallback with capability 'coding'
    const availableCodingRuntimes = this.runtimeManager
      .findRuntimesForCapability('coding')
      .filter((r) => r.id !== primaryRuntimeId);

    let chosenFallbackId: string | undefined = undefined;

    for (const candidate of availableCodingRuntimes) {
      const candidateHealth = await this.runtimeManager.healthCheck(candidate.id);
      if (candidateHealth.healthy) {
        chosenFallbackId = candidate.id;
        break;
      }
    }

    route.originalRuntimeId = primaryRuntimeId;
    route.fallbackUsed = true;

    if (chosenFallbackId) {
      route.selectedRuntimeId = chosenFallbackId;
      route.fallbackReason = `Primary runtime "${primaryRuntimeId}" is unhealthy (${primaryHealth.error ?? 'check failed'}). Fallback to "${chosenFallbackId}".`;
      route.reason = `${route.reason} [FALLBACK: ${route.fallbackReason}]`;
    } else {
      route.selectedRuntimeId = undefined;
      route.fallbackReason = `Primary runtime "${primaryRuntimeId}" and all fallback runtimes are unhealthy.`;
      route.reason = `${route.reason} [WARNING: Tidak ada runtime sehat yang tersedia untuk capability coding.]`;
    }

    return resolution;
  }
}
