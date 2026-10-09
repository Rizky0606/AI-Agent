import type { Readable } from 'node:stream';

export interface StoragePutResult {
  size: number;
  checksum: string;
}

export interface StorageAdapter {
  put(key: string, data: Buffer | Uint8Array | string): Promise<StoragePutResult>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  putStream(key: string, stream: Readable): Promise<StoragePutResult>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}
