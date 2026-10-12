import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeTaskRequest } from '../src/runtime-task.ts';

test('runtime task request trims prompt and preserves project/runtime dispatch fields', () => {
  assert.deepEqual(createRuntimeTaskRequest('project-1', '  Fix the bug  ', 'omp', 'project-1/task-1'), {
    projectId: 'project-1',
    kind: 'coding_runtime',
    payload: { useRuntime: true, runtime: 'omp', prompt: 'Fix the bug', workspaceId: 'project-1/task-1' },
  });
});

test('runtime task request rejects missing project or blank prompt', () => {
  assert.throws(() => createRuntimeTaskRequest('', 'prompt', 'hermes', 'w'), /Project wajib dipilih/);
  assert.throws(() => createRuntimeTaskRequest('project-1', '  ', 'hermes', 'w'), /Instruksi wajib diisi/);
});
