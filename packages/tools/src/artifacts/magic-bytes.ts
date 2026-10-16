import { InvalidMimeTypeError } from './types.ts';

/** Number of leading bytes read from an upload to classify its content. */
export const MAGIC_BYTES_LENGTH = 32;

export type ContentKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'text';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_SIGNATURE = Buffer.from('GIF87a', 'ascii');
const GIF89_SIGNATURE = Buffer.from('GIF89a', 'ascii');
const RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii');
const WEBP_SIGNATURE = Buffer.from('WEBP', 'ascii');
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const ZIP_LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_SPANNED_SIGNATURE = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

/** Declared MIME type to the content kind its bytes must actually have. */
const DECLARED_CONTENT_KIND: Record<string, ContentKind> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/svg+xml': 'text',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/html': 'text',
  'text/csv': 'text',
  'application/json': 'text',
};

/**
 * Compares only the bytes both buffers share, so a truncated signature (e.g. the first
 * four bytes of a PNG) still classifies instead of being reported as unknown.
 */
const matchesSignature = (head: Buffer, signature: Buffer): boolean => {
  const shared = Math.min(head.length, signature.length);
  if (shared === 0) return false;
  return head.subarray(0, shared).equals(signature.subarray(0, shared));
};

const isPlainText = (head: Buffer): boolean => {
  // An empty upload carries no signature; treat it as text so a declared text type still stores.
  if (head.length === 0) return true;
  if (head.toString('utf-8').includes('\uFFFD')) return false;
  for (const byte of head) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) return false;
  }
  return true;
};

/** Classifies the leading bytes of an upload; `undefined` means "unrecognized binary". */
export function sniffContentKind(head: Buffer): ContentKind | undefined {
  if (matchesSignature(head, PNG_SIGNATURE)) return 'png';
  if (matchesSignature(head, JPEG_SIGNATURE)) return 'jpeg';
  if (matchesSignature(head, GIF87_SIGNATURE) || matchesSignature(head, GIF89_SIGNATURE)) return 'gif';
  // RIFF<4-byte size>WEBP: the WEBP tag starts at offset 8, not right after RIFF.
  if (matchesSignature(head, RIFF_SIGNATURE) && matchesSignature(head.subarray(8), WEBP_SIGNATURE)) {
    return 'webp';
  }
  if (matchesSignature(head, PDF_SIGNATURE)) return 'pdf';
  // ZIP needs the whole 4-byte signature: its leading "PK" is plausible plain text, whereas
  // the trailing 0x03 0x04 is not, so the short-prefix leniency above must not apply here.
  if (
    head.length >= ZIP_LOCAL_SIGNATURE.length &&
    (matchesSignature(head, ZIP_LOCAL_SIGNATURE) ||
      matchesSignature(head, ZIP_EMPTY_SIGNATURE) ||
      matchesSignature(head, ZIP_SPANNED_SIGNATURE))
  ) {
    return 'zip';
  }
  return isPlainText(head) ? 'text' : undefined;
}

/**
 * Rejects an upload whose declared MIME type contradicts its actual bytes.
 * `application/octet-stream` (and any type outside the signature table) carries no
 * verifiable signature, so it is accepted as-is.
 */
export function assertMimeMatchesContent(declaredMimeType: string, head: Buffer): void {
  const declared = declaredMimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  const expected = DECLARED_CONTENT_KIND[declared];
  if (!expected) return;
  if (sniffContentKind(head) !== expected) {
    throw new InvalidMimeTypeError(declaredMimeType);
  }
}
