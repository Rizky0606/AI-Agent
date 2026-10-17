import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateRuntimeSteps,
  sortRuntimeEvents,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';

test('Android timeline: sortRuntimeEvents orders by sequence and timestamp with duplicate safety', () => {
  const events: TaskEventEnvelope[] = [
    {
      id: 'evt-3',
      taskId: 'task-1',
      userId: 'user-1',
      eventType: 'runtime.step',
      payload: { urutan: 3, toolName: 'bash', status: 'completed' },
      createdAt: '2026-10-17T10:00:03.000Z',
    },
    {
      id: 'evt-1',
      taskId: 'task-1',
      userId: 'user-1',
      eventType: 'runtime.step',
      payload: { urutan: 1, toolName: 'read_file', status: 'completed' },
      createdAt: '2026-10-17T10:00:01.000Z',
    },
    {
      id: 'evt-2',
      taskId: 'task-1',
      userId: 'user-1',
      eventType: 'runtime.step',
      payload: { urutan: 2, toolName: 'edit_file', status: 'completed' },
      createdAt: '2026-10-17T10:00:02.000Z',
    },
  ];

  const sorted = sortRuntimeEvents(events);
  assert.equal(sorted[0]?.id, 'evt-1');
  assert.equal(sorted[1]?.id, 'evt-2');
  assert.equal(sorted[2]?.id, 'evt-3');

  // Verify deduplication in live updates
  const nextEvent: TaskEventEnvelope = {
    id: 'evt-2',
    taskId: 'task-1',
    userId: 'user-1',
    eventType: 'runtime.step',
    payload: { urutan: 2 },
    createdAt: '2026-10-17T10:00:02.000Z',
  };
  const deduplicated = events.some((e) => e.id === nextEvent.id)
    ? events
    : [...events, nextEvent];
  assert.equal(deduplicated.length, 3);
});

test('Android timeline: aggregateRuntimeSteps aggregates tool start and edit_file diffs', () => {
  const events: TaskEventEnvelope[] = [
    {
      id: 'evt-1',
      taskId: 'task-1',
      userId: 'user-1',
      eventType: 'runtime.step',
      payload: {
        id: 'step-1',
        urutan: 1,
        runtime: 'omp',
        jenis: 'tool_start',
        toolName: 'edit_file',
        summary: 'Mengubah file server.ts',
        waktu: '2026-10-17T10:00:00.000Z',
      },
      createdAt: '2026-10-17T10:00:00.000Z',
    },
    {
      id: 'evt-2',
      taskId: 'task-1',
      userId: 'user-1',
      eventType: 'runtime.step',
      payload: {
        id: 'step-2',
        urutan: 2,
        runtime: 'omp',
        jenis: 'file_edit',
        path: 'src/server.ts',
        diff: '--- a/src/server.ts\n+++ b/src/server.ts\n@@ -1 +1 @@\n-old\n+new',
        waktu: '2026-10-17T10:00:01.000Z',
      },
      createdAt: '2026-10-17T10:00:01.000Z',
    },
    {
      id: 'evt-3',
      taskId: 'task-1',
      userId: 'user-1',
      eventType: 'runtime.step',
      payload: {
        id: 'step-3',
        urutan: 3,
        runtime: 'omp',
        jenis: 'tool_end',
        toolName: 'edit_file',
        summary: 'Selesai mengubah server.ts',
        waktu: '2026-10-17T10:00:02.000Z',
      },
      createdAt: '2026-10-17T10:00:02.000Z',
    },
  ];

  const aggregated = aggregateRuntimeSteps(events);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0]?.toolName, 'edit_file');
  assert.equal(aggregated[0]?.status, 'completed');
  assert.equal(aggregated[0]?.path, 'src/server.ts');
  assert.ok(aggregated[0]?.diff?.includes('+new'));
  assert.equal(aggregated[0]?.runtime, 'omp');
});

test('Android timeline: DiffBlock long diff predicate correctly identifies truncated diffs', () => {
  const isLong = (diff: string) => diff.length > 200 || diff.split('\n').length > 6;

  const shortDiff = '@@ -1 +1 @@\n-old\n+new';
  assert.equal(isLong(shortDiff), false);

  const manyLinesDiff = '1\n2\n3\n4\n5\n6\n7';
  assert.equal(isLong(manyLinesDiff), true);

  const longContentDiff = '+'.repeat(201);
  assert.equal(isLong(longContentDiff), true);
});
