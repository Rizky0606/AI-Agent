export type HostRuntime = 'omp' | 'hermes';

export interface RuntimeTaskRequest {
  projectId: string;
  kind: 'coding_runtime';
  payload: {
    useRuntime: true;
    runtime: HostRuntime;
    prompt: string;
    workspaceId: string;
  };
}

export function createRuntimeTaskRequest(projectId: string, prompt: string, runtime: HostRuntime, workspaceId: string): RuntimeTaskRequest {
  const instruction = prompt.trim();
  if (!projectId.trim()) throw new Error('Project wajib dipilih.');
  if (!instruction) throw new Error('Instruksi wajib diisi.');
  return { projectId, kind: 'coding_runtime', payload: { useRuntime: true, runtime, prompt: instruction, workspaceId } };
}
