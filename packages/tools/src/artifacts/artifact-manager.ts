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

export interface ArtifactManagerOptions {
  storage: StorageAdapter;
  signingSecret?: string | undefined;
  userQuotaBytes?: number | undefined;
  maxSingleArtifactBytes?: number | undefined;
  allowedMimeTypes?: Set<string> | undefined;
}

export class ArtifactManager {
  private readonly storage: StorageAdapter;
  private readonly signingSecret: string;
  private readonly userQuotaBytes: number;
  private readonly maxSingleArtifactBytes: number;
  private readonly allowedMimeTypes: Set<string>;

  // Metadata store
  private readonly metadataStore = new Map<string, ArtifactMetadata>();
  // User storage tracking
  private readonly userUsage = new Map<string, number>();

  constructor(options: ArtifactManagerOptions) {
    this.storage = options.storage;
    this.signingSecret = options.signingSecret ?? 'default-artifact-signing-secret-key-32b';
    this.userQuotaBytes = options.userQuotaBytes ?? DEFAULT_USER_QUOTA_BYTES;
    this.maxSingleArtifactBytes =
      options.maxSingleArtifactBytes ?? DEFAULT_MAX_SINGLE_ARTIFACT_BYTES;
    this.allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
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
   * Stores a new artifact, enforcing MIME validation, quota, and path traversal protection.
   */
  async createArtifact(input: CreateArtifactInput): Promise<ArtifactMetadata> {
    const sanitizedFilename = this.sanitizeFilename(input.filename);
    this.validateMimeType(input.mimeType);

    const artifactId = randomUUID();
    const storageKey = `${input.ownerId}/${artifactId}/${sanitizedFilename}`;

    const currentUsage = this.userUsage.get(input.ownerId) ?? 0;

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

    // Update user usage
    this.userUsage.set(input.ownerId, currentUsage + putResult.size);

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
    const artifact = this.metadataStore.get(artifactId);
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
    const artifact = this.metadataStore.get(artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(artifactId);
    }

    if (artifact.ownerId !== requestingUserId) {
      throw new ArtifactAccessDeniedError(artifactId, requestingUserId);
    }

    await this.storage.delete(artifact.storageKey);
    this.metadataStore.delete(artifactId);

    const currentUsage = this.userUsage.get(artifact.ownerId) ?? 0;
    this.userUsage.set(artifact.ownerId, Math.max(0, currentUsage - artifact.size));
    return true;
  }

  /**
   * Creates a signed temporary access token with expiry.
   */
  createSignedAccessToken(
    artifactId: string,
    requestingUserId: string,
    expiresInMs = 3600000, // 1 hour default
  ): { token: string; expiresAt: string } {
    const artifact = this.metadataStore.get(artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(artifactId);
    }

    if (artifact.ownerId !== requestingUserId) {
      throw new ArtifactAccessDeniedError(artifactId, requestingUserId);
    }

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

  getUserStorageUsage(userId: string): number {
    return this.userUsage.get(userId) ?? 0;
  }

  listArtifactsByUser(userId: string, projectId?: string | null): ArtifactMetadata[] {
    const list: ArtifactMetadata[] = [];
    for (const art of this.metadataStore.values()) {
      if (art.ownerId === userId) {
        if (!projectId || art.projectId === projectId) {
          list.push(art);
        }
      }
    }
    return list;
  }
}
