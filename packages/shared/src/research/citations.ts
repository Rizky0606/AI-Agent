import type { ResearchEvidenceItem, ResearchSourceItem } from './types.ts';

export interface ParsedCitation {
  citationId: string; // e.g. 'src-1'
  number: number; // e.g. 1
  source?: ResearchSourceItem | undefined;
  quote?: string | undefined;
  isValid: boolean;
  label: string;
}

/**
 * Ekstrak 2 karakter inisial dari nama domain untuk ditampilkan sebagai badge
 * tanpa memuat gambar/favicon eksternal (CSP compliant).
 */
export function extractDomainInitials(domain: string): string {
  if (!domain) return '??';
  const clean = domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!;

  const parts = clean.split('.').filter(Boolean);
  if (parts.length >= 2) {
    const mainPart = parts[0]!;
    if (mainPart.length >= 2) {
      return mainPart.slice(0, 2).toUpperCase();
    }
    return (mainPart + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  return clean.slice(0, 2).toUpperCase() || '??';
}

export const deriveDomainInitials = extractDomainInitials;

/**
 * Parsing sitasi [src-X] dari teks Markdown.
 * Dijamin TIDAK PERNAH CRASH meskipun sitasi menunjuk ID yang tidak ada pada daftar sumber.
 */
export function parseCitations(
  markdown: string,
  sources: ResearchSourceItem[] = [],
  evidence: ResearchEvidenceItem[] = [],
): Map<string, ParsedCitation> {
  const map = new Map<string, ParsedCitation>();
  if (!markdown) return map;

  const regex = /\[src-(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const numStr = match[1]!;
    const citationId = `src-${numStr}`;

    if (!map.has(citationId)) {
      const num = parseInt(numStr, 10);
      const source = sources.find(
        (s) => s.id === citationId || s.id === numStr || s.id === `src-${num}`,
      );

      // Cari kutipan bukti pendukung pertama untuk sumber ini
      const relatedEvidence = evidence.find(
        (e) => (e.sourceId === citationId || e.sourceId === numStr) && e.quote,
      );

      if (source) {
        map.set(citationId, {
          citationId,
          number: num,
          source,
          quote: relatedEvidence?.quote,
          isValid: true,
          label: `[src-${num}] ${source.title} (${source.domain})`,
        });
      } else {
        // Sitasi tidak valid / tidak ditemukan di daftar sumber — tetap kembalikan objek aman tanpa crash!
        map.set(citationId, {
          citationId,
          number: num,
          source: undefined,
          quote: undefined,
          isValid: false,
          label: `[src-${num}: Sumber tidak ditemukan]`,
        });
      }
    }
  }

  return map;
}

/**
 * Ekstrak daftar seluruh ID sitasi unik [src-X] dalam urutan kemunculan di teks.
 */
export function extractCitationIds(markdown: string): string[] {
  if (!markdown) return [];
  const regex = /\[src-(\d+)\]/g;
  const set = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    set.add(`src-${match[1]}`);
  }

  return Array.from(set);
}
