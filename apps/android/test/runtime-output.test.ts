import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeOutputPreviews } from '../src/runtime-output.ts';

test('runtime output preview selects only runtime artifacts and bounds displayed content', () => {
  const output = 'x'.repeat(20_001);
  assert.deepEqual(getRuntimeOutputPreviews([
    { id: 'a', type: 'runtime_output', title: 'OMP', content: output },
    { id: 'b', type: 'file', content: 'not runtime output' },
    null,
  ]), [{ id: 'a', title: 'OMP', content: 'x'.repeat(20_000), truncated: true }]);
});

test('runtime output preview ignores malformed artifacts and handles missing artifacts', () => {
  assert.deepEqual(getRuntimeOutputPreviews([{ type: 'runtime_output', content: 12 }]), []);
  assert.deepEqual(getRuntimeOutputPreviews(undefined), []);
});
