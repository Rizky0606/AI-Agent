import assert from 'node:assert/strict';
import test from 'node:test';
import { MockModelGateway } from '../src/mock-gateway.ts';
import { probeCatalog } from '../src/prober.ts';

test('probeCatalog accurately marks probed vs unknown capabilities', async () => {
  const gateway = new MockModelGateway({
    models: [
      {
        provider: '9router',
        model: 'model-chat-only',
        capabilities: ['chat'],
        contextWindow: 4096,
      },
      {
        provider: '9router',
        model: 'model-multimodal',
        capabilities: ['chat', 'streaming', 'tool_calling', 'vision'],
        contextWindow: 128_000,
      },
    ],
  });

  const results = await probeCatalog(gateway, ['model-chat-only', 'model-multimodal'], {
    concurrency: 2,
    delayMs: 10,
  });

  // Model 1: Chat only
  const res1 = results.get('model-chat-only');
  assert.ok(res1);
  assert.deepEqual(res1.capabilities, ['chat']);
  assert.equal(res1.capabilityDetails.chat.status, 'probed');
  assert.equal(res1.capabilityDetails.streaming.status, 'unknown');
  assert.equal(res1.capabilityDetails.tool_calling.status, 'unknown');
  assert.equal(res1.capabilityDetails.vision.status, 'unknown');

  // Model 2: Multimodal
  const res2 = results.get('model-multimodal');
  assert.ok(res2);
  assert.deepEqual(res2.capabilities, ['chat', 'streaming', 'tool_calling', 'vision']);
  assert.equal(res2.capabilityDetails.chat.status, 'probed');
  assert.equal(res2.capabilityDetails.streaming.status, 'probed');
  assert.equal(res2.capabilityDetails.tool_calling.status, 'probed');
  assert.equal(res2.capabilityDetails.vision.status, 'probed');
});

test('probeCatalog handles errors gracefully and keeps unproven capabilities unknown', async () => {
  const failingGateway = {
    chat: async () => {
      throw new Error('Not implemented');
    },
    stream: async function* () {},
    listModels: async () => [],
    probeModel: async (model: string) => {
      throw new Error(`Probe connection error on ${model}`);
    },
  };

  const results = await probeCatalog(failingGateway, ['failed-model'], { concurrency: 1 });
  const failed = results.get('failed-model');
  assert.ok(failed);
  assert.equal(failed.availabilityStatus, 'unavailable');
  assert.equal(failed.capabilityDetails.streaming.status, 'unknown');
  assert.equal(failed.capabilityDetails.tool_calling.status, 'unknown');
  assert.equal(failed.capabilityDetails.vision.status, 'unknown');
  assert.match(failed.capabilityDetails.streaming.error ?? '', /Probe connection error/);
});
