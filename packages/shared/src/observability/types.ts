export type SpanKind =
  | 'http_request'
  | 'model_call'
  | 'runtime_exec'
  | 'tool_call'
  | 'task_execution'
  | 'evaluator_evaluation'
  | 'queue_job'
  | 'device_heartbeat';

export interface TelemetryEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown> | undefined;
}

export interface TelemetrySpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number | undefined;
  durationMs?: number | undefined;
  status: 'ok' | 'error';
  errorMessage?: string | undefined;
  attributes: Record<string, string | number | boolean | undefined>;
  events: TelemetryEvent[];
}

export interface ModelCallMetric {
  modelId: string;
  provider: string;
  runtimeId?: string | undefined;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  retryCount: number;
  status: 'success' | 'failed' | 'rate_limited' | 'timeout';
  traceId?: string | undefined;
  taskId?: string | undefined;
}

export interface ToolCallMetric {
  toolName: string;
  durationMs: number;
  status: 'success' | 'failed' | 'permission_denied' | 'timeout';
  riskLevel?: string | undefined;
  traceId?: string | undefined;
  taskId?: string | undefined;
}

export interface QueueLatencyMetric {
  queueName: string;
  jobId: string;
  taskId?: string | undefined;
  enqueueTime: number;
  pickupTime: number;
  latencyMs: number;
}

export interface EvaluatorMetric {
  evaluatorType: 'coding' | 'research' | 'generic';
  passed: boolean;
  score: number;
  violationsCount: number;
  durationMs: number;
  taskId?: string | undefined;
  traceId?: string | undefined;
}

export interface DeviceHealthMetric {
  deviceId: string;
  platform: string;
  isOnline: boolean;
  lastPingTimestamp: number;
  unacknowledgedCommandsCount: number;
}

export interface ErrorMetric {
  service: string;
  errorType: string;
  message: string;
  stack?: string | undefined;
  traceId?: string | undefined;
  taskId?: string | undefined;
  timestamp: number;
}
