import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, normalize, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { StorageAdapter, StoragePutResult } from './storage-adapter.ts';

export class DiskArtifactStorage implements StorageAdapter {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private resolveSafePath(key: string): string {
    const normalizedKey = normalize(key);
    if (
      normalizedKey.includes('..') ||
      key.startsWith('/') ||
      key.startsWith('\\') ||
      key.includes('..')
    ) {
      throw new Error(
        `Path traversal terdeteksi pada kunci penyimpanan '${key}'. Akses di luar base directory dilarang.`,
      );
    }
    const fullPath = resolve(this.baseDir, normalizedKey);

    if (!fullPath.startsWith(this.baseDir)) {
      throw new Error(
        `Path traversal terdeteksi pada kunci penyimpanan '${key}'. Akses di luar base directory dilarang.`,
      );
    }
    return fullPath;
  }

  async put(key: string, data: Buffer | Uint8Array | string): Promise<StoragePutResult> {
    const targetPath = this.resolveSafePath(key);
    await mkdir(dirname(targetPath), { recursive: true });

    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === 'string'
        ? Buffer.from(data, 'utf-8')
        : Buffer.from(data);

    const checksum = createHash('sha256').update(buffer).digest('hex');
    const tempPath = `${targetPath}.tmp.${randomUUID()}`;

    // Write atomically via temporary file
    const writeStream = createWriteStream(tempPath);
    await new Promise<void>((res, rej) => {
      writeStream.on('error', rej);
      writeStream.on('finish', () => res());
      writeStream.end(buffer);
    });
    await rename(tempPath, targetPath);

    return { size: buffer.length, checksum };
  }

  async get(key: string): Promise<Buffer> {
    const targetPath = this.resolveSafePath(key);
    const readStream = createReadStream(targetPath);
    const chunks: Buffer[] = [];

    for await (const chunk of readStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getStream(key: string): Promise<Readable> {
    const targetPath = this.resolveSafePath(key);
    return createReadStream(targetPath);
  }

  async putStream(key: string, stream: Readable): Promise<StoragePutResult> {
    const targetPath = this.resolveSafePath(key);
    await mkdir(dirname(targetPath), { recursive: true });

    const tempPath = `${targetPath}.tmp.${randomUUID()}`;
    const hash = createHash('sha256');
    let totalSize = 0;

    const writeStream = createWriteStream(tempPath);

    stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalSize += buf.length;
      hash.update(buf);
    });

    try {
      await pipeline(stream, writeStream);
      await rename(tempPath, targetPath);
      const checksum = hash.digest('hex');
      return { size: totalSize, checksum };
    } catch (err) {
      await unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  async delete(key: string): Promise<boolean> {
    const targetPath = this.resolveSafePath(key);
    try {
      await rm(targetPath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    const targetPath = this.resolveSafePath(key);
    try {
      const s = await stat(targetPath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    const dir = this.resolveSafePath(prefix);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    return entries.filter((name) => name.endsWith('.json')).map((name) => `${prefix}${name}`);
  }
}
