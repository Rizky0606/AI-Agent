import type { MemoryCandidate, MemoryWriteEvaluation } from '../types.ts';
import { detectSensitiveData, redactSensitiveData } from './sensitive-data-filter.ts';

export interface MemoryWritePolicyOptions {
  rejectOnSensitiveCredentials?: boolean | undefined;
  minContentLength?: number | undefined;
}

const NOISE_PHRASES = new Set([
  'halo',
  'hai',
  'hi',
  'hello',
  'selamat pagi',
  'selamat siang',
  'selamat malam',
  'terima kasih',
  'makasih',
  'thanks',
  'thank you',
  'ok',
  'oke',
  'oke sip',
  'siap',
  'baik',
  'good',
  'mantap',
  'yes',
  'ya',
  'tidak',
  'no',
  'ok gas',
]);

const HIGH_VALUE_INDICATORS: Array<{ regex: RegExp; weight: number }> = [
  {
    regex: /(?:preferensi|preference|saya suka|lebih suka|selalu gunakan|always use|prefer)\b/i,
    weight: 0.9,
  },
  { regex: /(?:keputusan|decision|adr|arsitektur|memilih|arsitektur\s*desain)\b/i, weight: 0.95 },
  { regex: /(?:aturan|rule|kebijakan|policy|konvensi|standar)\b/i, weight: 0.85 },
  { regex: /(?:koreksi|bukan\s+begitu|salah|seharusnya|ralat|correction)\b/i, weight: 0.95 },
  { regex: /(?:spesifikasi|arsip|target|kebutuhan|requirement|stack)\b/i, weight: 0.8 },
  { regex: /(?:hasil\s+task|kesimpulan|pembelajaran|summary\s+of\s+work)\b/i, weight: 0.85 },
];

export class MemoryWritePolicy {
  private readonly rejectOnSensitiveCredentials: boolean;
  private readonly minContentLength: number;

  constructor(options: MemoryWritePolicyOptions = {}) {
    this.rejectOnSensitiveCredentials = options.rejectOnSensitiveCredentials ?? true;
    this.minContentLength = options.minContentLength ?? 8;
  }

  evaluate(candidate: MemoryCandidate): MemoryWriteEvaluation {
    const rawContent = candidate.content.trim();

    // 1. Min length and conversational noise filter
    if (rawContent.length < this.minContentLength) {
      return {
        shouldStore: false,
        reason: 'Konten terlalu pendek; densitas informasi tidak memadai untuk memori permanen.',
        candidateType: candidate.type,
        sanitizedContent: rawContent,
        confidence: 0.1,
        sensitiveDataDetected: false,
        redactedCategories: [],
      };
    }

    const normalizedLower = rawContent
      .toLowerCase()
      .replace(/[.,!?;:]/g, '')
      .trim();
    if (NOISE_PHRASES.has(normalizedLower)) {
      return {
        shouldStore: false,
        reason:
          'Pesan percakapan basa-basi / noise ditolak oleh Memory Write Policy (chat tidak disimpan otomatis).',
        candidateType: candidate.type,
        sanitizedContent: rawContent,
        confidence: 0.1,
        sensitiveDataDetected: false,
        redactedCategories: [],
      };
    }

    // 2. Sensitive data inspection
    const sensitiveCheck = detectSensitiveData(rawContent);
    if (sensitiveCheck.found) {
      // If critical credential detected and reject policy is on
      const hasCriticalSecret = sensitiveCheck.categories.some(
        (c) => c === 'private_key' || c === 'connection_string' || c === 'api_key',
      );

      if (this.rejectOnSensitiveCredentials && hasCriticalSecret) {
        return {
          shouldStore: false,
          reason: `Ditolak: kandidat memori mengandung kredensial sensitif (${sensitiveCheck.categories.join(', ')}). Kredensial dilarang disimpan ke memori demi keamanan.`,
          candidateType: candidate.type,
          sanitizedContent: '',
          confidence: 0.95,
          sensitiveDataDetected: true,
          redactedCategories: sensitiveCheck.categories,
        };
      }
    }

    // Redact any remaining sensitive items
    const { sanitized, categories: redactedCategories } = redactSensitiveData(rawContent);

    // 3. Evaluate information value
    let score = 0.5;

    // Explicit user corrections, preferences, and decisions are high value
    if (candidate.provenance === 'user_correction') {
      score = 0.98;
    } else if (candidate.type === 'preference' || candidate.type === 'decision') {
      score = 0.9;
    } else if (candidate.type === 'knowledge' || candidate.type === 'project') {
      score = 0.8;
    }

    for (const indicator of HIGH_VALUE_INDICATORS) {
      if (indicator.regex.test(sanitized)) {
        score = Math.max(score, indicator.weight);
      }
    }

    const shouldStore = score >= 0.6;
    const reason = shouldStore
      ? `Memori diterima sebagai '${candidate.type}' dengan skor relevansi ${score.toFixed(2)}.`
      : 'Konten memiliki densitas informasi rendah atau tidak tergolong memori durable yang disetujui.';

    return {
      shouldStore,
      reason,
      candidateType: candidate.type,
      sanitizedContent: sanitized,
      confidence: score,
      sensitiveDataDetected: sensitiveCheck.found,
      redactedCategories,
    };
  }
}
