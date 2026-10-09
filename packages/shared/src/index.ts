export const SERVICE_NAME = 'personal-ai-os-api' as const;

export type UserId = string;
export type ProjectId = string;
export type TraceId = string;

export type ApiError = {
  error: { code: string; message: string; requestId: string };
};

export * from './tasks/types.ts';
export * from './tasks/state-machine.ts';
export * from './tasks/repository.ts';
export * from './tasks/checkpoint-verifier.ts';
export * from './observability/index.ts';
