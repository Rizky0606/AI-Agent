/**
 * React Native entry point.
 *
 * Metro ignores the `exports` map and resolves the `react-native` main field first, so without
 * this file it fell back to a literal `index` that does not exist. It is also what keeps the
 * Node-only modules (`tasks/checkpoint-verifier.ts` and `observability/`, both of which import
 * `node:crypto`) out of the React Native bundle. Everything else is exported, matching
 * `src/index.ts` minus those two.
 *
 * Node, TypeScript and Vite keep resolving `exports` -> `src/index.ts`; only Metro reads this.
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
