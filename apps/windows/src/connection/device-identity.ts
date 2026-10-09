import crypto from 'node:crypto';
import os from 'node:os';

export interface DeviceIdentity {
  id: string;
  name: string;
  platform: 'windows';
  hostname: string;
  arch: string;
  publicKey?: string | undefined;
}

export class DeviceIdentityManager {
  private identity: DeviceIdentity;

  constructor(customIdentity?: Partial<DeviceIdentity>) {
    const hostname = os.hostname();
    const defaultName = `Windows Agent (${hostname})`;
    const machineHash = crypto
      .createHash('sha256')
      .update(`${hostname}-${os.platform()}-${os.arch()}-${process.env['USERNAME'] ?? 'user'}`)
      .digest('hex')
      .slice(0, 16);

    this.identity = {
      id: customIdentity?.id ?? `win-dev-${machineHash}`,
      name: customIdentity?.name ?? defaultName,
      platform: 'windows',
      hostname,
      arch: os.arch(),
      publicKey: customIdentity?.publicKey ?? undefined,
    };
  }

  getIdentity(): DeviceIdentity {
    return { ...this.identity };
  }

  setDeviceName(name: string): void {
    this.identity.name = name;
  }
}
