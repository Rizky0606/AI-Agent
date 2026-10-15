/**
 * Optional manual live smoke test for 9Router.
 *
 * Usage:
 *   $env:NINEROUTER_API_KEY = 'your-key-here'
 *   $env:NINEROUTER_TEST_MODEL = 'openai/gpt-4o-mini' # optional
 *   node --experimental-strip-types scripts/smoke-live-9router.ts
 */

import { NineRouterGateway } from '../packages/model-gateway/src/index.ts';

const apiKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;
const baseUrl = process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1';
const testModel = process.env.NINEROUTER_TEST_MODEL ?? 'openai/gpt-4o-mini';

async function main() {
  console.log('=== 9Router Live Smoke Test ===');
  console.log(`Endpoint: ${baseUrl}`);

  if (!apiKey) {
    console.log('[SKIPPED] NINEROUTER_API_KEY is not set. Live smoke test was skipped.');
    console.log('To run this test manually, provide NINEROUTER_API_KEY in the environment.');
    process.exit(0);
  }

  console.log('[INFO] API Key detected. Initializing NineRouterGateway...');
  const gateway = new NineRouterGateway({
    baseUrl,
    apiKey,
    timeoutMs: 15_000,
    maxRetries: 1,
  });

  console.log('[1/3] Testing listModels()...');
  try {
    const models = await gateway.listModels();
    console.log(`[OK] Retrieved ${models.length} model(s).`);
    if (models.length > 0) {
      console.log(
        `Sample models: ${models
          .slice(0, 3)
          .map((m) => m.model)
          .join(', ')}`,
      );
    }
  } catch (err) {
    console.error(
      `[FAIL] listModels() failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(`[2/3] Testing single chat() with model "${testModel}"...`);
  try {
    const chatResponse = await gateway.chat({
      model: testModel,
      messages: [{ role: 'user', content: 'Say "hello world" in 3 words or less.' }],
    });
    console.log(
      `[OK] Chat response received (${chatResponse.content.trim()}). Tokens: ${chatResponse.usage?.totalTokens ?? 'N/A'}`,
    );
  } catch (err) {
    console.error(`[FAIL] chat() failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`[3/3] Testing stream() with model "${testModel}"...`);
  try {
    let chunksCount = 0;
    process.stdout.write('[STREAM OUTPUT]: ');
    for await (const chunk of gateway.stream({
      model: testModel,
      messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
    })) {
      if (chunk.delta) {
        chunksCount++;
        process.stdout.write(chunk.delta);
      }
    }
    console.log(`\n[OK] Stream finished. Received ${chunksCount} chunk(s).`);
  } catch (err) {
    console.error(`\n[FAIL] stream() failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`[4/4] Testing capability probe with model "${testModel}"...`);
  try {
    const probeResult = await gateway.probeModel(testModel);
    console.log(`[OK] Capability probe completed for "${testModel}":`);
    console.log(`  - Verified capabilities: [${probeResult.capabilities.join(', ')}]`);
    console.log(`  - Availability: ${probeResult.availabilityStatus}`);
    console.log(`  - Average latency: ${probeResult.latencyMs ?? 'N/A'} ms`);
    for (const [cap, detail] of Object.entries(probeResult.capabilityDetails)) {
      console.log(`  - ${cap}: status=${detail.status}${detail.latencyMs ? ` (${detail.latencyMs}ms)` : ''}${detail.error ? ` [error: ${detail.error}]` : ''}`);
    }
  } catch (err) {
    console.error(`[FAIL] probeModel() failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('=== Smoke test completed ===');
}

main().catch((err) => {
  console.error('Fatal error in smoke test:', err);
  process.exit(1);
});
