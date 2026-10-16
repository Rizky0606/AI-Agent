import {
  VERIFY_WITH_EVIDENCE_MANIFEST,
  verifyWithEvidenceHandler,
  type VerifyWithEvidenceInput,
  type VerifyWithEvidenceOutput,
} from '@personal-ai-os/agent-core';

export const manifest = VERIFY_WITH_EVIDENCE_MANIFEST;
export const handler = verifyWithEvidenceHandler;
export type { VerifyWithEvidenceInput, VerifyWithEvidenceOutput };
