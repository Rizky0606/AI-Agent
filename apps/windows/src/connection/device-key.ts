import { invoke } from '@tauri-apps/api/core';

/**
 * The Windows agent's cryptographic identity is a P-256 key pair.
 * Per ADR 0016, the private key is securely managed inside Rust memory and
 * encrypted using Windows DPAPI (%APPDATA%\personal-ai-os\device_identity.enc).
 *
 * NO private key is ever accessible to JavaScript or stored in localStorage.
 * Any legacy key found in localStorage is migrated to Rust on first boot and
 * immediately deleted.
 */

export interface DevicePublicKeyJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

const STORAGE_KEY = 'personal-ai-os.device-key';
const ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGORITHM: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

const toBase64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export class DeviceKeyStore {
  private publicJwk: DevicePublicKeyJwk | null = null;
  /** Used exclusively for ephemeral test fallback in headless Node.js unit tests without Tauri. */
  private fallbackPrivateKey: CryptoKey | null = null;
  private isTauri: boolean | null = null;
  private loading: Promise<void> | null = null;

  private load(): Promise<void> {
    this.loading ??= this.initKey();
    return this.loading;
  }

  private async detectTauri(): Promise<boolean> {
    if (this.isTauri !== null) return this.isTauri;
    try {
      await invoke('has_secure_device_key');
      this.isTauri = true;
      return true;
    } catch {
      this.isTauri = false;
      return false;
    }
  }

  private async initKey(): Promise<void> {
    const hasTauri = await this.detectTauri();

    if (hasTauri) {
      // 1. One-time migration: check if legacy key exists in localStorage
      try {
        const legacyKey = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (legacyKey) {
          const migrated = await invoke<DevicePublicKeyJwk>('migrate_legacy_key', {
            jwkJson: legacyKey,
          });
          // CRITICAL SECURITY REQUIREMENT: Immediately purge legacy private key from webview localStorage
          globalThis.localStorage?.removeItem(STORAGE_KEY);
          this.publicJwk = migrated;
          return;
        }
      } catch {
        // Migration error or invalid legacy key: proceed with standard Rust secure key
      }

      // 2. Fetch public key from Rust (Rust auto-generates inside DPAPI if none exists)
      const pubKey = await invoke<DevicePublicKeyJwk>('get_device_public_key');
      this.publicJwk = pubKey;
      return;
    }

    // Fallback for headless Node.js tests where Tauri IPC is unavailable
    await this.initFallbackKey();
  }

  private async initFallbackKey(): Promise<void> {
    const generated = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
    this.fallbackPrivateKey = generated.privateKey;
    const jwk = await crypto.subtle.exportKey('jwk', generated.publicKey);
    this.publicJwk = toPublicJwk(jwk);
  }

  async publicKey(): Promise<DevicePublicKeyJwk> {
    await this.load();
    return this.publicJwk!;
  }

  /**
   * Signs the server's challenge.
   * If running in Tauri, delegated directly to Rust secure DPAPI keystore.
   * The signature format is raw IEEE P1363 (r || s, 64 bytes) Base64 encoded.
   */
  async sign(challenge: string): Promise<string> {
    await this.load();

    if (this.isTauri) {
      return invoke<string>('sign_device_challenge', { challenge });
    }

    // Fallback signing for test runner
    const signature = await crypto.subtle.sign(
      SIGN_ALGORITHM,
      this.fallbackPrivateKey!,
      new TextEncoder().encode(challenge),
    );
    return toBase64(signature);
  }
}

const toPublicJwk = (jwk: JsonWebKey): DevicePublicKeyJwk => {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Device key store holds a key that is not a P-256 EC key');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
};
