import { createHmac, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { StorageAdapter } from './storage/storage-adapter.ts';
import {
  type ArtifactMetadata,
  type ArtifactSignedTokenPayload,
  ArtifactAccessDeniedError,
  ArtifactNotFoundError,
  ArtifactQuotaExceededError,
  InvalidFilenameError,
  InvalidMimeTypeError,
  type CreateArtifactInput,
} from './types.ts';
import { MAGIC_BYTES_LENGTH, assertMimeMatchesContent } from './magic-bytes.ts';

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/zip',
  'application/octet-stream',
]);

const DEFAULT_USER_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MB per user
const DEFAULT_MAX_SINGLE_ARTIFACT_BYTES = 25 * 1024 * 1024; // 25 MB single artifact

export interface ArtifactAuditRecord {
  artifactId: string;
  ownerId: string;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  filename: string;
  mimeType: string;
  size: number;
  checksum: string;
}

export interface ArtifactManagerOptions {
  storage: StorageAdapter;
  signingSecret?: string | undefined;
  userQuotaBytes?: number | undefined;
  maxSingleArtifactBytes?: number | undefined;
  allowedMimeTypes?: Set<string> | undefined;
  auditSink?: ((record: ArtifactAuditRecord) => Promise<void> | void) | undefined;
}

export class ArtifactManager {
  private readonly storage: StorageAdapter;
  private readonly signingSecret: string;
  private readonly userQuotaBytes: number;
  private readonly maxSingleArtifactBytes: number;
  private readonly allowedMimeTypes: Set<string>;
  private readonly auditSink?: ((record: ArtifactAuditRecord) => Promise<void> | void) | undefined;

  // Metadata store
  private readonly metadataStore = new Map<string, ArtifactMetadata>();

  // Metadata sidecar prefix. The in-memory map is process-local, so a shared
  // storage backend is what lets the worker's artifacts resolve in the API process.
  private static readonly META_PREFIX = '_meta/';

  constructor(options: ArtifactManagerOptions) {
    this.storage = options.storage;
    this.signingSecret = options.signingSecret ?? 'default-artifact-signing-secret-key-32b';
    this.userQuotaBytes = options.userQuotaBytes ?? DEFAULT_USER_QUOTA_BYTES;
    this.maxSingleArtifactBytes =
      options.maxSingleArtifactBytes ?? DEFAULT_MAX_SINGLE_ARTIFACT_BYTES;
    this.allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
    this.auditSink = options.auditSink;
  }

  private metaKey(artifactId: string): string {
    return `${ArtifactManager.META_PREFIX}${artifactId}.json`;
  }

  /**
   * Resolves artifact metadata, falling back to a sidecar another process wrote and
   * caching the result so repeated lookups stay in-memory.
   */
  private async loadMetadata(artifactId: string): Promise<ArtifactMetadata | undefined> {
    const cached = this.metadataStore.get(artifactId);
    if (cached) return cached;
    try {
      const raw = await this.storage.get(this.metaKey(artifactId));
      const parsed = JSON.parse(raw.toString('utf8')) as ArtifactMetadata;
      if (parsed.id !== artifactId) return undefined;
      this.metadataStore.set(artifactId, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  /**
   * Validates and sanitizes filename to strictly prevent path traversal.
   */
  sanitizeFilename(filename: string): string {
    if (!filename || filename.trim().length === 0) {
      throw new InvalidFilenameError(filename, 'Nama file tidak boleh kosong.');
    }
    const clean = filename.trim();

    // Check for path traversal characters
    if (
      clean.includes('..') ||
      clean.includes('/') ||
      clean.includes('\\') ||
      clean.includes('\0')
    ) {
      throw new InvalidFilenameError(
        filename,
        'Karakter path traversal (.., /, \\, null byte) tidak diizinkan.',
      );
    }

    // Strip unsafe characters
    const sanitized = clean.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      throw new InvalidFilenameError(filename, 'Nama file tidak valid setelah sanitasi.');
    }
    return sanitized;
  }

  /**
   * Validates MIME type against allowlist.
   */
  private validateMimeType(mimeType: string): void {
    const normalized = mimeType.toLowerCase().split(';')[0]?.trim();
    if (!normalized || !this.allowedMimeTypes.has(normalized)) {
      throw new InvalidMimeTypeError(mimeType);
    }
  }

  /**
   * Returns the leading bytes used for signature validation. A stream keeps its bytes: the
   * peeked head is pushed back so the upload still reaches storage complete.
   */
  private async headBytes(content: CreateArtifactInput['content']): Promise<Buffer> {
    if (typeof (content as Readable).pipe !== 'function') {
      const buffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content as Uint8Array | string);
      return buffer.subarray(0, MAGIC_BYTES_LENGTH);
    }

    const stream = content as Readable;
    const head = await new Promise<Buffer>((resolve, reject) => {
      const onReadable = (): void => {
        const chunk = stream.read(MAGIC_BYTES_LENGTH) as Buffer | null;
        if (!chunk) return;
        stream.off('readable', onReadable);
        stream.off('end', onEnd);
        // Synchronous: an awaited unshift lands after the stream has already seen EOF and is
        // destroyed, which would silently drop the bytes.
        stream.unshift(chunk);
        resolve(chunk);
      };
      // A stream that ends before the peek returns everything it had, including nothing.
      const onEnd = (): void => {
        stream.off('readable', onReadable);
        resolve((stream.read() as Buffer | null) ?? Buffer.alloc(0));
      };
      stream.on('readable', onReadable);
      stream.on('end', onEnd);
      stream.on('error', reject);
    });
    return head;
  }

  /**
   * Stores a new artifact, enforcing MIME validation, quota, and path traversal protection.
   */
  async createArtifact(input: CreateArtifactInput): Promise<ArtifactMetadata> {
    const sanitizedFilename = this.sanitizeFilename(input.filename);
    this.validateMimeType(input.mimeType);
    // The declared type must match the actual bytes, otherwise a client could store an
    // executable under `image/png`. Streams are peeked without buffering the whole body.
    assertMimeMatchesContent(input.mimeType, await this.headBytes(input.content));
    const artifactId = randomUUID();
    const storageKey = `${input.ownerId}/${artifactId}/${sanitizedFilename}`;

    // Usage is summed from the shared sidecars rather than tracked in a per-process counter,
    // so the cap holds across the API/worker split and survives a container restart.
    const currentUsage = (await this.listArtifactsByUser(input.ownerId)).reduce(
      (total, artifact) => total + artifact.size,
      0,
    );

    // Check quota before upload if size is known
    if (input.size !== undefined) {
      if (input.size > this.maxSingleArtifactBytes) {
        throw new ArtifactQuotaExceededError(input.size, this.maxSingleArtifactBytes);
      }
      if (currentUsage + input.size > this.userQuotaBytes) {
        throw new ArtifactQuotaExceededError(
          input.size,
          Math.max(0, this.userQuotaBytes - currentUsage),
        );
      }
    }

    // Put data to storage
    let putResult: { size: number; checksum: string };
    if (typeof (input.content as Readable).pipe === 'function') {
      putResult = await this.storage.putStream(storageKey, input.content as Readable);
    } else {
      putResult = await this.storage.put(storageKey, input.content as Buffer | Uint8Array | string);
    }

    // Enforce quota post-upload if size was not known beforehand
    if (putResult.size > this.maxSingleArtifactBytes) {
      await this.storage.delete(storageKey).catch(() => {});
      throw new ArtifactQuotaExceededError(putResult.size, this.maxSingleArtifactBytes);
    }

    if (currentUsage + putResult.size > this.userQuotaBytes) {
      await this.storage.delete(storageKey).catch(() => {});
      throw new ArtifactQuotaExceededError(
        putResult.size,
        Math.max(0, this.userQuotaBytes - currentUsage),
      );
    }

    const metadata: ArtifactMetadata = {
      id: artifactId,
      ownerId: input.ownerId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      filename: sanitizedFilename,
      mimeType: input.mimeType,
      size: putResult.size,
      checksum: putResult.checksum,
      version: 1,
      storageKey,
      retention: input.retention ?? 'project_lifetime',
      accessPolicy: input.accessPolicy ?? 'owner_only',
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };

    this.metadataStore.set(artifactId, metadata);
    await this.storage.put(this.metaKey(artifactId), JSON.stringify(metadata));

    // The artifact is already durable here, so a failing audit sink must not fail the upload:
    // a retry would write a second copy. Report it instead.
    if (this.auditSink) {
      try {
        await this.auditSink({
          artifactId: metadata.id,
          ownerId: metadata.ownerId,
          projectId: metadata.projectId,
          taskId: metadata.taskId,
          filename: metadata.filename,
          mimeType: metadata.mimeType,
          size: metadata.size,
          checksum: metadata.checksum,
        });
      } catch (err: unknown) {
        console.error(
          JSON.stringify({
            service: 'tools',
            event: 'artifact_audit_failed',
            artifactId: metadata.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    return metadata;
  }

  /**
   * Gets artifact metadata, verifying ownership.
   */
  async getArtifact(
    artifactId: string,
    requestingUserId?: string | undefined,
    signedToken?: string | undefined,
  ): Promise<ArtifactMetadata> {
    const artifact = await this.loadMetadata(artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(artifactId);
    }

    this.authorizeAccess(artifact, requestingUserId, signedToken);
    return artifact;
  }

  /**
   * Retrieves artifact buffer content.
   */
  async getArtifactContent(
    artifactId: string,
    requestingUserId?: string | undefined,
    signedToken?: string | undefined,
  ): Promise<Buffer> {
    const artifact = await this.getArtifact(artifactId, requestingUserId, signedToken);
    return this.storage.get(artifact.storageKey);
  }

  /**
   * Streams artifact content for large files.
   */
  async getArtifactStream(
    artifactId: string,
    requestingUserId?: string | undefined,
    signedToken?: string | undefined,
  ): Promise<Readable> {
    const artifact = await this.getArtifact(artifactId, requestingUserId, signedToken);
    return this.storage.getStream(artifact.storageKey);
  }

  /**
   * Deletes an artifact, verifying ownership and reclaiming quota.
   */
  async deleteArtifact(artifactId: string, requestingUserId: string): Promise<boolean> {
    const artifact = await this.getArtifact(artifactId, requestingUserId);

    await this.storage.delete(artifact.storageKey);
    await this.storage.delete(this.metaKey(artifactId)).catch(() => false);
    this.metadataStore.delete(artifactId);

    return true;
  }

  /**
   * Creates a signed temporary access token with expiry.
   */
  async createSignedAccessToken(
    artifactId: string,
    requestingUserId: string,
    expiresInMs = 3600000, // 1 hour default
  ): Promise<{ token: string; expiresAt: string }> {
    const artifact = await this.getArtifact(artifactId, requestingUserId);

    const expiresAt = Date.now() + expiresInMs;
    const payload: ArtifactSignedTokenPayload = {
      artifactId,
      ownerId: artifact.ownerId,
      expiresAt,
      accessPolicy: 'public_signed',
    };

    const payloadJson = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.signingSecret)
      .update(payloadJson)
      .digest('base64url');

    const token = `${payloadJson}.${signature}`;
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Verifies a signed access token.
   */
  verifySignedToken(token: string): ArtifactSignedTokenPayload | null {
    try {
      const [payloadPart, sigPart] = token.split('.');
      if (!payloadPart || !sigPart) return null;

      const expectedSig = createHmac('sha256', this.signingSecret)
        .update(payloadPart)
        .digest('base64url');

      if (sigPart !== expectedSig) return null;

      const payload: ArtifactSignedTokenPayload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf-8'),
      );

      if (payload.expiresAt < Date.now()) {
        return null; // Expired
      }
      return payload;
    } catch {
      return null;
    }
  }

  private authorizeAccess(
    artifact: ArtifactMetadata,
    requestingUserId?: string | undefined,
    signedToken?: string | undefined,
  ): void {
    // 1. Direct owner access
    if (requestingUserId && artifact.ownerId === requestingUserId) {
      return;
    }

    // 2. Signed token access
    if (signedToken) {
      const payload = this.verifySignedToken(signedToken);
      if (payload && payload.artifactId === artifact.id) {
        return;
      }
    }

    // 3. Otherwise access is strictly denied
    throw new ArtifactAccessDeniedError(artifact.id, requestingUserId);
  }

  async listArtifactsByUser(userId: string, projectId?: string | null): Promise<ArtifactMetadata[]> {
    return (await this.listAllArtifacts()).filter(
      (artifact) =>
        artifact.ownerId === userId && (!projectId || artifact.projectId === projectId),
    );
  }

  /**
   * Enumerates every artifact regardless of owner, for cross-user maintenance jobs such as
   * the retention sweep. Metadata written by other processes is loaded from the sidecars.
   */
  async listAllArtifacts(): Promise<ArtifactMetadata[]> {
    for (const key of await this.storage.listKeys(ArtifactManager.META_PREFIX)) {
      await this.loadMetadata(key.slice(ArtifactManager.META_PREFIX.length, -'.json'.length));
    }
    return [...this.metadataStore.values()];
  }
}
