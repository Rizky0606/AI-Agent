import type { CheckpointAcceptanceCriterion } from '@personal-ai-os/shared';
import type { EvaluationResult } from '@personal-ai-os/evaluator';

export interface GenericTaskInput {
  taskId: string;
  userId: string;
  projectId: string;
  goal: string;
  acceptanceCriteria?: CheckpointAcceptanceCriterion[] | undefined;
  model?: string | undefined;
  maxSteps?: number | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
}

export type GenericStopReason =
  | 'goal_achieved'
  | 'max_steps_exceeded'
  | 'timeout'
  | 'approval_denied'
  | 'evaluator_rejected'
  | 'error';

export interface GenericExecutionTelemetry {
  stepCount: number;
  totalTokens: number;
  durationMs: number;
  stepDurationsMs: number[];
  toolsUsed: string[];
  stopReason: GenericStopReason;
  fallbackUsed: boolean;
}

export interface GenericExecutionReport {
  status: 'completed' | 'failed';
  summary: string;
  finalContent: string;
  artifacts: Array<{ id: string; type: string; title: string; content: string }>;
  evaluationResult?: EvaluationResult | undefined;
  telemetry: GenericExecutionTelemetry;
  error?: string | undefined;
  stopReason: GenericStopReason;
}
