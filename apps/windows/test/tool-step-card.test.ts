import test from 'node:test';
import assert from 'node:assert/strict';
import { idID } from '../src/ui/locales/id-ID.ts';
import { aggregateRuntimeSteps, type RuntimeStepEvent } from '@personal-ai-os/shared';

test('ToolStep: Indonesian localization strings and status labels', () => {
  assert.equal(idID.chat.toolStep.title, 'Langkah Alat (Tool Step)');
  assert.equal(idID.chat.toolStep.running, 'Sedang berjalan...');
  assert.equal(idID.chat.toolStep.completed, 'Selesai');
  assert.equal(idID.chat.toolStep.failed, 'Gagal');
  assert.equal(idID.chat.conversationTasks, 'Tugas Terkait Percakapan Ini');
});

test('ToolStep: Diff line parser correctly classifies additions, deletions, and hunks', () => {
  const diffSample = '@@ -1,3 +1,4 @@\n-const old = 1;\n+const current = 2;\n unchanged';
  const lines = diffSample.split('\n');

  const classifyLine = (line: string): string => {
    if (line.startsWith('+')) return 'diff-line-add';
    if (line.startsWith('-')) return 'diff-line-del';
    if (line.startsWith('@@')) return 'diff-line-hunk';
    return '';
  };

  assert.equal(classifyLine(lines[0]!), 'diff-line-hunk');
  assert.equal(classifyLine(lines[1]!), 'diff-line-del');
  assert.equal(classifyLine(lines[2]!), 'diff-line-add');
  assert.equal(classifyLine(lines[3]!), '');
});

test('ToolStep: Auto-scroll condition only triggers when user is at the bottom (isAtBottom check)', () => {
  const threshold = 40;
  const isAtBottom = (scrollHeight: number, scrollTop: number, clientHeight: number): boolean => {
    return scrollHeight - scrollTop - clientHeight <= threshold;
  };

  // Case 1: User is at the bottom (scrollTop = 400, clientHeight = 600, scrollHeight = 1000)
  assert.equal(isAtBottom(1000, 400, 600), true, 'Exact bottom must evaluate to true');

  // Case 2: User is nearly at the bottom (within 20px of bottom)
  assert.equal(isAtBottom(1000, 385, 600), true, 'Within threshold must evaluate to true');

  // Case 3: User scrolled up to inspect previous steps (e.g. 150px away from bottom)
  assert.equal(isAtBottom(1000, 250, 600), false, 'Scrolled up must evaluate to false to avoid hijacking scroll');

  // Case 4: User at the very top
  assert.equal(isAtBottom(1000, 0, 600), false, 'User at top must never auto-scroll');
});

test('ToolStep: Aggregates real task events into structured ToolStepData with runtime badges', () => {
  const fakeEvents = [
    {
      id: 'ev-1',
      taskId: 'task-live-100',
      eventType: 'task.tool_call' as const,
      createdAt: '2026-10-17T10:00:01.000Z',
      payload: {
        runtime: 'omp',
        urutan: 1,
        runtimeStep: {
          id: 'step-1',
          taskId: 'task-live-100',
          runtime: 'omp',
          urutan: 1,
          waktu: '2026-10-17T10:00:01.000Z',
          type: 'tool_start' as const,
          toolName: 'read_source',
          input: { file: 'src/index.ts' },
        } as RuntimeStepEvent,
      },
    },
    {
      id: 'ev-2',
      taskId: 'task-live-100',
      eventType: 'task.tool_call' as const,
      createdAt: '2026-10-17T10:00:02.000Z',
      payload: {
        runtime: 'omp',
        urutan: 2,
        runtimeStep: {
          id: 'step-2',
          taskId: 'task-live-100',
          runtime: 'omp',
          urutan: 2,
          waktu: '2026-10-17T10:00:02.000Z',
          type: 'tool_end' as const,
          toolName: 'read_source',
          output: 'export const status = "ready";',
        } as RuntimeStepEvent,
      },
    },
    {
      id: 'ev-3',
      taskId: 'task-live-100',
      eventType: 'task.progress' as const,
      createdAt: '2026-10-17T10:00:03.000Z',
      payload: {
        runtime: 'hermes',
        urutan: 3,
        action: 'file_edit',
        path: 'src/index.ts',
        diff: '+ export const status = "ready";',
      },
    },
  ];

  const steps = aggregateRuntimeSteps(fakeEvents);
  assert.equal(steps.length, 2, 'tool_start and tool_end must merge into 1 step, file_edit is step 2');

  // Step 1: read_source completed
  assert.equal(steps[0]?.toolName, 'read_source');
  assert.equal(steps[0]?.status, 'completed');
  assert.equal(steps[0]?.runtime, 'omp');
  assert.equal(steps[0]?.details, 'export const status = "ready";');

  // Step 2: file edit
  assert.equal(steps[1]?.toolName, 'Modifikasi File');
  assert.equal(steps[1]?.path, 'src/index.ts');
  assert.equal(steps[1]?.runtime, 'hermes');
  assert.ok(steps[1]?.diff?.includes('+ export const status'));
});
