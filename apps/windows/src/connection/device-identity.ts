import { invoke } from '@tauri-apps/api/core';

export interface DeviceIdentity {
  id: string;
  name: string;
  platform: 'windows';
  hostname: string;
  arch: string;
  publicKey?: string | undefined;
}

/**
 * Fetches the device identity from the Rust/Tauri backend command 'get_device_identity'.
 * If running outside Tauri (e.g. test environment or browser mock), falls back safely.
 */
export async function fetchDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const identity = await invoke<DeviceIdentity>('get_device_identity');
    if (identity && identity.id) {
      return identity;
    }
  } catch {
    // Fallback when invoked outside of Tauri runtime
  }

  return {
    id: 'win-dev-local',
    name: 'Windows Agent (Local)',
    platform: 'windows',
    hostname: 'localhost',
    arch: 'x64',
  };
}

export class DeviceIdentityManager {
  private identity: DeviceIdentity;

  constructor(customIdentity?: Partial<DeviceIdentity>) {
    this.identity = {
      id: customIdentity?.id ?? 'win-dev-local',
      name: customIdentity?.name ?? 'Windows Agent (Local)',
      platform: 'windows',
      hostname: customIdentity?.hostname ?? 'localhost',
      arch: customIdentity?.arch ?? 'x64',
      publicKey: customIdentity?.publicKey ?? undefined,
    };
  }

  getIdentity(): DeviceIdentity {
    return { ...this.identity };
  }

  setIdentity(identity: DeviceIdentity): void {
    this.identity = { ...identity };
  }

  setDeviceName(name: string): void {
    this.identity.name = name;
  }

  async syncWithTauri(): Promise<DeviceIdentity> {
    const fetched = await fetchDeviceIdentity();
    this.identity = fetched;
    return this.getIdentity();
  }
}
