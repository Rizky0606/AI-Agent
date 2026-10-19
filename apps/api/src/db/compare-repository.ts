import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.ts';
import {
  compareResults,
  type CompareResultRow,
  compareRuns,
  type CompareRunRow,
} from './schema.ts';

export type { CompareRunRow, CompareResultRow };

export interface CreateCompareRunParams {
  id?: string | undefined;
  userId: string;
  projectId: string;
  prompt: string;
  models: string[];
  blindMode?: boolean | undefined;
  tokenBudget?: number | undefined;
}

export interface ListCompareRunsFilter {
  projectId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CompareRunDetails {
  run: CompareRunRow;
  results: CompareResultRow[];
}

export interface CompareRepository {
  createRun(params: CreateCompareRunParams): Promise<CompareRunDetails>;
  getRun(userId: string, runId: string): Promise<CompareRunRow | null>;
  getRunDetails(userId: string, runId: string): Promise<CompareRunDetails | null>;
  listRuns(
    userId: string,
    filter?: ListCompareRunsFilter,
  ): Promise<{ runs: CompareRunRow[]; total: number }>;
  updateResult(
    runId: string,
    columnIndex: number,
    updates: {
      content?: string | undefined;
      status?: string | undefined;
      error?: string | null | undefined;
      latencyMs?: number | undefined;
      promptTokens?: number | undefined;
      completionTokens?: number | undefined;
      totalTokens?: number | undefined;
      cost?: number | undefined;
      isWinner?: boolean | undefined;
    },
  ): Promise<CompareResultRow | null>;
  updateRunStatus(
    userId: string,
    runId: string,
    status: string,
    updates?: {
      totalTokensUsed?: number | undefined;
      error?: string | null | undefined;
    },
  ): Promise<CompareRunRow | null>;
  revealRun(userId: string, runId: string): Promise<CompareRunRow | null>;
  selectWinner(userId: string, runId: string, resultId: string): Promise<CompareRunDetails | null>;
  saveSynthesis(
    userId: string,
    runId: string,
    synthesis: {
      status: string;
      model: string;
      content: string;
      usage?: Record<string, unknown> | undefined;
    },
  ): Promise<CompareRunRow | null>;
  deleteRun(userId: string, runId: string): Promise<boolean>;
}

export class SqlCompareRepository implements CompareRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createRun(params: CreateCompareRunParams): Promise<CompareRunDetails> {
    const aliases = ['Model A', 'Model B', 'Model C'];
    const runId = params.id ?? crypto.randomUUID();

    const [run] = await this.db
      .insert(compareRuns)
      .values({
        id: runId,
        userId: params.userId,
        projectId: params.projectId,
        prompt: params.prompt,
        blindMode: params.blindMode ?? false,
        status: 'running',
        tokenBudget: params.tokenBudget ?? 4000,
        totalTokensUsed: 0,
        synthesisStatus: 'none',
        revealed: false,
      })
      .returning();

    if (!run) {
      throw new Error('Gagal membuat baris compare_runs di basis data.');
    }

    const resultRows = params.models.map((modelId, columnIndex) => ({
      runId,
      modelId,
      modelAlias: aliases[columnIndex] ?? `Model ${columnIndex + 1}`,
      columnIndex,
      content: '',
      status: 'pending',
      isWinner: false,
    }));

    const results = await this.db
      .insert(compareResults)
      .values(resultRows)
      .returning();

    return { run, results };
  }

  async getRun(userId: string, runId: string): Promise<CompareRunRow | null> {
    const [row] = await this.db
      .select()
      .from(compareRuns)
      .where(and(eq(compareRuns.id, runId), eq(compareRuns.userId, userId)));
    return row ?? null;
  }

  async getRunDetails(userId: string, runId: string): Promise<CompareRunDetails | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;

    const results = await this.db
      .select()
      .from(compareResults)
      .where(eq(compareResults.runId, runId))
      .orderBy(compareResults.columnIndex);

    return { run, results };
  }

  async listRuns(
    userId: string,
    filter?: ListCompareRunsFilter,
  ): Promise<{ runs: CompareRunRow[]; total: number }> {
    const conditions = [eq(compareRuns.userId, userId)];
    if (filter?.projectId) {
      conditions.push(eq(compareRuns.projectId, filter.projectId));
    }

    const whereClause = and(...conditions);
    const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
    const offset = Math.max(0, filter?.offset ?? 0);

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(compareRuns)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const runs = await this.db
      .select()
      .from(compareRuns)
      .where(whereClause)
      .orderBy(desc(compareRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return { runs, total };
  }

  async updateResult(
    runId: string,
    columnIndex: number,
    updates: {
      content?: string | undefined;
      status?: string | undefined;
      error?: string | null | undefined;
      latencyMs?: number | undefined;
      promptTokens?: number | undefined;
      completionTokens?: number | undefined;
      totalTokens?: number | undefined;
      cost?: number | undefined;
      isWinner?: boolean | undefined;
    },
  ): Promise<CompareResultRow | null> {
    const updateValues: Partial<CompareResultRow> = {};
    if (updates.content !== undefined) updateValues.content = updates.content;
    if (updates.status !== undefined) updateValues.status = updates.status;
    if (updates.error !== undefined) updateValues.error = updates.error;
    if (updates.latencyMs !== undefined) updateValues.latencyMs = updates.latencyMs;
    if (updates.promptTokens !== undefined) updateValues.promptTokens = updates.promptTokens;
    if (updates.completionTokens !== undefined) updateValues.completionTokens = updates.completionTokens;
    if (updates.totalTokens !== undefined) updateValues.totalTokens = updates.totalTokens;
    if (updates.cost !== undefined) updateValues.cost = updates.cost;
    if (updates.isWinner !== undefined) updateValues.isWinner = updates.isWinner;

    const [row] = await this.db
      .update(compareResults)
      .set(updateValues)
      .where(
        and(
          eq(compareResults.runId, runId),
          eq(compareResults.columnIndex, columnIndex),
        ),
      )
      .returning();

    return row ?? null;
  }

  async updateRunStatus(
    userId: string,
    runId: string,
    status: string,
    updates?: {
      totalTokensUsed?: number | undefined;
      error?: string | null | undefined;
    },
  ): Promise<CompareRunRow | null> {
    const setValues: Partial<CompareRunRow> = {
      status,
      updatedAt: new Date(),
    };
    if (updates?.totalTokensUsed !== undefined) {
      setValues.totalTokensUsed = updates.totalTokensUsed;
    }
    if (updates?.error !== undefined) {
      setValues.error = updates.error;
    }

    const [row] = await this.db
      .update(compareRuns)
      .set(setValues)
      .where(and(eq(compareRuns.id, runId), eq(compareRuns.userId, userId)))
      .returning();

    return row ?? null;
  }

  async revealRun(userId: string, runId: string): Promise<CompareRunRow | null> {
    const [row] = await this.db
      .update(compareRuns)
      .set({
        revealed: true,
        revealedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(compareRuns.id, runId), eq(compareRuns.userId, userId)))
      .returning();

    return row ?? null;
  }

  async selectWinner(
    userId: string,
    runId: string,
    resultId: string,
  ): Promise<CompareRunDetails | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;

    // Find result to get modelId
    const [targetResult] = await this.db
      .select()
      .from(compareResults)
      .where(and(eq(compareResults.id, resultId), eq(compareResults.runId, runId)));

    if (!targetResult) return null;

    // Mark winner on results
    await this.db
      .update(compareResults)
      .set({ isWinner: false })
      .where(eq(compareResults.runId, runId));

    await this.db
      .update(compareResults)
      .set({ isWinner: true })
      .where(eq(compareResults.id, resultId));

    // Update run with winnerModelId and reveal
    const [updatedRun] = await this.db
      .update(compareRuns)
      .set({
        winnerModelId: targetResult.modelId,
        revealed: true,
        revealedAt: run.revealedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(compareRuns.id, runId), eq(compareRuns.userId, userId)))
      .returning();

    const results = await this.db
      .select()
      .from(compareResults)
      .where(eq(compareResults.runId, runId))
      .orderBy(compareResults.columnIndex);

    return { run: updatedRun ?? run, results };
  }

  async saveSynthesis(
    userId: string,
    runId: string,
    synthesis: {
      status: string;
      model: string;
      content: string;
      usage?: Record<string, unknown> | undefined;
    },
  ): Promise<CompareRunRow | null> {
    const [row] = await this.db
      .update(compareRuns)
      .set({
        synthesisStatus: synthesis.status,
        synthesisModel: synthesis.model,
        synthesisContent: synthesis.content,
        synthesisUsage: synthesis.usage ?? {},
        updatedAt: new Date(),
      })
      .where(and(eq(compareRuns.id, runId), eq(compareRuns.userId, userId)))
      .returning();

    return row ?? null;
  }

  async deleteRun(userId: string, runId: string): Promise<boolean> {
    const run = await this.getRun(userId, runId);
    if (!run) return false;

    await this.db
      .delete(compareRuns)
      .where(and(eq(compareRuns.id, runId), eq(compareRuns.userId, userId)));

    return true;
  }
}

export class InMemoryCompareRepository implements CompareRepository {
  private readonly runs = new Map<string, CompareRunRow>();
  private readonly results = new Map<string, CompareResultRow[]>();

  async createRun(params: CreateCompareRunParams): Promise<CompareRunDetails> {
    const aliases = ['Model A', 'Model B', 'Model C'];
    const runId = params.id ?? crypto.randomUUID();
    const now = new Date();

    const run: CompareRunRow = {
      id: runId,
      userId: params.userId,
      projectId: params.projectId,
      prompt: params.prompt,
      blindMode: params.blindMode ?? false,
      status: 'running',
      winnerModelId: null,
      revealed: false,
      revealedAt: null,
      synthesisStatus: 'none',
      synthesisModel: null,
      synthesisContent: null,
      synthesisUsage: {},
      tokenBudget: params.tokenBudget ?? 4000,
      totalTokensUsed: 0,
      error: null,
      updatedAt: now,
      createdAt: now,
    };

    const runResults: CompareResultRow[] = params.models.map((modelId, columnIndex) => ({
      id: crypto.randomUUID(),
      runId,
      modelId,
      modelAlias: aliases[columnIndex] ?? `Model ${columnIndex + 1}`,
      columnIndex,
      content: '',
      status: 'pending',
      error: null,
      latencyMs: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cost: null,
      isWinner: false,
      createdAt: now,
    }));

    this.runs.set(runId, run);
    this.results.set(runId, runResults);

    return { run, results: runResults };
  }

  async getRun(userId: string, runId: string): Promise<CompareRunRow | null> {
    const run = this.runs.get(runId);
    if (!run || run.userId !== userId) return null;
    return run;
  }

  async getRunDetails(userId: string, runId: string): Promise<CompareRunDetails | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    const res = this.results.get(runId) ?? [];
    return { run, results: [...res].sort((a, b) => a.columnIndex - b.columnIndex) };
  }

  async listRuns(
    userId: string,
    filter?: ListCompareRunsFilter,
  ): Promise<{ runs: CompareRunRow[]; total: number }> {
    let all = Array.from(this.runs.values()).filter((r) => r.userId === userId);
    if (filter?.projectId) {
      all = all.filter((r) => r.projectId === filter.projectId);
    }
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = all.length;
    const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
    const offset = Math.max(0, filter?.offset ?? 0);
    const paginated = all.slice(offset, offset + limit);
    return { runs: paginated, total };
  }

  async updateResult(
    runId: string,
    columnIndex: number,
    updates: {
      content?: string | undefined;
      status?: string | undefined;
      error?: string | null | undefined;
      latencyMs?: number | undefined;
      promptTokens?: number | undefined;
      completionTokens?: number | undefined;
      totalTokens?: number | undefined;
      cost?: number | undefined;
      isWinner?: boolean | undefined;
    },
  ): Promise<CompareResultRow | null> {
    const list = this.results.get(runId);
    if (!list) return null;
    const item = list.find((r) => r.columnIndex === columnIndex);
    if (!item) return null;

    if (updates.content !== undefined) item.content = updates.content;
    if (updates.status !== undefined) item.status = updates.status;
    if (updates.error !== undefined) item.error = updates.error;
    if (updates.latencyMs !== undefined) item.latencyMs = updates.latencyMs;
    if (updates.promptTokens !== undefined) item.promptTokens = updates.promptTokens;
    if (updates.completionTokens !== undefined) item.completionTokens = updates.completionTokens;
    if (updates.totalTokens !== undefined) item.totalTokens = updates.totalTokens;
    if (updates.cost !== undefined) item.cost = updates.cost;
    if (updates.isWinner !== undefined) item.isWinner = updates.isWinner;

    return item;
  }

  async updateRunStatus(
    userId: string,
    runId: string,
    status: string,
    updates?: {
      totalTokensUsed?: number | undefined;
      error?: string | null | undefined;
    },
  ): Promise<CompareRunRow | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    run.status = status;
    run.updatedAt = new Date();
    if (updates?.totalTokensUsed !== undefined) {
      run.totalTokensUsed = updates.totalTokensUsed;
    }
    if (updates?.error !== undefined) {
      run.error = updates.error;
    }
    return run;
  }

  async revealRun(userId: string, runId: string): Promise<CompareRunRow | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    run.revealed = true;
    run.revealedAt = new Date();
    run.updatedAt = new Date();
    return run;
  }

  async selectWinner(
    userId: string,
    runId: string,
    resultId: string,
  ): Promise<CompareRunDetails | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    const list = this.results.get(runId);
    if (!list) return null;

    const target = list.find((r) => r.id === resultId);
    if (!target) return null;

    for (const res of list) {
      res.isWinner = res.id === resultId;
    }

    run.winnerModelId = target.modelId;
    run.revealed = true;
    run.revealedAt = run.revealedAt ?? new Date();
    run.updatedAt = new Date();

    return { run, results: list };
  }

  async saveSynthesis(
    userId: string,
    runId: string,
    synthesis: {
      status: string;
      model: string;
      content: string;
      usage?: Record<string, unknown> | undefined;
    },
  ): Promise<CompareRunRow | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    run.synthesisStatus = synthesis.status;
    run.synthesisModel = synthesis.model;
    run.synthesisContent = synthesis.content;
    run.synthesisUsage = synthesis.usage ?? {};
    run.updatedAt = new Date();
    return run;
  }

  async deleteRun(userId: string, runId: string): Promise<boolean> {
    const run = await this.getRun(userId, runId);
    if (!run) return false;
    this.runs.delete(runId);
    this.results.delete(runId);
    return true;
  }
}
