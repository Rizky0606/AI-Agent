import { invoke } from '@tauri-apps/api/core';
import { DeviceKeyStore } from './device-key.ts';

export interface DeviceIdentity {
  /**
   * The id the server assigned to this machine's key. Empty until the handshake is acknowledged:
   * the agent does not get to name itself, it only reports the key it holds.
   */
  id: string;
  name: string;
  platform: 'windows';
  hostname: string;
  arch: string;
}

/**
 * Reads what the machine can honestly report about itself. The id is deliberately absent — the
 * server derives it from the device key during the handshake.
 */
export async function fetchDeviceIdentity(): Promise<Omit<DeviceIdentity, 'id'>> {
  try {
    const identity = await invoke<Omit<DeviceIdentity, 'id'>>('get_device_identity');
    if (identity?.name) return identity;
  } catch {
    // Fallback when invoked outside of Tauri runtime
  }

  return {
    name: 'Windows Agent (Local)',
    platform: 'windows',
    hostname: 'localhost',
    arch: 'x64',
  };
}

export class DeviceIdentityManager {
  readonly keys = new DeviceKeyStore();
  private identity: DeviceIdentity;

  constructor(customIdentity?: Partial<DeviceIdentity>) {
    this.identity = {
      id: customIdentity?.id ?? '',
      name: customIdentity?.name ?? 'Windows Agent (Local)',
      platform: 'windows',
      hostname: customIdentity?.hostname ?? 'localhost',
      arch: customIdentity?.arch ?? 'x64',
    };
  }

  getIdentity(): DeviceIdentity {
    return { ...this.identity };
  }

  /** Called with the id the server issued once it has verified the handshake signature. */
  setServerDeviceId(deviceId: string): DeviceIdentity {
    this.identity = { ...this.identity, id: deviceId };
    return this.getIdentity();
  }

  setDeviceName(name: string): void {
    this.identity = { ...this.identity, name };
  }

  async syncWithTauri(): Promise<DeviceIdentity> {
    const fetched = await fetchDeviceIdentity();
    this.identity = { ...this.identity, ...fetched };
    return this.getIdentity();
  }
}
