/**
 * Non-production capability probe for a 9Router-compatible OpenAI API.
 *
 * Usage (Node 22+):
 *   $env:NINEROUTER_API_KEY = '...'
 *   node --experimental-strip-types scripts/verify-9router.ts
 *
 * Set NINEROUTER_TEST_MODEL and NINEROUTER_ALLOW_BILLABLE_PROBES=true to run
 * inference probes (streaming, tool calling, vision, and usage metadata).
 * The script deliberately does not select a model or make billable requests by
 * default. It never prints the API key or authorization header.
 */

type Probe = {
  status: 'available' | 'unavailable' | 'skipped' | 'inconclusive';
  detail: string;
  httpStatus?: number;
  headers?: Record<string, string>;
  evidence?: Record<string, unknown>;
};

const baseUrl = (process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1').replace(
  /\/$/,
  '',
);
const apiKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;
const model = process.env.NINEROUTER_TEST_MODEL;
const allowBillable = process.env.NINEROUTER_ALLOW_BILLABLE_PROBES === 'true';
const timeoutMs = Number(process.env.NINEROUTER_PROBE_TIMEOUT_MS ?? '30000');

const rateLimitHeaderNames = [
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
];

function headersOf(response: Response): Record<string, string> {
  return Object.fromEntries(
    rateLimitHeaderNames
      .map((name) => [name, response.headers.get(name)] as const)
      .filter(([, value]) => value !== null),
  );
}

function authHeaders(): HeadersInit {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...init.headers },
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeBody(text: string): Record<string, unknown> {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    return {
      topLevelKeys: Object.keys(body),
      modelCount: Array.isArray(body.data) ? body.data.length : undefined,
      modelFields:
        Array.isArray(body.data) && body.data[0] && typeof body.data[0] === 'object'
          ? Object.keys(body.data[0] as Record<string, unknown>)
          : undefined,
      usage: body.usage,
      cost: body.cost ?? body.costs ?? body.pricing,
      error: body.error,
    };
  } catch {
    return { bodyPreview: text.slice(0, 300) };
  }
}

function skipped(detail: string): Probe {
  return { status: 'skipped', detail };
}

async function modelsProbe(): Promise<Probe> {
  if (!apiKey)
    return skipped(
      'NINEROUTER_API_KEY/NINE_ROUTER_API_KEY is not set; authentication and model listing were not attempted.',
    );
  try {
    const { response, text } = await request('/models');
    const evidence = summarizeBody(text);
    return {
      status: response.ok ? 'available' : 'unavailable',
      detail: response.ok
        ? 'Authenticated GET /models succeeded.'
        : 'Authenticated GET /models failed.',
      httpStatus: response.status,
      headers: headersOf(response),
      evidence,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: `GET /models could not complete: ${error instanceof Error ? error.name : 'unknown error'}`,
    };
  }
}

function billablePrerequisite(feature: string): Probe | undefined {
  if (!apiKey) return skipped(`${feature} was not attempted: API key is absent.`);
  if (!allowBillable)
    return skipped(
      `${feature} was not attempted: set NINEROUTER_ALLOW_BILLABLE_PROBES=true to permit billable inference probes.`,
    );
  if (!model)
    return skipped(
      `${feature} was not attempted: set NINEROUTER_TEST_MODEL explicitly; the script will not choose a model.`,
    );
  return undefined;
}

async function chatProbe(name: string, body: Record<string, unknown>): Promise<Probe> {
  const prerequisite = billablePrerequisite(name);
  if (prerequisite) return prerequisite;
  try {
    const { response, text } = await request('/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, ...body }),
    });
    const evidence = summarizeBody(text);
    return {
      status: response.ok ? 'available' : 'unavailable',
      detail: response.ok
        ? `${name} request completed.`
        : `${name} request was rejected or failed.`,
      httpStatus: response.status,
      headers: headersOf(response),
      evidence,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: `${name} could not complete: ${error instanceof Error ? error.name : 'unknown error'}`,
    };
  }
}

async function streamingProbe(): Promise<Probe> {
  const prerequisite = billablePrerequisite('Streaming');
  if (prerequisite) return prerequisite;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const first = reader ? await reader.read() : undefined;
    await reader?.cancel();
    clearTimeout(timeout);
    const firstChunk = first?.value ? new TextDecoder().decode(first.value).slice(0, 300) : '';
    return {
      status: response.ok && firstChunk.length > 0 ? 'available' : 'unavailable',
      detail:
        response.ok && firstChunk.length > 0
          ? 'Received a non-empty streamed response chunk.'
          : 'No streamed response chunk was received.',
      httpStatus: response.status,
      headers: { ...headersOf(response), contentType: response.headers.get('content-type') ?? '' },
      evidence: { firstChunkPreview: firstChunk },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: `Streaming could not complete: ${error instanceof Error ? error.name : 'unknown error'}`,
    };
  }
}

async function connectivityProbe(): Promise<Probe> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: 'available',
      detail:
        'TCP/TLS/HTTP connectivity to GET /models succeeded; this does not establish authorization.',
      httpStatus: response.status,
      headers: headersOf(response),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: `Connectivity request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
    };
  }
}

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WAAAAABJRU5ErkJggg==';

const report = {
  generatedAt: new Date().toISOString(),
  endpoint: baseUrl,
  configuration: {
    apiKeyPresent: Boolean(apiKey),
    testModel: model ?? null,
    billableProbesAllowed: allowBillable,
    timeoutMs,
  },
  probes: {
    connectivity: await connectivityProbe(),
    authenticationAndModelList: await modelsProbe(),
    streaming: await streamingProbe(),
    toolCalling: await chatProbe('Tool calling', {
      messages: [{ role: 'user', content: 'What is 2 + 2? Use the calculator tool.' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Adds two numbers.',
            parameters: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: 'required',
    }),
    vision: await chatProbe('Vision', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What are the dimensions of this image?' },
            { type: 'image_url', image_url: { url: tinyPng } },
          ],
        },
      ],
      max_tokens: 32,
    }),
    usageAndCostMetadata: await chatProbe('Usage and cost metadata', {
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 8,
    }),
  },
  contextWindow: {
    status: 'inconclusive',
    detail:
      'Inspect model-list evidence for fields such as context_length or context_window. This script intentionally does not submit an oversized prompt because that can be costly and provider-specific.',
  } satisfies Probe,
  rateLimits: {
    status: 'inconclusive',
    detail:
      'Rate-limit headers from every completed HTTP probe are recorded above. No load test is run because it could impact a shared service.',
  } satisfies Probe,
};

console.log(JSON.stringify(report, null, 2));
