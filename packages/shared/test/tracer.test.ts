import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSensitiveAttributes, TelemetryTracer } from '../src/observability/tracer.ts';

test('TelemetryTracer: W3C traceparent formatting and parsing', () => {
  const tracer = new TelemetryTracer();
  const traceId = tracer.generateTraceId();
  const spanId = tracer.generateSpanId();

  const traceparent = tracer.createTraceparent(traceId, spanId, true);
  assert.equal(traceparent, `00-${traceId}-${spanId}-01`);

  const parsed = tracer.parseTraceparent(traceparent);
  assert.ok(parsed);
  assert.equal(parsed.traceId, traceId);
  assert.equal(parsed.parentSpanId, spanId);
  assert.equal(parsed.isSampled, true);

  const unsampledTraceparent = tracer.createTraceparent(traceId, spanId, false);
  assert.equal(unsampledTraceparent, `00-${traceId}-${spanId}-00`);
  const parsedUnsampled = tracer.parseTraceparent(unsampledTraceparent);
  assert.ok(parsedUnsampled);
  assert.equal(parsedUnsampled.isSampled, false);
});

test('TelemetryTracer: redacts sensitive keys and values in span attributes', () => {
  const tracer = new TelemetryTracer();
  const span = tracer.startSpan('sensitive_op', 'http_request', {
    attributes: {
      password: 'mypassword',
      api_key: 'sk-1234567890abcdef1234567890',
      authorization: 'Bearer jwt.secret.token',
      normal_attribute: 'safe_value',
    },
  });

  assert.equal(span.attributes.password, '[REDACTED]');
  assert.equal(span.attributes.api_key, '[REDACTED]');
  assert.equal(span.attributes.authorization, '[REDACTED]');
  assert.equal(span.attributes.normal_attribute, 'safe_value');

  tracer.endSpan(span, {
    attributes: {
      refreshToken: 'refresh-secret-123',
    },
  });

  assert.equal(span.attributes.refreshToken, '[REDACTED]');
});

test('TelemetryTracer: low-sampling retention and Prometheus format export', () => {
  const tracer = new TelemetryTracer({ samplingRatio: 0.1 });

  for (let i = 0; i < 50; i++) {
    const s = tracer.startSpan(`test_${i}`, 'tool_call');
    tracer.endSpan(s, { status: 'ok' });
  }

  // Under low sampling (10%), retained spans should be much fewer than 50
  assert.ok(tracer.getSpans().length < 25);

  tracer.recordModelCall({
    modelId: 'openai/gpt-4o',
    provider: '9router',
    durationMs: 450,
    promptTokens: 120,
    completionTokens: 80,
    totalCostUsd: 0.005,
    retryCount: 0,
    status: 'success',
  });

  tracer.recordToolCall({
    toolName: 'web_search',
    durationMs: 310,
    status: 'success',
  });

  const promMetrics = tracer.toPrometheusFormat();
  assert.match(promMetrics, /personal_ai_os_model_calls_total/);
  assert.match(promMetrics, /personal_ai_os_tool_calls_total/);
  assert.match(promMetrics, /model="openai\/gpt-4o"/);
});
