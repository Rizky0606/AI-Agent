import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { createBrowserNavigateTool } from '../builtin/browser-navigate.ts';
import { createWebFetchTool } from '../builtin/web-fetch.ts';
import type { BrowserController } from '../browser/browser-controller.ts';
import { ToolRegistry } from './tool-registry.ts';

export interface DefaultToolRegistryOptions {
  guard?: SecuredCapabilityGuard | undefined;
  /**
   * Registered as `browser_navigate` when supplied. Only the worker builds a real
   * controller, so the API catalog stays free of the Playwright dependency.
   */
  browserController?: BrowserController | undefined;
}

export function createDefaultToolRegistry(
  options: DefaultToolRegistryOptions = {},
): ToolRegistry {
  const registry = new ToolRegistry(options.guard ?? new SecuredCapabilityGuard(new PermissionEngine()));
  registry.registerTool(createWebFetchTool());
  if (options.browserController) {
    registry.registerTool(createBrowserNavigateTool(options.browserController));
  }
  return registry;
}
