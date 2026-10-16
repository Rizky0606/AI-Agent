import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTracer, redactSensitiveAttributes, TelemetryTracer } from '@personal-ai-os/shared';
import Fastify from 'fastify';

test('Tracing: Redaksi data sensitif melindungi token, kata sandi, dan API key', () => {
  const sensitiveAttributes = {
    'http.url': '/v1/auth/login',
    'user.email': 'alice@example.com',
    'req.headers.authorization': 'Bearer secret-jwt-token-string-xyz',
    'user.password': 'MySuperSecretPassword123!',
    'api_key': 'sk-testapikey999888777666555444333',
    'random_token': 'eyJhYmMxMjMiLCJkZWYiOjQ1Nn0.tokenpart2.signature',
    'safe.attribute': 'normal-value',
  };

  const redacted = redactSensitiveAttributes(sensitiveAttributes);

  assert.equal(redacted['safe.attribute'], 'normal-value');
  assert.equal(redacted['http.url'], '/v1/auth/login');
  assert.equal(redacted['user.email'], 'alice@example.com');
  assert.equal(redacted['req.headers.authorization'], '[REDACTED]');
  assert.equal(redacted['user.password'], '[REDACTED]');
  assert.equal(redacted['api_key'], '[REDACTED]');
  assert.equal(redacted['random_token'], '[REDACTED]');
});

test('Tracing: Low-sampling hemat sumber daya & 100% error retention guarantee', () => {
  // Setup tracer dengan sampling 10%
  const tracer = new TelemetryTracer({ samplingRatio: 0.1 });

  // Buat 100 span sukses dengan traceId acak
  for (let i = 0; i < 100; i++) {
    const span = tracer.startSpan(`operation_${i}`, 'tool_call');
    tracer.endSpan(span, { status: 'ok' });
  }

  const storedSuccessSpans = tracer.getSpans();
  // Dengan rasio 10%, span sukses yang disimpan harus berada di kisaran ~10% (tidak pernah 100)
  assert.ok(storedSuccessSpans.length < 30, `Expected low sampling count (<30), got ${storedSuccessSpans.length}`);

  // Buat span error: wajib disimpan 100%
  tracer.clear();
  for (let i = 0; i < 5; i++) {
    const errorSpan = tracer.startSpan(`failing_operation_${i}`, 'task_execution');
    tracer.endSpan(errorSpan, { status: 'error', errorMessage: 'Database connection failed' });
  }

  const storedErrorSpans = tracer.getSpans();
  assert.equal(storedErrorSpans.length, 5, 'Semua error span wajib disimpan (100% sampling on error)');
});

test('Tracing: Fastify propagasi W3C traceparent dan security headers', async () => {
  const app = Fastify();

  // Pasang hook seperti di app.ts
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    const traceparentHeader =
      typeof request.headers['traceparent'] === 'string' ? request.headers['traceparent'] : undefined;
    const parsedTrace = defaultTracer.parseTraceparent(traceparentHeader);
    const traceId = parsedTrace?.traceId ?? defaultTracer.generateTraceId();
    const parentSpanId = parsedTrace?.parentSpanId;
    const isSampled = defaultTracer.shouldSample(traceId);

    const span = defaultTracer.startSpan(`${request.method} ${request.url}`, 'http_request', {
      traceId,
      parentSpanId,
    });
    (request as unknown as { span: typeof span }).span = span;

    const outgoingTraceparent = defaultTracer.createTraceparent(traceId, span.spanId, isSampled);
    reply.header('x-trace-id', traceId);
    reply.header('traceparent', outgoingTraceparent);
  });

  app.get('/test-trace', async () => ({ status: 'traced' }));

  const incomingTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const res = await app.inject({
    method: 'GET',
    url: '/test-trace',
    headers: {
      traceparent: incomingTraceparent,
    },
  });

  assert.equal(res.statusCode, 200);
  // Verifikasi trace-id diekstrak dari header W3C
  assert.equal(res.headers['x-trace-id'], '4bf92f3577b34da6a3ce929d0e0e4736');

  // Verifikasi outgoing traceparent mewarisi trace-id yang sama
  const outgoingTraceparent = String(res.headers['traceparent']);
  assert.ok(outgoingTraceparent.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));

  // Verifikasi security headers
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(String(res.headers['strict-transport-security']), /max-age=31536000/);

  await app.close();
});
