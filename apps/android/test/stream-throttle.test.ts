import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamThrottler } from '../src/utils/stream-throttle.ts';

test('StreamThrottler: batches rapid token deltas and flushes within interval', async () => {
  const flushed: string[] = [];
  const throttler = new StreamThrottler({
    intervalMs: 30,
    onFlush: (chunk) => flushed.push(chunk),
  });

  throttler.append('Halo ');
  throttler.append('dunia, ');
  throttler.append('ini ');
  throttler.append('Personal AI.');

  // Before timer expires, nothing should be flushed yet
  assert.equal(flushed.length, 0);
  assert.equal(throttler.getPending(), 'Halo dunia, ini Personal AI.');

  // Wait for the throttle interval
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0], 'Halo dunia, ini Personal AI.');
  assert.equal(throttler.getPending(), '');
});

test('StreamThrottler: immediate flush emits all pending buffer without waiting for timer', () => {
  const flushed: string[] = [];
  const throttler = new StreamThrottler({
    intervalMs: 100,
    onFlush: (chunk) => flushed.push(chunk),
  });

  throttler.append('Token 1 ');
  throttler.append('Token 2 ');

  assert.equal(flushed.length, 0);
  throttler.flush();

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0], 'Token 1 Token 2 ');
  assert.equal(throttler.getPending(), '');
});

test('StreamThrottler: reset clears pending buffer and cancels pending timer', async () => {
  const flushed: string[] = [];
  const throttler = new StreamThrottler({
    intervalMs: 30,
    onFlush: (chunk) => flushed.push(chunk),
  });

  throttler.append('Teks yang dibatalkan');
  throttler.reset();

  assert.equal(throttler.getPending(), '');

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(flushed.length, 0);
});
