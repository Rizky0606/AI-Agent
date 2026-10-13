import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { createWebFetchTool } from '../builtin/web-fetch.ts';
import { ToolRegistry } from './tool-registry.ts';

export function createDefaultToolRegistry(guard = new SecuredCapabilityGuard(new PermissionEngine())): ToolRegistry {
  const registry = new ToolRegistry(guard);
  registry.registerTool(createWebFetchTool());
  return registry;
}
