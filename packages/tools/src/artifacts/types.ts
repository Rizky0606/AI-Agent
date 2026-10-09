import type { Readable } from 'node:stream';

export type ArtifactRetention = 'ephemeral' | 'task_duration' | 'project_lifetime' | 'permanent';

export type ArtifactAccessPolicy = 'owner_only' | 'project_members' | 'public_signed';

export interface ArtifactMetadata {
  id: string;
  ownerId: string;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  conversationId?: string | null | undefined;
  filename: string;
  mimeType: string;
  size: number;
  checksum: string;
  version: number;
  storageKey: string;
  retention: ArtifactRetention;
  accessPolicy: ArtifactAccessPolicy;
  createdAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateArtifactInput {
  ownerId: string;
  filename: string;
  mimeType: string;
  content: Buffer | Uint8Array | string | Readable;
  size?: number | undefined;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  conversationId?: string | null | undefined;
  retention?: ArtifactRetention | undefined;
  accessPolicy?: ArtifactAccessPolicy | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ArtifactSignedTokenPayload {
  artifactId: string;
  ownerId: string;
  expiresAt: number;
  accessPolicy: ArtifactAccessPolicy;
}

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export class ArtifactNotFoundError extends ArtifactError {
  constructor(artifactId: string) {
    super(`Artefak dengan ID '${artifactId}' tidak ditemukan.`);
    this.name = 'ArtifactNotFoundError';
  }
}

export class ArtifactAccessDeniedError extends ArtifactError {
  constructor(artifactId: string, userId?: string | undefined) {
    super(
      `Akses ditolak ke artefak '${artifactId}': pengguna ${userId ?? 'anonim'} bukan pemilik dan tidak memiliki izin akses yang sah.`,
    );
    this.name = 'ArtifactAccessDeniedError';
  }
}

export class ArtifactQuotaExceededError extends ArtifactError {
  constructor(requestedSize: number, remainingQuota: number) {
    super(
      `Kuota penyimpanan terlampaui: ukuran artefak (${requestedSize} bytes) melebihi sisa kuota yang tersedia (${remainingQuota} bytes).`,
    );
    this.name = 'ArtifactQuotaExceededError';
  }
}

export class InvalidMimeTypeError extends ArtifactError {
  constructor(mimeType: string) {
    super(`Tipe MIME '${mimeType}' tidak diizinkan dalam kebijakan penyimpanan artefak.`);
    this.name = 'InvalidMimeTypeError';
  }
}

export class InvalidFilenameError extends ArtifactError {
  constructor(filename: string, reason: string) {
    super(`Nama file '${filename}' tidak valid atau terdeteksi potensi path traversal: ${reason}`);
    this.name = 'InvalidFilenameError';
  }
}
