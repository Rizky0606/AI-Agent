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
    const mode = context.mode ?? 'auto';
    const intent =
      mode === 'fast' ? 'simple_chat' : mode === 'coding' ? 'coding' : mode === 'research' ? 'research' : analysis.intent;

    let modelId = 'glm-4-flash';
    let requiresWindowsAgent = false;
    let requiresSandbox = false;
    let maxAttempts = 3;
    let reason = analysis.reasoning;
    let selectedRuntimeId: string | undefined = undefined;

    switch (intent) {
      case 'simple_chat':
        modelId = context.modelPreferences?.fastModel ?? 'glm-4-flash';
        maxAttempts = 1;
        break;

      case 'coding':
        modelId = context.modelPreferences?.codingModel ?? 'claude-3-7-sonnet';
        maxAttempts = 3;
        break;

      case 'automation':
        modelId = context.modelPreferences?.fastModel ?? 'glm-4-flash';
        maxAttempts = 3;
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

    // Policy-based runtime selection with manual override support
    const preferred = context.preferredRuntimeId;
    if (preferred === 'omp' || preferred === 'hermes' || preferred === 'native') {
      selectedRuntimeId = preferred;
    } else {
      // Auto: coding -> omp; automation/skill -> hermes; chat/research -> native
      if (intent === 'coding') {
        selectedRuntimeId = 'omp';
      } else if (intent === 'automation') {
        selectedRuntimeId = 'hermes';
      } else {
        selectedRuntimeId = 'native';
      }
    }

    const route: AgentRoute = {
      intent,
      mode,
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
   * explicit fallback if the primary runtime is unhealthy.
   */
  async routeWithHealth(prompt: string, context: RouterContext): Promise<RouteResolution> {
    const resolution = this.route(prompt, context);
    const { route } = resolution;

    if (!this.runtimeManager || !route.selectedRuntimeId || route.selectedRuntimeId === 'native') {
      return resolution;
    }

    const primaryRuntimeId = route.selectedRuntimeId;
    const primaryHealth = await this.runtimeManager.healthCheck(primaryRuntimeId);

    if (primaryHealth.healthy) {
      return resolution;
    }

    // Primary runtime is unhealthy! Look for an explicit fallback runtime
    const preferredCandidateId = primaryRuntimeId === 'omp' ? 'hermes' : 'omp';
    const allRuntimes = this.runtimeManager.getAllRuntimes();
    const candidateIds = [
      preferredCandidateId,
      ...allRuntimes.map((r) => r.id).filter((id) => id !== primaryRuntimeId && id !== preferredCandidateId),
    ];

    let chosenFallbackId = 'native';

    for (const candId of candidateIds) {
      const candidateRuntime = this.runtimeManager.getRuntime(candId);
      if (candidateRuntime) {
        const candidateHealth = await this.runtimeManager.healthCheck(candId);
        if (candidateHealth.healthy) {
          chosenFallbackId = candId;
          break;
        }
      }
    }

    route.originalRuntimeId = primaryRuntimeId;
    route.fallbackUsed = true;
    route.selectedRuntimeId = chosenFallbackId;
    route.fallbackReason = `Runtime utama "${primaryRuntimeId}" tidak sehat (${primaryHealth.error ?? 'pemeriksaan gagal'}). Dialihkan secara eksplisit ke "${chosenFallbackId}". (Fallback to "${chosenFallbackId}")`;
    route.reason = `${route.reason} [FALLBACK: ${route.fallbackReason}]`;

    return resolution;
  }
}
