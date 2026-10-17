export class ConcurrencyLimiter {
  private readonly maxConcurrency: number;
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrency = 3) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  async mapAll<T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    return Promise.all(items.map((item, index) => this.run(() => fn(item, index))));
  }
}
