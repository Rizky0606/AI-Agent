/**
 * Browser-compatible entry point for @personal-ai-os/shared.
 *
 * Vite resolves the `browser` condition in `exports` or the `browser` field.
 * Excludes Node-only modules (`node:crypto`) so client web bundles compile cleanly.
 */
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
export * from './design/index.ts';
