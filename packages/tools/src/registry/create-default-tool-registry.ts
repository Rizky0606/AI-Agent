import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { createBrowserNavigateTool } from '../builtin/browser-navigate.ts';
import { createWebFetchTool } from '../builtin/web-fetch.ts';
import { createWebSearchTool } from '../builtin/web-search.ts';
import type { BrowserController } from '../browser/browser-controller.ts';
import {
  createScheduleTaskTool,
  createListScheduledTasksTool,
  createPauseScheduledTaskTool,
  createResumeScheduledTaskTool,
  createUpdateScheduledTaskTool,
  createCancelScheduledTaskTool,
  type ScheduleDispatcher,
} from '../builtin/schedule-task.ts';
import { ToolRegistry } from './tool-registry.ts';

export interface DefaultToolRegistryOptions {
  guard?: SecuredCapabilityGuard | undefined;
  /**
   * Registered as `browser_navigate` when supplied. Only the worker builds a real
   * controller, so the API catalog stays free of the Playwright dependency.
   */
  browserController?: BrowserController | undefined;
  /**
   * Registered as scheduling tools (`schedule_task`, `list_scheduled_tasks`, etc.) when supplied.
   */
  scheduleDispatcher?: ScheduleDispatcher | undefined;
}

export function createDefaultToolRegistry(
  options: DefaultToolRegistryOptions = {},
): ToolRegistry {
  const registry = new ToolRegistry(options.guard ?? new SecuredCapabilityGuard(new PermissionEngine()));
  registry.registerTool(createWebFetchTool());
  registry.registerTool(createWebSearchTool());
  if (options.browserController) {
    registry.registerTool(createBrowserNavigateTool(options.browserController));
  }
  if (options.scheduleDispatcher) {
    registry.registerTool(createScheduleTaskTool(options.scheduleDispatcher));
    registry.registerTool(createListScheduledTasksTool(options.scheduleDispatcher));
    registry.registerTool(createPauseScheduledTaskTool(options.scheduleDispatcher));
    registry.registerTool(createResumeScheduledTaskTool(options.scheduleDispatcher));
    registry.registerTool(createUpdateScheduledTaskTool(options.scheduleDispatcher));
    registry.registerTool(createCancelScheduledTaskTool(options.scheduleDispatcher));
  }
  return registry;
}
