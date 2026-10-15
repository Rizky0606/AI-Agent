import type { ModelGateway, ModelToolDefinition } from '@personal-ai-os/model-gateway';
import type { ToolRegistry } from '@personal-ai-os/tools';
import { GenericEvaluator, type AcceptanceCriterion, type EvaluationResult } from '@personal-ai-os/evaluator';
import { onTopicGuardHandler } from '../skills/builtin/on-topic-guard.ts';
import { toolDefinitionToModelTool } from './tool-converter.ts';

export const DEFAULT_MAX_STEPS = 5;
export const HARD_MAX_STEPS = 10;
export const DEFAULT_MAX_TOKENS = 16384;
export const DEFAULT_TIMEOUT_MS = 60000;
export const HARD_MAX_TIMEOUT_MS = 120000;

export class GenericAgent {
  private readonly modelGateway?: ModelGateway | undefined;
  private readonly defaultModel?: string | undefined;
  private readonly evaluator: GenericEvaluator;

  constructor(options?: { modelGateway?: ModelGateway | undefined; defaultModel?: string | undefined }) {
    this.modelGateway = options?.modelGateway;
    this.defaultModel = options?.defaultModel;
    this.evaluator = new GenericEvaluator();
  }

  /**
   * Checks whether the target model supports verified tool_calling.
   * If unproven or unknown, returns false so caller can fall back honestly.
   */
  async verifyToolCallingCapability(model: string): Promise<boolean> {
    if (!this.modelGateway) return false;

    try {
      const models = await this.modelGateway.listModels();
      const descriptor = models.find((m) => m.model === model);
      if (descriptor) {
        if (descriptor.capabilityDetails?.tool_calling?.status === 'probed') {
          return true;
        }
        if (descriptor.capabilities.includes('tool_calling')) {
          return true;
        }
      }

      // If prober is available and not yet verified in descriptor
      if (typeof this.modelGateway.probeModel === 'function') {
        const probeRes = await this.modelGateway.probeModel(model);
        return probeRes.capabilities.includes('tool_calling');
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Prepares available tool definitions from the registry for model tool calling.
   */
  getAvailableTools(registry?: ToolRegistry | undefined): ModelToolDefinition[] {
    if (!registry) return [];
    return registry.listTools().map((t) => toolDefinitionToModelTool(t));
  }

  /**
   * Evaluates completion using on-topic-guard and GenericEvaluator against criteria.
   */
  async evaluateCompletion(params: {
    goal: string;
    acceptanceCriteria: AcceptanceCriterion[];
    finalContent: string;
    artifacts: Array<{ id: string; type: string; title: string; content: string }>;
    toolOutputs: Record<string, unknown>;
    executionLogs: string[];
  }): Promise<{ passed: boolean; evaluationResult: EvaluationResult; deviationReason?: string | undefined }> {
    // 1. Run on-topic-guard to catch topical deviations or hallucinations
    const guardRes = await onTopicGuardHandler(
      {
        goal: params.goal,
        acceptanceCriteria: params.acceptanceCriteria.map((c) => c.description),
        proposedActionOrOutput: params.finalContent,
      },
      { userId: 'agent-generic' },
    );

    if (!guardRes.isOnTopic) {
      const remainingIssues = [
        ...params.acceptanceCriteria.map(
          (c) => `Kriteria '${c.description}' tidak terpenuhi: penyimpangan topik.`,
        ),
        guardRes.deviationReason ?? 'Luaran tidak selaras dengan tujuan tugas pengguna.',
      ];
      const blockedReason = `Evaluasi generik belum lulus: ${guardRes.deviationReason ?? 'penyimpangan topik'}.`;
      return {
        passed: false,
        deviationReason: guardRes.deviationReason ?? 'Penyimpangan topik terdeteksi oleh on-topic-guard.',
        evaluationResult: {
          passed: false,
          category: 'generic',
          score: guardRes.alignmentScore,
          confidence: 0.95,
          evaluatedCriteria: params.acceptanceCriteria.map((c) => ({
            criterionId: c.id,
            description: c.description,
            passed: false,
            reason: `Kriteria '${c.description}' tidak terpenuhi: ${guardRes.deviationReason}`,
          })),
          remainingIssues,
          selfClaimRejected: true,
          completionBlockedReason: blockedReason,
        },
      };
    }

    // 2. Run GenericEvaluator against concrete evidence
    const evaluationResult = this.evaluator.evaluate(params.acceptanceCriteria, {
      artifacts: params.artifacts,
      outputs: params.toolOutputs,
      logs: params.executionLogs,
      explanation: params.finalContent,
    });

    return {
      passed: evaluationResult.passed,
      evaluationResult,
    };
  }
}
