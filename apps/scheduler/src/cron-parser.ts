import { SchedulerError } from './types.ts';

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export class CronParser {
  private static parseField(
    field: string,
    min: number,
    max: number,
    aliasZeroToSeven = false,
  ): Set<number> {
    const result = new Set<number>();
    const parts = field.split(',');

    for (const part of parts) {
      if (part === '*') {
        for (let i = min; i <= max; i++) result.add(i);
      } else if (part.startsWith('*/')) {
        const step = parseInt(part.slice(2), 10);
        if (isNaN(step) || step <= 0) {
          throw new SchedulerError(`Invalid cron step expression: ${part}`);
        }
        for (let i = min; i <= max; i += step) result.add(i);
      } else if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr ?? '', 10);
        const end = parseInt(endStr ?? '', 10);
        if (isNaN(start) || isNaN(end) || start > end || start < min || end > max) {
          throw new SchedulerError(`Invalid cron range: ${part}`);
        }
        for (let i = start; i <= end; i++) result.add(i);
      } else {
        const val = parseInt(part, 10);
        if (isNaN(val) || val < min || val > max) {
          throw new SchedulerError(
            `Invalid cron value: ${part} (must be between ${min} and ${max})`,
          );
        }
        result.add(val);
      }
    }

    if (aliasZeroToSeven && result.has(7)) {
      result.add(0); // In cron, 7 is Sunday, which maps to 0
    }

    return result;
  }

  static parse(expression: string): ParsedCron {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new SchedulerError(
        `Cron expression must have exactly 5 fields, received ${fields.length}: "${expression}"`,
      );
    }

    const [minStr, hourStr, domStr, monthStr, dowStr] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];

    return {
      minutes: this.parseField(minStr, 0, 59),
      hours: this.parseField(hourStr, 0, 23),
      daysOfMonth: this.parseField(domStr, 1, 31),
      months: this.parseField(monthStr, 1, 12),
      daysOfWeek: this.parseField(dowStr, 0, 7, true),
    };
  }

  /**
   * Helper to extract wall-clock components in the target timezone
   */
  static getZonedParts(
    date: Date,
    timezone: string,
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    dayOfWeek: number;
  } {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        weekday: 'short',
        hourCycle: 'h23',
      });

      const parts = formatter.formatToParts(date);
      let year = 1970;
      let month = 1;
      let day = 1;
      let hour = 0;
      let minute = 0;
      let second = 0;
      let dayOfWeek = 0;

      for (const p of parts) {
        if (p.type === 'year') year = parseInt(p.value, 10);
        else if (p.type === 'month') month = parseInt(p.value, 10);
        else if (p.type === 'day') day = parseInt(p.value, 10);
        else if (p.type === 'hour') hour = parseInt(p.value, 10);
        else if (p.type === 'minute') minute = parseInt(p.value, 10);
        else if (p.type === 'second') second = parseInt(p.value, 10);
        else if (p.type === 'weekday') {
          const map: Record<string, number> = {
            Sun: 0,
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6,
          };
          dayOfWeek = map[p.value] ?? 0;
        }
      }

      return { year, month, day, hour, minute, second, dayOfWeek };
    } catch {
      throw new SchedulerError(`Invalid or unsupported timezone: "${timezone}"`);
    }
  }

  /**
   * Compute the next execution Date matching the cron expression after `afterDate`.
   */
  static getNextRun(expression: string, afterDate: Date, timezone = 'UTC'): Date {
    const parsed = this.parse(expression);
    // Start searching from 1 minute after afterDate
    const candidate = new Date(afterDate.getTime() + 60000);
    // Truncate seconds and ms
    candidate.setUTCSeconds(0, 0);

    // Limit search to 5 years forward to prevent infinite loops on impossible dates
    const maxIterations = 60 * 24 * 365 * 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      const zoned = this.getZonedParts(candidate, timezone);

      if (
        parsed.months.has(zoned.month) &&
        parsed.daysOfMonth.has(zoned.day) &&
        parsed.daysOfWeek.has(zoned.dayOfWeek) &&
        parsed.hours.has(zoned.hour) &&
        parsed.minutes.has(zoned.minute)
      ) {
        return candidate;
      }

      // Advance by 1 minute
      candidate.setTime(candidate.getTime() + 60000);
      iteration++;
    }

    throw new SchedulerError(
      `No upcoming execution found within 5 years for cron expression: "${expression}"`,
    );
  }

  /**
   * Memvalidasi bahwa interval antara dua eksekusi cron berturut-turut
   * tidak lebih cepat dari minMinutes (default: 15 menit).
   */
  static validateMinimumInterval(expression: string, minMinutes = 15, timezone = 'UTC'): void {
    const now = new Date();
    const first = this.getNextRun(expression, now, timezone);
    const second = this.getNextRun(expression, first, timezone);
    const diffMs = second.getTime() - first.getTime();
    const minMs = minMinutes * 60 * 1000;
    if (diffMs < minMs) {
      const diffMinutes = Math.round(diffMs / 60000);
      throw new SchedulerError(
        `Frekuensi jadwal (${diffMinutes} menit) terlalu sering. Batas minimum adalah ${minMinutes} menit untuk menghemat sumber daya sistem.`,
      );
    }
  }
}

