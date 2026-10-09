import {
  CODING_QUALITY_CHECKLIST_MANIFEST,
  codingQualityChecklistHandler,
  type CodingQualityInput,
  type CodingQualityOutput,
} from '@personal-ai-os/agent-core';

export const manifest = CODING_QUALITY_CHECKLIST_MANIFEST;
export const handler = codingQualityChecklistHandler;
export type { CodingQualityInput, CodingQualityOutput };
