import type { BudgetConfig, BudgetUsed } from './types.ts';

export class BudgetTracker {
  private readonly config: BudgetConfig;
  private readonly startTime: number;
  private searchesCount = 0;
  private pagesReadCount = 0;
  private modelTokensCount = 0;

  constructor(config: BudgetConfig, initialUsed?: Partial<BudgetUsed>) {
    this.config = config;
    this.startTime = Date.now() - (initialUsed?.durationMs ?? 0);
    this.searchesCount = initialUsed?.searchesCount ?? 0;
    this.pagesReadCount = initialUsed?.pagesReadCount ?? 0;
    this.modelTokensCount = initialUsed?.modelTokensCount ?? 0;
  }

  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  getUsed(): BudgetUsed {
    return {
      searchesCount: this.searchesCount,
      pagesReadCount: this.pagesReadCount,
      modelTokensCount: this.modelTokensCount,
      durationMs: Math.max(0, Date.now() - this.startTime),
    };
  }

  canSearch(): boolean {
    return (
      this.searchesCount < this.config.maxSearches &&
      this.getUsed().durationMs < this.config.maxDurationMs
    );
  }

  recordSearch(count = 1): void {
    this.searchesCount += count;
  }

  canReadPage(): boolean {
    return (
      this.pagesReadCount < this.config.maxPagesRead &&
      this.getUsed().durationMs < this.config.maxDurationMs
    );
  }

  recordPage(count = 1): void {
    this.pagesReadCount += count;
  }

  canConsumeTokens(estimatedTokens = 100): boolean {
    return (
      this.modelTokensCount + estimatedTokens <= this.config.maxModelTokens &&
      this.getUsed().durationMs < this.config.maxDurationMs
    );
  }

  recordTokens(tokens: number): void {
    this.modelTokensCount += Math.max(0, tokens);
  }

  isDurationExceeded(): boolean {
    return this.getUsed().durationMs >= this.config.maxDurationMs;
  }

  isBudgetExhausted(): { exhausted: boolean; reason?: string } {
    if (this.isDurationExceeded()) {
      return {
        exhausted: true,
        reason: `Batas durasi waktu tercapai (${this.getUsed().durationMs} ms >= ${this.config.maxDurationMs} ms).`,
      };
    }
    if (
      this.searchesCount >= this.config.maxSearches &&
      this.pagesReadCount >= this.config.maxPagesRead
    ) {
      return {
        exhausted: true,
        reason: `Batas kuota pencarian (${this.searchesCount}/${this.config.maxSearches}) dan baca halaman (${this.pagesReadCount}/${this.config.maxPagesRead}) tercapai.`,
      };
    }
    if (this.modelTokensCount >= this.config.maxModelTokens) {
      return {
        exhausted: true,
        reason: `Batas pagu token model tercapai (${this.modelTokensCount} >= ${this.config.maxModelTokens}).`,
      };
    }
    return { exhausted: false };
  }
}
