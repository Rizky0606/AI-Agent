import {
  ON_TOPIC_GUARD_MANIFEST,
  onTopicGuardHandler,
  type OnTopicInput,
  type OnTopicOutput,
} from '@personal-ai-os/agent-core';

export const manifest = ON_TOPIC_GUARD_MANIFEST;
export const handler = onTopicGuardHandler;
export type { OnTopicInput, OnTopicOutput };
