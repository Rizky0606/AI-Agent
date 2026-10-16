/**
 * Per-key execution caps: at most `maxInFlight` calls running at once, and at most
 * `maxStartsPerInterval` calls started per rolling interval.
 *
 * Calls beyond a cap fail fast with `ExecutionLimitExceededError` instead of queueing, so a
 * runaway task cannot pile unbounded work onto an MCP server or the runtime bridge. The key is
 * the tool name, or `runtime:<id>` for runtime bridge calls.
 *
 * ponytail: in-memory and per-process. If several worker processes must share one budget, back
 * this with Redis.
 */
export interface ExecutionLimiterOptions {
  maxInFlight: number;
  maxStartsPerInterval: number;
  /** Rolling window for `maxStartsPerInterval`; defaults to one minute. */
  intervalMs?: number | undefined;
}

export type ExecutionLimit = 'in_flight' | 'starts_per_interval';

export class ExecutionLimitExceededError extends Error {
  readonly key: string;
  readonly limit: ExecutionLimit;

  constructor(key: string, limit: ExecutionLimit, max: number, intervalMs?: number | undefined) {
    super(
      limit === 'in_flight'
        ? `Batas eksekusi bersamaan untuk '${key}' tercapai: maksimum ${max} pemanggilan berjalan sekaligus.`
        : `Batas laju pemanggilan '${key}' tercapai: maksimum ${max} pemanggilan per ${intervalMs}ms.`,
    );
    this.name = 'ExecutionLimitExceededError';
    this.key = key;
    this.limit = limit;
  }
}

const DEFAULT_INTERVAL_MS = 60_000;

function positiveEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export class ExecutionLimiter {
  private readonly maxInFlight: number;
  private readonly maxStartsPerInterval: number;
  private readonly intervalMs: number;
  private readonly inFlight = new Map<string, number>();
  private readonly startTimes = new Map<string, number[]>();

  constructor(options: ExecutionLimiterOptions) {
    this.maxInFlight = options.maxInFlight;
    this.maxStartsPerInterval = options.maxStartsPerInterval;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /**
   * Reads `<prefix>_MAX_IN_FLIGHT` and `<prefix>_MAX_STARTS_PER_MINUTE`, falling back to the
   * defaults when unset or not a positive number.
   */
  static fromEnv(prefix: string, defaults: ExecutionLimiterOptions): ExecutionLimiter {
    return new ExecutionLimiter({
      maxInFlight: positiveEnv(`${prefix}_MAX_IN_FLIGHT`, defaults.maxInFlight),
      maxStartsPerInterval: positiveEnv(`${prefix}_MAX_STARTS_PER_MINUTE`, defaults.maxStartsPerInterval),
    });
  }

  /** Reserves a slot for `key`, or throws `ExecutionLimitExceededError` when a cap is hit. */
  acquire(key: string): void {
    const inFlight = this.inFlight.get(key) ?? 0;
    if (inFlight >= this.maxInFlight) {
      throw new ExecutionLimitExceededError(key, 'in_flight', this.maxInFlight);
    }

    const windowStart = Date.now() - this.intervalMs;
    const starts = (this.startTimes.get(key) ?? []).filter((startedAt) => startedAt > windowStart);
    if (starts.length >= this.maxStartsPerInterval) {
      throw new ExecutionLimitExceededError(
        key,
        'starts_per_interval',
        this.maxStartsPerInterval,
        this.intervalMs,
      );
    }

    starts.push(Date.now());
    this.startTimes.set(key, starts);
    this.inFlight.set(key, inFlight + 1);
  }

  /** Frees the slot reserved by a successful `acquire`; unknown keys are ignored. */
  release(key: string): void {
    const inFlight = this.inFlight.get(key) ?? 0;
    if (inFlight > 1) {
      this.inFlight.set(key, inFlight - 1);
      return;
    }
    this.inFlight.delete(key);
  }
}
