import {
  RESEARCH_QUALITY_CHECKLIST_MANIFEST,
  researchQualityChecklistHandler,
  type ResearchQualityInput,
  type ResearchQualityOutput,
} from '@personal-ai-os/agent-core';

export const manifest = RESEARCH_QUALITY_CHECKLIST_MANIFEST;
export const handler = researchQualityChecklistHandler;
export type { ResearchQualityInput, ResearchQualityOutput };
