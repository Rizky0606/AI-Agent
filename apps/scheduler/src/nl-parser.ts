import { CronParser } from './cron-parser.ts';
import {
  type MissedRunPolicy,
  type ScheduleType,
  MIN_RECURRING_INTERVAL_MINUTES,
} from './types.ts';

export interface ParsedScheduleResult {
  success: boolean;
  ambiguous?: boolean | undefined;
  reason?: string | undefined;
  suggestedClarification?: string | undefined;
  name?: string | undefined;
  prompt?: string | undefined;
  scheduleType?: ScheduleType | undefined;
  cronExpression?: string | undefined;
  runAt?: string | undefined; // ISO 8601 UTC
  timezone?: string | undefined;
  missedRunPolicy?: MissedRunPolicy | undefined;
  summary?: string | undefined;
}

export interface ParseScheduleOptions {
  referenceDate?: Date | undefined;
  defaultTimezone?: string | undefined;
}

const TIMEZONE_ALIASES: Record<string, string> = {
  wib: 'Asia/Jakarta',
  wita: 'Asia/Makassar',
  wit: 'Asia/Jayapura',
  utc: 'UTC',
  gmt: 'UTC',
  jakarta: 'Asia/Jakarta',
  makassar: 'Asia/Makassar',
  jayapura: 'Asia/Jayapura',
};

const INDONESIAN_DAYS: Record<string, number> = {
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
};

const ENGLISH_DAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

// Pola ambiguitas yang dilarang ditebak (karena tidak memuat jam/waktu spesifik)
const AMBIGUOUS_PATTERNS = [
  /\b(?:besok|esok)\s+(?:pagi|siang|sore|malam)\b/i,
  /\b(?:nanti|entar)\s+(?:pagi|siang|sore|malam)\b/i,
  /\b(?:tomorrow|later)\s+(?:morning|afternoon|evening|night)\b/i,
  /\b(?:minggu|pekan)\s+depan\b(?!.*\b(?:jam|pukul|at)\s+\d)/i,
  /\b(?:next\s+week)\b(?!.*\b(?:at)\s+\d)/i,
  /\b(?:kapan-kapan|suatu\s+saat|someday|segera|soon)\b/i,
  /\b(?:nanti\s+saja|later\s+on)\b/i,
];

export class NaturalLanguageScheduleParser {
  /**
   * Mem-parse instruksi bahasa alami menjadi spesifikasi jadwal deterministik.
   * Menolak menebak jika waktu tidak spesifik (ambigu).
   */
  static parse(instruction: string, options?: ParseScheduleOptions): ParsedScheduleResult {
    const raw = instruction.trim();
    if (!raw) {
      return {
        success: false,
        reason: 'Instruksi jadwal tidak boleh kosong.',
      };
    }

    const referenceDate = options?.referenceDate ?? new Date();
    const defaultTimezone = options?.defaultTimezone ?? 'Asia/Jakarta';

    // 1. Periksa apakah instruksi memuat ekspresi yang ambigu
    for (const pattern of AMBIGUOUS_PATTERNS) {
      if (pattern.test(raw)) {
        return {
          success: false,
          ambiguous: true,
          reason:
            'Waktu eksekusi tidak spesifik. Sistem Personal AI OS tidak menebak waktu secara acak demi kepastian otomatisasi.',
          suggestedClarification:
            'Harap tentukan jam spesifik, contoh: "besok jam 08:00 WIB" atau "setiap hari jam 09:00".',
        };
      }
    }

    // 2. Deteksi Timezone
    let timezone = defaultTimezone;
    const tzMatch = raw.match(/\b(WIB|WITA|WIT|UTC|GMT|Asia\/Jakarta|Asia\/Makassar|Asia\/Jayapura)\b/i);
    if (tzMatch && tzMatch[1]) {
      const alias = tzMatch[1].toLowerCase();
      timezone = TIMEZONE_ALIASES[alias] ?? tzMatch[1];
    }

    // 3. Deteksi apakah ekspresi adalah cron mentah (5 field: misal "0 9 * * *")
    const rawCronMatch = raw.match(/\b((?:(?:\*|\*\/\d+|\d+(?:-\d+)?(?:,\d+)*)\s+){4}(?:\*|\*\/\d+|\d+(?:-\d+)?(?:,\d+)*))\b/);
    if (rawCronMatch && rawCronMatch[1]) {
      const cronExpr = rawCronMatch[1].trim();
      try {
        CronParser.parse(cronExpr);
        CronParser.validateMinimumInterval(cronExpr, MIN_RECURRING_INTERVAL_MINUTES, timezone);

        const prompt = this.cleanPrompt(raw.replace(cronExpr, ''));
        const name = this.deriveName(prompt, 'Tugas Cron');
        const nextRun = CronParser.getNextRun(cronExpr, referenceDate, timezone);

        return {
          success: true,
          name,
          prompt,
          scheduleType: 'recurring',
          cronExpression: cronExpr,
          timezone,
          missedRunPolicy: 'skip',
          summary: `Jadwal berulang "${name}" dengan cron "${cronExpr}" (${timezone}). Eksekusi berikutnya: ${nextRun.toISOString()}.`,
        };
      } catch (err: unknown) {
        return {
          success: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // 4. Deteksi interval repetitif menit (misal: "setiap 30 menit", "every 15 minutes")
    const minuteIntervalMatch = raw.match(/\b(?:setiap|tiap|every)\s+(\d+)\s+(?:menit|minute|mins?)\b/i);
    if (minuteIntervalMatch && minuteIntervalMatch[1]) {
      const stepMinutes = parseInt(minuteIntervalMatch[1], 10);
      if (stepMinutes < MIN_RECURRING_INTERVAL_MINUTES) {
        return {
          success: false,
          reason: `Frekuensi jadwal (${stepMinutes} menit) terlalu sering. Batas minimum interval adalah ${MIN_RECURRING_INTERVAL_MINUTES} menit demi stabilitas sumber daya host.`,
        };
      }
      if (60 % stepMinutes !== 0 && stepMinutes < 60) {
        return {
          success: false,
          reason: `Interval menit (${stepMinutes}) harus membagi rata 60 menit (misal: 15, 20, 30 menit).`,
        };
      }
      const cronExpr = `*/${stepMinutes} * * * *`;
      const prompt = this.cleanPrompt(raw.replace(minuteIntervalMatch[0], ''));
      const name = this.deriveName(prompt, `Tugas Setiap ${stepMinutes} Menit`);
      const nextRun = CronParser.getNextRun(cronExpr, referenceDate, timezone);

      return {
        success: true,
        name,
        prompt,
        scheduleType: 'recurring',
        cronExpression: cronExpr,
        timezone,
        missedRunPolicy: 'skip',
        summary: `Jadwal berulang "${name}" setiap ${stepMinutes} menit (${timezone}). Eksekusi berikutnya: ${nextRun.toISOString()}.`,
      };
    }

    // 5. Deteksi jadwal harian atau hari tertentu (misal: "setiap hari jam 09:00", "setiap senin jam 10:30")
    const recurringTimeMatch = raw.match(
      /\b(?:setiap|tiap|every)\s+(?:hari|day)?\s*([a-z'’]+)?\s*(?:jam|pukul|at)\s*(\d{1,2})[.:](\d{2})\b/i,
    );
    if (recurringTimeMatch) {
      const dayWord = (recurringTimeMatch[1] ?? '').toLowerCase().trim();
      const hour = parseInt(recurringTimeMatch[2] ?? '0', 10);
      const minute = parseInt(recurringTimeMatch[3] ?? '0', 10);

      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return {
          success: false,
          reason: `Waktu tidak valid: ${hour}:${minute}. Jam harus 0-23 dan menit 0-59.`,
        };
      }

      let dayOfWeek = '*';
      let dayName = 'hari';
      if (dayWord === 'kerja' || dayWord === 'weekday' || dayWord === 'weekdays') {
        dayOfWeek = '1-5';
        dayName = 'hari kerja (Senin-Jumat)';
      } else if (INDONESIAN_DAYS[dayWord] !== undefined) {
        dayOfWeek = String(INDONESIAN_DAYS[dayWord]);
        dayName = dayWord.charAt(0).toUpperCase() + dayWord.slice(1);
      } else if (ENGLISH_DAYS[dayWord] !== undefined) {
        dayOfWeek = String(ENGLISH_DAYS[dayWord]);
        dayName = dayWord.charAt(0).toUpperCase() + dayWord.slice(1);
      }

      const cronExpr = `${minute} ${hour} * * ${dayOfWeek}`;
      try {
        CronParser.validateMinimumInterval(cronExpr, MIN_RECURRING_INTERVAL_MINUTES, timezone);
      } catch (err: unknown) {
        return {
          success: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      const prompt = this.cleanPrompt(raw.replace(recurringTimeMatch[0], ''));
      const name = this.deriveName(prompt, `Tugas ${dayName} ${hour}:${minute.toString().padStart(2, '0')}`);
      const nextRun = CronParser.getNextRun(cronExpr, referenceDate, timezone);

      return {
        success: true,
        name,
        prompt,
        scheduleType: 'recurring',
        cronExpression: cronExpr,
        timezone,
        missedRunPolicy: 'skip',
        summary: `Jadwal berulang "${name}" setiap ${dayName} pukul ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${timezone}). Eksekusi berikutnya: ${nextRun.toISOString()}.`,
      };
    }

    // 6. Deteksi jadwal one-off spesifik tanggal ISO / YYYY-MM-DD
    const isoDateMatch = raw.match(/\b(\d{4}-\d{2}-\d{2})(?:[T\s](?:jam|pukul|at)?\s*(\d{1,2})[.:](\d{2}))?\b/i);
    if (isoDateMatch && isoDateMatch[1]) {
      const dateStr = isoDateMatch[1];
      const hourStr = isoDateMatch[2] ?? '09';
      const minStr = isoDateMatch[3] ?? '00';
      const targetIso = `${dateStr}T${hourStr.padStart(2, '0')}:${minStr.padStart(2, '0')}:00`;

      const targetDate = new Date(`${targetIso}+07:00`);
      if (isNaN(targetDate.getTime())) {
        return {
          success: false,
          reason: `Format tanggal tidak valid: "${targetIso}".`,
        };
      }

      if (targetDate.getTime() <= referenceDate.getTime()) {
        return {
          success: false,
          reason: `Waktu eksekusi (${targetDate.toISOString()}) harus berada di masa depan.`,
        };
      }

      const prompt = this.cleanPrompt(raw.replace(isoDateMatch[0], ''));
      const name = this.deriveName(prompt, `Tugas ${dateStr}`);

      return {
        success: true,
        name,
        prompt,
        scheduleType: 'one_off',
        runAt: targetDate.toISOString(),
        timezone,
        missedRunPolicy: 'skip',
        summary: `Jadwal satu kali "${name}" dijadwalkan pada ${targetDate.toISOString()} (${timezone}).`,
      };
    }

    // 7. Deteksi one-off relatif: "besok jam HH:MM", "besok lusa jam HH:MM", "tomorrow at HH:MM"
    const relativeDayMatch = raw.match(
      /\b(besok\s+lusa|besok|esok|tomorrow)\s+(?:jam|pukul|at)\s*(\d{1,2})[.:](\d{2})\b/i,
    );
    if (relativeDayMatch && relativeDayMatch[1]) {
      const relWord = relativeDayMatch[1].toLowerCase();
      const hour = parseInt(relativeDayMatch[2] ?? '0', 10);
      const minute = parseInt(relativeDayMatch[3] ?? '0', 10);

      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return {
          success: false,
          reason: `Waktu tidak valid: ${hour}:${minute}. Jam harus 0-23 dan menit 0-59.`,
        };
      }

      const daysToAdd = relWord.includes('lusa') ? 2 : 1;
      const targetDate = this.buildZonedDate(referenceDate, daysToAdd, hour, minute, timezone);

      const prompt = this.cleanPrompt(raw.replace(relativeDayMatch[0], ''));
      const name = this.deriveName(prompt, `Tugas ${relWord} ${hour}:${minute.toString().padStart(2, '0')}`);

      return {
        success: true,
        name,
        prompt,
        scheduleType: 'one_off',
        runAt: targetDate.toISOString(),
        timezone,
        missedRunPolicy: 'skip',
        summary: `Jadwal satu kali "${name}" dijadwalkan untuk ${relWord} pukul ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${timezone}). Eksekusi pada: ${targetDate.toISOString()}.`,
      };
    }

    // 8. Deteksi one-off relatif offset: "dalam X jam", "dalam Y menit", "in X hours"
    const relativeOffsetMatch = raw.match(
      /\b(?:dalam|in)\s+(\d+)\s+(jam|hours?|menit|minutes?|mins?)\b/i,
    );
    if (relativeOffsetMatch && relativeOffsetMatch[1]) {
      const amount = parseInt(relativeOffsetMatch[1], 10);
      const unit = (relativeOffsetMatch[2] ?? '').toLowerCase();
      let msToAdd = 0;

      if (unit.startsWith('jam') || unit.startsWith('hour')) {
        msToAdd = amount * 60 * 60 * 1000;
      } else {
        msToAdd = amount * 60 * 1000;
      }

      const targetDate = new Date(referenceDate.getTime() + msToAdd);
      const prompt = this.cleanPrompt(raw.replace(relativeOffsetMatch[0], ''));
      const name = this.deriveName(prompt, `Tugas dalam ${amount} ${unit}`);

      return {
        success: true,
        name,
        prompt,
        scheduleType: 'one_off',
        runAt: targetDate.toISOString(),
        timezone,
        missedRunPolicy: 'skip',
        summary: `Jadwal satu kali "${name}" dijadwalkan dalam ${amount} ${unit}. Eksekusi pada: ${targetDate.toISOString()} (${timezone}).`,
      };
    }

    // Jika tidak cocok dengan pola apa pun yang deterministik
    return {
      success: false,
      reason:
        'Instruksi tidak dapat dipahami sebagai jadwal yang terverifikasi. Sertakan frekuensi (misal: "setiap hari jam 09:00 WIB") atau waktu mulai spesifik (misal: "besok jam 14:00 WIB").',
    };
  }

  /**
   * Menghitung tanggal yang disesuaikan dengan zona waktu tertentu
   */
  private static buildZonedDate(
    refDate: Date,
    daysToAdd: number,
    targetHour: number,
    targetMinute: number,
    timezone: string,
  ): Date {
    const future = new Date(refDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    const futureZoned = CronParser.getZonedParts(future, timezone);

    const candidate = new Date(refDate.getTime() + (daysToAdd - 1) * 24 * 60 * 60 * 1000);
    candidate.setUTCSeconds(0, 0);

    for (let m = 0; m < 48 * 60; m++) {
      candidate.setTime(candidate.getTime() + 60000);
      const parts = CronParser.getZonedParts(candidate, timezone);
      if (
        parts.day === futureZoned.day &&
        parts.hour === targetHour &&
        parts.minute === targetMinute
      ) {
        return candidate;
      }
    }

    return new Date(refDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  }

  /**
   * Membersihkan teks prompt dari kata pengantar penjadwalan
   */
  private static cleanPrompt(text: string): string {
    return text
      .replace(/^(?:tolong\s+)?(?:ingatkan\s+saya\s+(?:untuk\s+)?|jadwalkan\s+(?:tugas\s+)?|remind\s+me\s+to\s+|schedule\s+(?:a\s+task\s+to\s+)?)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Menghasilkan nama ringkas yang deskriptif
   */
  private static deriveName(prompt: string, fallback: string): string {
    if (!prompt) return fallback;
    const clean = prompt.charAt(0).toUpperCase() + prompt.slice(1);
    if (clean.length > 50) {
      return clean.slice(0, 47) + '...';
    }
    return clean;
  }
}
