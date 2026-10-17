import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOmpEvent,
  sanitizeRuntimeText,
  sanitizeRuntimeDiff,
  sortRuntimeEvents,
  aggregateRuntimeSteps,
  extractRuntimeStepFromEvent,
  MAX_RUNTIME_TEXT_LENGTH,
  MAX_RUNTIME_DIFF_LENGTH,
  TRUNCATION_INDICATOR,
} from '../src/tasks/runtime-step-event.ts';

test('RuntimeStepEvent: Normalisasi rekaman event omp nyata dari docs/verification/runtimes-live.md', () => {
  const taskId = 'task-omp-live-01';

  // 1. Assistant message update / text from omp
  const ompTextEvent = {
    type: 'message_update',
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    provider: 'router9',
    model: 'Gratisan',
    usage: { input: 6577, output: 5, totalTokens: 6582 },
    timestamp: '2026-10-11T12:00:01.000Z',
  };

  const normalizedText = normalizeOmpEvent(ompTextEvent, 1, taskId, 'omp');
  assert.ok(normalizedText);
  assert.equal(normalizedText.type, 'message');
  assert.equal(normalizedText.text, 'OK');
  assert.equal(normalizedText.urutan, 1);
  assert.equal(normalizedText.taskId, taskId);
  assert.equal(normalizedText.runtime, 'omp');
  assert.equal(normalizedText.status, 'running');

  // 2. Tool start event
  const ompToolStart = {
    type: 'tool_start',
    tool: 'bash',
    input: { command: 'cargo test' },
    timestamp: '2026-10-11T12:00:02.000Z',
  };
  const normalizedToolStart = normalizeOmpEvent(ompToolStart, 2, taskId, 'omp');
  assert.ok(normalizedToolStart);
  assert.equal(normalizedToolStart.type, 'tool_start');
  assert.equal(normalizedToolStart.toolName, 'bash');
  assert.deepEqual(normalizedToolStart.input, { command: 'cargo test' });
  assert.equal(normalizedToolStart.urutan, 2);

  // 3. Tool end event
  const ompToolEnd = {
    type: 'tool_end',
    tool: 'bash',
    output: 'test result: ok. 12 passed; 0 failed',
    timestamp: '2026-10-11T12:00:05.000Z',
  };
  const normalizedToolEnd = normalizeOmpEvent(ompToolEnd, 3, taskId, 'omp');
  assert.ok(normalizedToolEnd);
  assert.equal(normalizedToolEnd.type, 'tool_end');
  assert.equal(normalizedToolEnd.toolName, 'bash');
  assert.equal(normalizedToolEnd.output, 'test result: ok. 12 passed; 0 failed');
  assert.equal(normalizedToolEnd.status, 'completed');

  // 4. File edit diff event
  const ompFileEdit = {
    type: 'file_edit',
    path: 'src/main.rs',
    diff: '@@ -1,3 +1,4 @@\n+use std::sync::Arc;\n fn main() {}',
    timestamp: '2026-10-11T12:00:06.000Z',
  };
  const normalizedDiff = normalizeOmpEvent(ompFileEdit, 4, taskId, 'omp');
  assert.ok(normalizedDiff);
  assert.equal(normalizedDiff.type, 'file_edit');
  assert.equal(normalizedDiff.path, 'src/main.rs');
  assert.match(normalizedDiff.diff ?? '', /\+use std::sync::Arc;/);

  // 5. Error event
  const ompError = {
    type: 'error',
    error: 'Command execution timed out after 300s',
    timestamp: '2026-10-11T12:00:07.000Z',
  };
  const normalizedError = normalizeOmpEvent(ompError, 5, taskId, 'omp');
  assert.ok(normalizedError);
  assert.equal(normalizedError.type, 'error');
  assert.equal(normalizedError.status, 'failed');
  assert.equal(normalizedError.error, 'Command execution timed out after 300s');

  // 6. Agent end event
  const ompDone = {
    type: 'agent_end',
    summary: 'Refactoring selesai dan seluruh test lulus.',
    durationMs: 7200,
    exitCode: 0,
    timestamp: '2026-10-11T12:00:08.000Z',
  };
  const normalizedDone = normalizeOmpEvent(ompDone, 6, taskId, 'omp');
  assert.ok(normalizedDone);
  assert.equal(normalizedDone.type, 'done');
  assert.equal(normalizedDone.status, 'completed');
  assert.equal(normalizedDone.summary, 'Refactoring selesai dan seluruh test lulus.');
});

test('RuntimeStepEvent: Sanitasi output tidak tepercaya (XSS, script tags, event handlers)', () => {
  // Script tag and body stripped
  const maliciousHtml = 'Halo <script>evilScript()</script> Dunia <iframe src="evil.com"></iframe>!';
  const sanitized = sanitizeRuntimeText(maliciousHtml);
  assert.equal(sanitized, 'Halo  Dunia !');
  assert.ok(!sanitized.includes('<script>'));
  assert.ok(!sanitized.includes('evilScript'));
  assert.ok(!sanitized.includes('<iframe'));

  // Neutralize javascript: protocol and onclick
  const dangerousLink = '<a href="javascript:stealToken()" onclick="alert(1)">Klik</a>';
  const neutralized = sanitizeRuntimeText(dangerousLink);
  assert.ok(!neutralized.includes('javascript:'));
  assert.ok(!neutralized.includes('onclick='));
  assert.ok(neutralized.includes('about:blank#blocked-'));
  assert.ok(neutralized.includes('data-blocked-handler=""'));
});

test('RuntimeStepEvent: Pembatasan ukuran maksimum diff dan teks (bound limit)', () => {
  // Text bounding at 16 KB
  const hugeText = 'A'.repeat(MAX_RUNTIME_TEXT_LENGTH + 5000);
  const boundedText = sanitizeRuntimeText(hugeText);
  assert.ok(boundedText.length < hugeText.length);
  assert.ok(boundedText.endsWith(TRUNCATION_INDICATOR));
  assert.ok(boundedText.startsWith('A'.repeat(MAX_RUNTIME_TEXT_LENGTH)));

  // Diff bounding at 32 KB
  const hugeDiff = '+'.repeat(MAX_RUNTIME_DIFF_LENGTH + 8000);
  const boundedDiff = sanitizeRuntimeDiff(hugeDiff);
  assert.ok(boundedDiff.length < hugeDiff.length);
  assert.ok(boundedDiff.endsWith(TRUNCATION_INDICATOR));
  assert.ok(boundedDiff.startsWith('+'.repeat(MAX_RUNTIME_DIFF_LENGTH)));
});

test('RuntimeStepEvent: Pengurutan stabil saat replay atau event putus (sortRuntimeEvents)', () => {
  // Emulate interleaved events from network replay
  const events: Array<{ urutan: number; waktu: string; label: string }> = [
    { urutan: 3, waktu: '2026-10-17T10:00:03.000Z', label: 'Langkah 3' },
    { urutan: 1, waktu: '2026-10-17T10:00:01.000Z', label: 'Langkah 1' },
    { urutan: 2, waktu: '2026-10-17T10:00:02.000Z', label: 'Langkah 2' },
  ];

  const sorted = sortRuntimeEvents(events);
  assert.equal(sorted[0]?.label, 'Langkah 1');
  assert.equal(sorted[1]?.label, 'Langkah 2');
  assert.equal(sorted[2]?.label, 'Langkah 3');
});

test('RuntimeStepEvent: Agregasi tool_start dan tool_end menjadi satu langkah terstruktur', () => {
  const rawEnvelopes = [
    {
      id: 'evt-1',
      taskId: 'task-100',
      eventType: 'task.tool_call',
      createdAt: '2026-10-17T10:00:01.000Z',
      payload: {
        runtime: 'omp',
        urutan: 1,
        runtimeStep: {
          id: 'step-1',
          taskId: 'task-100',
          runtime: 'omp',
          urutan: 1,
          waktu: '2026-10-17T10:00:01.000Z',
          type: 'tool_start' as const,
          toolName: 'read_code',
          input: { file: 'index.ts' },
        },
      },
    },
    {
      id: 'evt-2',
      taskId: 'task-100',
      eventType: 'task.tool_call',
      createdAt: '2026-10-17T10:00:02.000Z',
      payload: {
        runtime: 'omp',
        urutan: 2,
        runtimeStep: {
          id: 'step-2',
          taskId: 'task-100',
          runtime: 'omp',
          urutan: 2,
          waktu: '2026-10-17T10:00:02.000Z',
          type: 'tool_end' as const,
          toolName: 'read_code',
          output: 'export const ready = true;',
        },
      },
    },
    {
      id: 'evt-3',
      taskId: 'task-100',
      eventType: 'task.progress',
      createdAt: '2026-10-17T10:00:03.000Z',
      payload: {
        runtime: 'omp',
        urutan: 3,
        action: 'file_edit',
        path: 'index.ts',
        diff: '+ export const ready = true;',
      },
    },
  ];

  const aggregated = aggregateRuntimeSteps(rawEnvelopes);
  assert.equal(aggregated.length, 2, 'tool_start and tool_end must merge into a single step');
  assert.equal(aggregated[0]?.toolName, 'read_code');
  assert.equal(aggregated[0]?.status, 'completed');
  assert.equal(aggregated[0]?.details, 'export const ready = true;');
  assert.equal(aggregated[1]?.toolName, 'Modifikasi File');
  assert.equal(aggregated[1]?.path, 'index.ts');
  assert.match(aggregated[1]?.diff ?? '', /\+ export const ready/);
});

test('RuntimeStepEvent: Backward compatibility terhadap envelope legacy tanpa runtimeStep', () => {
  const legacyEnvelope = {
    id: 'legacy-1',
    taskId: 'task-legacy',
    eventType: 'task.progress',
    createdAt: '2026-10-17T09:00:00.000Z',
    payload: {
      action: 'file_edit',
      path: 'legacy.ts',
      diff: '+ const legacy = 1;',
    },
  };

  const extracted = extractRuntimeStepFromEvent(legacyEnvelope);
  assert.ok(extracted);
  assert.equal(extracted.type, 'file_edit');
  assert.equal(extracted.path, 'legacy.ts');
  assert.equal(extracted.diff, '+ const legacy = 1;');
});
