import {
  SECURITY_REVIEW_MANIFEST,
  securityReviewHandler,
  type SecurityReviewInput,
  type SecurityReviewOutput,
} from '@personal-ai-os/agent-core';

export const manifest = SECURITY_REVIEW_MANIFEST;
export const handler = securityReviewHandler;
export type { SecurityReviewInput, SecurityReviewOutput };
