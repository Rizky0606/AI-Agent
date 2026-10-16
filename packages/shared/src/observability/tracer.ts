import { randomBytes } from 'node:crypto';
import type {
  DeviceHealthMetric,
  ErrorMetric,
  EvaluatorMetric,
  ModelCallMetric,
  QueueLatencyMetric,
  SpanKind,
  TelemetrySpan,
  ToolCallMetric,
} from './types.ts';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /auth/i,
  /cookie/i,
  /credential/i,
  /api[_-]?key/i,
  /bearer/i,
  /jwt/i,
  /private[_-]?key/i,
];

export function redactSensitiveAttributes(
  attributes?: Record<string, string | number | boolean | undefined> | undefined,
): Record<string, string | number | boolean | undefined> {
  if (!attributes) return {};
  const result: Record<string, string | number | boolean | undefined> = {};
  for (const [key, val] of Object.entries(attributes)) {
    if (val === undefined) continue;
    const isKeySensitive = SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
    if (isKeySensitive) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'string') {
      let sanitized = val;
      if (sanitized.startsWith('Bearer ') || (sanitized.startsWith('ey') && sanitized.length > 30)) {
        sanitized = '[REDACTED]';
      } else if (/(sk-[a-zA-Z0-9_-]{20,}|nr-[a-zA-Z0-9_-]{20,})/.test(sanitized)) {
        sanitized = sanitized.replace(/(sk-[a-zA-Z0-9_-]{20,}|nr-[a-zA-Z0-9_-]{20,})/g, '[REDACTED_KEY]');
      }
      result[key] = sanitized;
    } else {
      result[key] = val;
    }
  }
  return result;
}

export class TelemetryTracer {
  private readonly spans: TelemetrySpan[] = [];
  private readonly modelMetrics: ModelCallMetric[] = [];
  private readonly toolMetrics: ToolCallMetric[] = [];
  private readonly queueMetrics: QueueLatencyMetric[] = [];
  private readonly evaluatorMetrics: EvaluatorMetric[] = [];
  private readonly deviceMetrics = new Map<string, DeviceHealthMetric>();
  private readonly errorMetrics: ErrorMetric[] = [];
  private readonly maxStoredSpans: number;
  private readonly samplingRatio: number;

  constructor(options?: {
    maxStoredSpans?: number | undefined;
    samplingRatio?: number | undefined;
  }) {
    this.maxStoredSpans = options?.maxStoredSpans ?? 1000;
    const envRatio = process.env.OTEL_SAMPLING_RATIO ? Number(process.env.OTEL_SAMPLING_RATIO) : undefined;
    this.samplingRatio = options?.samplingRatio ?? (typeof envRatio === 'number' && !isNaN(envRatio) ? envRatio : 0.1);
  }

  generateTraceId(): string {
    return randomBytes(16).toString('hex');
  }

  generateSpanId(): string {
    return randomBytes(8).toString('hex');
  }

  createTraceparent(traceId: string, spanId: string, sampled = true): string {
    const flags = sampled ? '01' : '00';
    return `00-${traceId}-${spanId}-${flags}`;
  }

  parseTraceparent(
    header?: string | undefined,
  ): { traceId: string; parentSpanId: string; isSampled: boolean } | undefined {
    if (!header) return undefined;
    const parts = header.split('-');
    if (parts.length >= 4 && parts[1]?.length === 32 && parts[2]?.length === 16) {
      return {
        traceId: parts[1],
        parentSpanId: parts[2],
        isSampled: parts[3] === '01',
      };
    }
    return undefined;
  }

  shouldSample(traceId: string, isError = false): boolean {
    if (isError || this.samplingRatio >= 1.0) return true;
    if (this.samplingRatio <= 0) return false;
    // Deterministic hash based on the first 8 hex characters of traceId
    const hexPrefix = traceId.slice(0, 8);
    const num = parseInt(hexPrefix, 16);
    return !isNaN(num) && (num % 100) < this.samplingRatio * 100;
  }

  startSpan(
    name: string,
    kind: SpanKind,
    options?: {
      traceId?: string | undefined;
      parentSpanId?: string | undefined;
      attributes?: Record<string, string | number | boolean | undefined> | undefined;
    },
  ): TelemetrySpan {
    const traceId = options?.traceId ?? this.generateTraceId();
    const spanId = this.generateSpanId();

    const span: TelemetrySpan = {
      traceId,
      spanId,
      parentSpanId: options?.parentSpanId,
      name,
      kind,
      startTime: Date.now(),
      status: 'ok',
      attributes: redactSensitiveAttributes(options?.attributes),
      events: [],
    };

    return span;
  }

  endSpan(
    span: TelemetrySpan,
    options?: {
      status?: 'ok' | 'error' | undefined;
      errorMessage?: string | undefined;
      attributes?: Record<string, string | number | boolean | undefined> | undefined;
    },
  ): TelemetrySpan {
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    if (options?.status) span.status = options.status;
    if (options?.errorMessage) {
      span.status = 'error';
      span.errorMessage = options.errorMessage;
    }
    if (options?.attributes) {
      Object.assign(span.attributes, redactSensitiveAttributes(options.attributes));
    }

    const isError = span.status === 'error';
    if (isError || this.shouldSample(span.traceId)) {
      this.spans.push(span);
      if (this.spans.length > this.maxStoredSpans) {
        this.spans.shift();
      }
    }

    return span;
  }

  recordModelCall(metric: ModelCallMetric): void {
    this.modelMetrics.push(metric);
  }

  recordToolCall(metric: ToolCallMetric): void {
    this.toolMetrics.push(metric);
  }

  recordQueueLatency(metric: QueueLatencyMetric): void {
    this.queueMetrics.push(metric);
  }

  recordEvaluatorRun(metric: EvaluatorMetric): void {
    this.evaluatorMetrics.push(metric);
  }

  recordDeviceHealth(metric: DeviceHealthMetric): void {
    this.deviceMetrics.set(metric.deviceId, metric);
  }

  recordError(metric: ErrorMetric): void {
    this.errorMetrics.push(metric);
  }

  getSpans(filter?: { traceId?: string; taskId?: string }): TelemetrySpan[] {
    return this.spans.filter((s) => {
      if (filter?.traceId && s.traceId !== filter.traceId) return false;
      if (filter?.taskId && s.attributes['task.id'] !== filter.taskId) return false;
      return true;
    });
  }

  getMetricsSummary(): {
    totalSpans: number;
    modelCallsCount: number;
    totalTokens: number;
    totalCostUsd: number;
    toolCallsCount: number;
    evaluatorRunsCount: number;
    activeDevicesCount: number;
    totalErrorsCount: number;
  } {
    const totalTokens = this.modelMetrics.reduce(
      (sum, m) => sum + m.promptTokens + m.completionTokens,
      0,
    );
    const totalCostUsd = this.modelMetrics.reduce((sum, m) => sum + m.totalCostUsd, 0);
    const activeDevicesCount = Array.from(this.deviceMetrics.values()).filter(
      (d) => d.isOnline,
    ).length;

    return {
      totalSpans: this.spans.length,
      modelCallsCount: this.modelMetrics.length,
      totalTokens,
      totalCostUsd,
      toolCallsCount: this.toolMetrics.length,
      evaluatorRunsCount: this.evaluatorMetrics.length,
      activeDevicesCount,
      totalErrorsCount: this.errorMetrics.length,
    };
  }

  toPrometheusFormat(): string {
    const lines: string[] = [
      '# HELP personal_ai_os_model_calls_total Total number of model inference calls',
      '# TYPE personal_ai_os_model_calls_total counter',
    ];

    const modelStatusCounts = new Map<string, number>();
    for (const m of this.modelMetrics) {
      const key = `model="${m.modelId}",status="${m.status}"`;
      modelStatusCounts.set(key, (modelStatusCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of modelStatusCounts) {
      lines.push(`personal_ai_os_model_calls_total{${key}} ${count}`);
    }

    lines.push(
      '# HELP personal_ai_os_tool_calls_total Total number of tool invocations',
      '# TYPE personal_ai_os_tool_calls_total counter',
    );
    const toolCounts = new Map<string, number>();
    for (const t of this.toolMetrics) {
      const key = `tool="${t.toolName}",status="${t.status}"`;
      toolCounts.set(key, (toolCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of toolCounts) {
      lines.push(`personal_ai_os_tool_calls_total{${key}} ${count}`);
    }

    lines.push(
      '# HELP personal_ai_os_devices_online Number of currently online connected client devices',
      '# TYPE personal_ai_os_devices_online gauge',
    );
    const onlineCount = Array.from(this.deviceMetrics.values()).filter((d) => d.isOnline).length;
    lines.push(`personal_ai_os_devices_online ${onlineCount}`);

    lines.push(
      '# HELP personal_ai_os_errors_total Total system error events',
      '# TYPE personal_ai_os_errors_total counter',
    );
    lines.push(`personal_ai_os_errors_total ${this.errorMetrics.length}`);

    return lines.join('\n') + '\n';
  }

  clear(): void {
    this.spans.length = 0;
    this.modelMetrics.length = 0;
    this.toolMetrics.length = 0;
    this.queueMetrics.length = 0;
    this.evaluatorMetrics.length = 0;
    this.deviceMetrics.clear();
    this.errorMetrics.length = 0;
  }
}

// Global default tracer instance for easy access across packages
export const defaultTracer = new TelemetryTracer();
