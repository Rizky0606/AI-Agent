import { CapabilityRegistry } from '../security/capability-registry.ts';
import { PathValidator } from '../security/path-validator.ts';
import { DeviceIdentityManager } from '../connection/device-identity.ts';
import { createAgentStore } from '../state/agent-store.ts';

const defaultCapabilityRegistry = new CapabilityRegistry();
const defaultPathValidator = new PathValidator();
const defaultDeviceIdentity = new DeviceIdentityManager();

export const useAgentStore = createAgentStore(
  defaultCapabilityRegistry,
  defaultPathValidator,
  defaultDeviceIdentity,
);
