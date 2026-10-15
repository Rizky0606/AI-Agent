import {
  PLAN_BEFORE_ACT_MANIFEST,
  planBeforeActHandler,
  type PlanBeforeActInput,
  type PlanBeforeActOutput,
} from '@personal-ai-os/agent-core';

export const manifest = PLAN_BEFORE_ACT_MANIFEST;
export const handler = planBeforeActHandler;
export type { PlanBeforeActInput, PlanBeforeActOutput };
