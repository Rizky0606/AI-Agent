/**
 * The Windows agent's identity is a P-256 key pair that never leaves the machine. The server hands
 * out a fresh challenge on every connection and the agent signs it, so knowing a device id is no
 * longer enough to claim a device: an impostor would need the private key.
 *
 * The private key is stored as a JWK in the webview's local storage, which lives in the app's data
 * directory. That is weaker than an OS keystore — a future hardening step — but it is the platform
 * facility available without adding a Rust dependency, and it is strictly stronger than the
 * previous "anyone who knows the string" identity.
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

/** Used when no `localStorage` exists (Node tests): the key lives for the process only. */
let fallbackStoredKey: string | null = null;

const readStoredKey = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? fallbackStoredKey;
  } catch {
    return fallbackStoredKey;
  }
};

const writeStoredKey = (value: string): void => {
  fallbackStoredKey = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable (private mode, tests): the in-memory copy is all we have.
  }
};

const toBase64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
export class DeviceKeyStore {
  private privateKey: CryptoKey | null = null;
  private publicJwk: DevicePublicKeyJwk | null = null;
  /**
   * One load at a time: the handshake asks for the public key and a signature at once, and without
   * this each caller would generate its own key pair — the public half and the signature would then
   * come from different keys and every handshake would be rejected.
   */
  private loading: Promise<void> | null = null;

  private load(): Promise<void> {
    this.loading ??= this.loadKey();
    return this.loading;
  }

  private async loadKey(): Promise<void> {

    const stored = readStoredKey();
    if (stored) {
      try {
        const jwk = JSON.parse(stored) as JsonWebKey;
        const privateKey = await crypto.subtle.importKey('jwk', jwk, ALGORITHM, true, ['sign']);
        this.privateKey = privateKey;
        this.publicJwk = toPublicJwk(await crypto.subtle.exportKey('jwk', privateKey));
        return;
      } catch {
        // A corrupt or unreadable key is replaced rather than silently reused.
      }
    }

    const generated = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
    writeStoredKey(JSON.stringify(jwk));
    this.privateKey = generated.privateKey;
    this.publicJwk = toPublicJwk(await crypto.subtle.exportKey('jwk', generated.publicKey));
  }

  async publicKey(): Promise<DevicePublicKeyJwk> {
    await this.load();
    return this.publicJwk!;
  }

  /** Signs the server's challenge. WebCrypto emits raw `r || s`, which is what the server expects. */
  async sign(challenge: string): Promise<string> {
    await this.load();
    const signature = await crypto.subtle.sign(
      SIGN_ALGORITHM,
      this.privateKey!,
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
