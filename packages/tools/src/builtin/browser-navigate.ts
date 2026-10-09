import { randomUUID } from 'node:crypto';
import type { BrowserController } from '../browser/browser-controller.ts';
import type { ToolDefinition } from '../types.ts';

export interface BrowserNavigateInput {
  url: string;
  screenshot?: boolean | undefined;
  sessionId?: string | undefined;
}

export interface BrowserNavigateOutput {
  url: string;
  title?: string | undefined;
  content?: string | undefined;
  screenshotArtifactId?: string | undefined;
  sessionId: string;
  stepNumber: number;
  remainingSteps: number;
}

export function createBrowserNavigateTool(
  controller: BrowserController,
): ToolDefinition<BrowserNavigateInput, BrowserNavigateOutput> {
  return {
    name: 'browser_navigate',
    description:
      'Menavigasi browser terisolasi ke URL web dan membaca konten atau mengambil screenshot.',
    capability: 'browser:navigate',
    resourceScope: 'global',
    riskLevel: 'LOW',
    action: 'browser:navigate',
    timeoutMs: 30000,
    supportsCancellation: true,
    outputLimitBytes: 65536,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { url: string }.' };
      }
      const u = (input as Record<string, unknown>).url;
      if (typeof u !== 'string' || u.trim().length === 0) {
        return { valid: false, error: 'Atribut "url" harus berupa string non-kosong.' };
      }
      return { valid: true, data: input as BrowserNavigateInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: BrowserNavigateInput, context) => {
      let sessionId = input.sessionId;
      let shouldCloseSession = false;

      if (!sessionId) {
        sessionId = await controller.createSession({
          sessionId: randomUUID(),
          actorId: context.actor.id,
          projectId: context.projectId,
          taskId: context.taskId,
        });
        shouldCloseSession = true;
      }

      try {
        const navResult = await controller.navigate(sessionId, input.url);
        let screenshotArtifactId: string | undefined;

        if (input.screenshot) {
          const shotResult = await controller.screenshot(sessionId);
          screenshotArtifactId = shotResult.screenshotArtifactId;
        }

        return {
          url: navResult.currentUrl,
          title: navResult.title,
          content: navResult.content,
          screenshotArtifactId,
          sessionId,
          stepNumber: navResult.stepNumber,
          remainingSteps: navResult.remainingSteps,
        };
      } finally {
        if (shouldCloseSession && sessionId) {
          await controller.closeSession(sessionId).catch(() => {});
        }
      }
    },
  };
}
