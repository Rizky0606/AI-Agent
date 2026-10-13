import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { StorageAdapter, StoragePutResult } from './storage-adapter.ts';

export class InMemoryArtifactStorage implements StorageAdapter {
  private readonly store = new Map<string, Buffer>();

  async put(key: string, data: Buffer | Uint8Array | string): Promise<StoragePutResult> {
    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === 'string'
        ? Buffer.from(data, 'utf-8')
        : Buffer.from(data);

    const checksum = createHash('sha256').update(buffer).digest('hex');
    this.store.set(key, buffer);
    return { size: buffer.length, checksum };
  }

  async get(key: string): Promise<Buffer> {
    const buffer = this.store.get(key);
    if (!buffer) {
      throw new Error(`Kunci penyimpanan '${key}' tidak ditemukan.`);
    }
    return buffer;
  }

  async getStream(key: string): Promise<Readable> {
    const buffer = await this.get(key);
    return Readable.from(buffer);
  }

  async putStream(key: string, stream: Readable): Promise<StoragePutResult> {
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let totalSize = 0;

    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      hash.update(buf);
      totalSize += buf.length;
    }

    const fullBuffer = Buffer.concat(chunks, totalSize);
    const checksum = hash.digest('hex');
    this.store.set(key, fullBuffer);

    return { size: totalSize, checksum };
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    return [...this.store.keys()].filter((key) => key.startsWith(prefix));
  }

  clear(): void {
    this.store.clear();
  }
}
