/**
 * StreamThrottler batches rapid text delta emissions during streaming,
 * flushing them at a bounded rate (e.g. intervalMs: 50ms) to prevent
 * excessive React component re-renders per individual token.
 */
export interface StreamThrottlerOptions {
  intervalMs?: number;
  onFlush: (accumulatedDelta: string) => void;
}

export class StreamThrottler {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalMs: number;
  private onFlush: (accumulatedDelta: string) => void;

  constructor(options: StreamThrottlerOptions) {
    this.intervalMs = options.intervalMs ?? 50;
    this.onFlush = options.onFlush;
  }

  append(delta: string): void {
    this.buffer += delta;
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.intervalMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const delta = this.buffer;
      this.buffer = '';
      this.onFlush(delta);
    }
  }

  reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = '';
  }

  getPending(): string {
    return this.buffer;
  }
}
