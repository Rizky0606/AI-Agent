import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.ts';
import {
  researchEvidence,
  type ResearchEvidenceRow,
  researchReports,
  type ResearchReportRow,
  researchRuns,
  type ResearchRunRow,
  researchSources,
  type ResearchSourceRow,
} from './schema.ts';

export type { ResearchRunRow, ResearchSourceRow, ResearchEvidenceRow, ResearchReportRow };

export interface CreateResearchRunParams {
  userId: string;
  projectId: string;
  query: string;
  scope?: string | undefined;
  language?: string | undefined;
  depth?: string | undefined;
  budgetConfig: Record<string, unknown>;
  plan?: Record<string, unknown> | undefined;
}

export interface ListResearchRunsFilter {
  projectId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ResearchRepository {
  createRun(params: CreateResearchRunParams): Promise<ResearchRunRow>;
  getRun(userId: string, runId: string): Promise<ResearchRunRow | null>;
  listRuns(
    userId: string,
    filter?: ListResearchRunsFilter,
  ): Promise<{ runs: ResearchRunRow[]; total: number }>;
  updateRunStatus(
    userId: string,
    runId: string,
    status: string,
    updates?: {
      plan?: Record<string, unknown> | undefined;
      checkpoint?: Record<string, unknown> | undefined;
      error?: string | null | undefined;
      budgetUsed?: Record<string, unknown> | undefined;
    },
  ): Promise<ResearchRunRow>;
  saveSources(
    runId: string,
    sources: Array<{
      sourceId: string;
      url: string;
      title: string;
      domain: string;
      credibilityScore?: number | undefined;
      fetchStatus?: string | undefined;
      contentHash?: string | undefined;
      snippet?: string | undefined;
    }>,
  ): Promise<ResearchSourceRow[]>;
  getSources(runId: string): Promise<ResearchSourceRow[]>;
  saveEvidence(
    runId: string,
    evidenceItems: Array<{
      sourceId: string;
      statement: string;
      claimType?: string | undefined;
      quote?: string | undefined;
      confidence?: number | undefined;
      verified?: boolean | undefined;
    }>,
  ): Promise<ResearchEvidenceRow[]>;
  getEvidence(runId: string): Promise<ResearchEvidenceRow[]>;
  saveReport(
    runId: string,
    report: {
      title: string;
      contentMarkdown: string;
      confidenceBySection?: Record<string, number> | undefined;
      gaps?: string[] | undefined;
      limitations?: string[] | undefined;
      summary: string;
    },
  ): Promise<ResearchReportRow>;
  getReport(runId: string): Promise<ResearchReportRow | null>;
  getRunDetails(
    userId: string,
    runId: string,
  ): Promise<{
    run: ResearchRunRow;
    sources: ResearchSourceRow[];
    evidence: ResearchEvidenceRow[];
    report: ResearchReportRow | null;
  } | null>;
  deleteRun(userId: string, runId: string): Promise<boolean>;
}

export class DrizzleResearchRepository implements ResearchRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createRun(params: CreateResearchRunParams): Promise<ResearchRunRow> {
    const [row] = await this.db
      .insert(researchRuns)
      .values({
        userId: params.userId,
        projectId: params.projectId,
        query: params.query,
        scope: params.scope ?? 'general',
        language: params.language ?? 'id',
        depth: params.depth ?? 'standard',
        status: 'queued',
        budgetConfig: params.budgetConfig,
        budgetUsed: {},
        plan: params.plan ?? null,
      })
      .returning();

    if (!row) {
      throw new Error('Gagal membuat baris research_runs.');
    }
    return row;
  }

  async getRun(userId: string, runId: string): Promise<ResearchRunRow | null> {
    const [row] = await this.db
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async listRuns(
    userId: string,
    filter?: ListResearchRunsFilter,
  ): Promise<{ runs: ResearchRunRow[]; total: number }> {
    const conditions = [eq(researchRuns.userId, userId)];
    if (filter?.projectId) {
      conditions.push(eq(researchRuns.projectId, filter.projectId));
    }
    if (filter?.status) {
      conditions.push(eq(researchRuns.status, filter.status));
    }

    const whereClause = and(...conditions);
    const limit = Math.min(Math.max(filter?.limit ?? 20, 1), 100);
    const offset = Math.max(filter?.offset ?? 0, 0);

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(researchRuns)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const rows = await this.db
      .select()
      .from(researchRuns)
      .where(whereClause)
      .orderBy(desc(researchRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return { runs: rows, total };
  }

  async updateRunStatus(
    userId: string,
    runId: string,
    status: string,
    updates?: {
      plan?: Record<string, unknown> | undefined;
      checkpoint?: Record<string, unknown> | undefined;
      error?: string | null | undefined;
      budgetUsed?: Record<string, unknown> | undefined;
    },
  ): Promise<ResearchRunRow> {
    const values: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (updates?.plan !== undefined) {
      values.plan = updates.plan;
    }
    if (updates?.checkpoint !== undefined) {
      values.checkpoint = updates.checkpoint;
    }
    if (updates?.error !== undefined) {
      values.error = updates.error;
    }
    if (updates?.budgetUsed !== undefined) {
      values.budgetUsed = updates.budgetUsed;
    }

    const [updated] = await this.db
      .update(researchRuns)
      .set(values)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.userId, userId)))
      .returning();

    if (!updated) {
      throw new Error(`Research run ${runId} tidak ditemukan untuk user ${userId}.`);
    }
    return updated;
  }

  async saveSources(
    runId: string,
    sources: Array<{
      sourceId: string;
      url: string;
      title: string;
      domain: string;
      credibilityScore?: number | undefined;
      fetchStatus?: string | undefined;
      contentHash?: string | undefined;
      snippet?: string | undefined;
    }>,
  ): Promise<ResearchSourceRow[]> {
    if (sources.length === 0) return [];

    const rows: ResearchSourceRow[] = [];
    for (const s of sources) {
      const [inserted] = await this.db
        .insert(researchSources)
        .values({
          runId,
          sourceId: s.sourceId,
          url: s.url,
          title: s.title,
          domain: s.domain,
          credibilityScore: s.credibilityScore ?? 0.5,
          fetchStatus: s.fetchStatus ?? 'pending',
          contentHash: s.contentHash ?? null,
          snippet: s.snippet ?? null,
        })
        .onConflictDoUpdate({
          target: [researchSources.runId, researchSources.sourceId],
          set: {
            title: s.title,
            fetchStatus: s.fetchStatus ?? 'pending',
            contentHash: s.contentHash ?? null,
            snippet: s.snippet ?? null,
            credibilityScore: s.credibilityScore ?? 0.5,
          },
        })
        .returning();
      if (inserted) rows.push(inserted);
    }
    return rows;
  }

  async getSources(runId: string): Promise<ResearchSourceRow[]> {
    return this.db
      .select()
      .from(researchSources)
      .where(eq(researchSources.runId, runId))
      .orderBy(researchSources.sourceId);
  }

  async saveEvidence(
    runId: string,
    evidenceItems: Array<{
      sourceId: string;
      statement: string;
      claimType?: string | undefined;
      quote?: string | undefined;
      confidence?: number | undefined;
      verified?: boolean | undefined;
    }>,
  ): Promise<ResearchEvidenceRow[]> {
    if (evidenceItems.length === 0) return [];

    const values = evidenceItems.map((e) => ({
      runId,
      sourceId: e.sourceId,
      statement: e.statement,
      claimType: e.claimType ?? 'sourced_fact',
      quote: e.quote ?? null,
      confidence: e.confidence ?? 0.8,
      verified: e.verified ?? false,
    }));

    return this.db.insert(researchEvidence).values(values).returning();
  }

  async getEvidence(runId: string): Promise<ResearchEvidenceRow[]> {
    return this.db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.runId, runId))
      .orderBy(researchEvidence.createdAt);
  }

  async saveReport(
    runId: string,
    report: {
      title: string;
      contentMarkdown: string;
      confidenceBySection?: Record<string, number> | undefined;
      gaps?: string[] | undefined;
      limitations?: string[] | undefined;
      summary: string;
    },
  ): Promise<ResearchReportRow> {
    const [row] = await this.db
      .insert(researchReports)
      .values({
        runId,
        title: report.title,
        contentMarkdown: report.contentMarkdown,
        confidenceBySection: report.confidenceBySection ?? {},
        gaps: report.gaps ?? [],
        limitations: report.limitations ?? [],
        summary: report.summary,
      })
      .onConflictDoUpdate({
        target: [researchReports.runId],
        set: {
          title: report.title,
          contentMarkdown: report.contentMarkdown,
          confidenceBySection: report.confidenceBySection ?? {},
          gaps: report.gaps ?? [],
          limitations: report.limitations ?? [],
          summary: report.summary,
        },
      })
      .returning();

    if (!row) {
      throw new Error(`Gagal menyimpan laporan untuk research run ${runId}.`);
    }
    return row;
  }

  async getReport(runId: string): Promise<ResearchReportRow | null> {
    const [row] = await this.db
      .select()
      .from(researchReports)
      .where(eq(researchReports.runId, runId))
      .limit(1);
    return row ?? null;
  }

  async getRunDetails(
    userId: string,
    runId: string,
  ): Promise<{
    run: ResearchRunRow;
    sources: ResearchSourceRow[];
    evidence: ResearchEvidenceRow[];
    report: ResearchReportRow | null;
  } | null> {
    const run = await this.getRun(userId, runId);
    if (!run) return null;

    const [sources, evidence, report] = await Promise.all([
      this.getSources(runId),
      this.getEvidence(runId),
      this.getReport(runId),
    ]);

    return { run, sources, evidence, report };
  }

  async deleteRun(userId: string, runId: string): Promise<boolean> {
    const run = await this.getRun(userId, runId);
    if (!run) return false;
    await this.db
      .delete(researchRuns)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.userId, userId)));
    return true;
  }
}

export class InMemoryResearchRepository implements ResearchRepository {
  private readonly runs = new Map<string, ResearchRunRow>();
  private readonly sources = new Map<string, ResearchSourceRow[]>();
  private readonly evidence = new Map<string, ResearchEvidenceRow[]>();
  private readonly reports = new Map<string, ResearchReportRow>();

  async createRun(params: CreateResearchRunParams): Promise<ResearchRunRow> {
    const id = crypto.randomUUID();
    const row: ResearchRunRow = {
      id,
      userId: params.userId,
      projectId: params.projectId,
      query: params.query,
      scope: params.scope ?? 'general',
      language: params.language ?? 'id',
      depth: params.depth ?? 'standard',
      status: 'queued',
      budgetConfig: params.budgetConfig,
      budgetUsed: {},
      plan: (params.plan as unknown) ?? null,
      checkpoint: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.runs.set(id, row);
    return row;
  }

  async getRun(userId: string, runId: string): Promise<ResearchRunRow | null> {
    const row = this.runs.get(runId);
    if (!row || row.userId !== userId) return null;
    return row;
  }

  async listRuns(
    userId: string,
    filter?: ListResearchRunsFilter,
  ): Promise<{ runs: ResearchRunRow[]; total: number }> {
    const userRuns = Array.from(this.runs.values()).filter((r) => {
      if (r.userId !== userId) return false;
      if (filter?.projectId && r.projectId !== filter.projectId) return false;
      if (filter?.status && r.status !== filter.status) return false;
      return true;
    });
    userRuns.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const limit = filter?.limit ?? 20;
    const offset = filter?.offset ?? 0;
    return {
      runs: userRuns.slice(offset, offset + limit),
      total: userRuns.length,
    };
  }

  async updateRunStatus(
    userId: string,
    runId: string,
    status: string,
    updates?: {
      plan?: Record<string, unknown> | undefined;
      checkpoint?: Record<string, unknown> | undefined;
      error?: string | null | undefined;
      budgetUsed?: Record<string, unknown> | undefined;
    },
  ): Promise<ResearchRunRow> {
    const run = await this.getRun(userId, runId);
    if (!run) throw new Error(`Research run ${runId} not found`);
    const updated: ResearchRunRow = {
      ...run,
      status,
      plan: updates?.plan !== undefined ? (updates.plan as unknown) : run.plan,
      checkpoint:
        updates?.checkpoint !== undefined ? (updates.checkpoint as unknown) : run.checkpoint,
      error: updates?.error !== undefined ? updates.error : run.error,
      budgetUsed:
        updates?.budgetUsed !== undefined ? (updates.budgetUsed as unknown) : run.budgetUsed,
      updatedAt: new Date(),
    };
    this.runs.set(runId, updated);
    return updated;
  }

  async saveSources(
    runId: string,
    sources: Array<{
      sourceId: string;
      url: string;
      title: string;
      domain: string;
      credibilityScore?: number | undefined;
      fetchStatus?: string | undefined;
      contentHash?: string | undefined;
      snippet?: string | undefined;
    }>,
  ): Promise<ResearchSourceRow[]> {
    const current = this.sources.get(runId) ?? [];
    const created: ResearchSourceRow[] = sources.map((s) => ({
      id: crypto.randomUUID(),
      runId,
      sourceId: s.sourceId,
      url: s.url,
      title: s.title,
      domain: s.domain,
      credibilityScore: s.credibilityScore ?? 0.5,
      fetchStatus: s.fetchStatus ?? 'pending',
      contentHash: s.contentHash ?? null,
      snippet: s.snippet ?? null,
      createdAt: new Date(),
    }));
    const merged = [
      ...current.filter((c) => !sources.some((s) => s.sourceId === c.sourceId)),
      ...created,
    ];
    this.sources.set(runId, merged);
    return created;
  }

  async getSources(runId: string): Promise<ResearchSourceRow[]> {
    return this.sources.get(runId) ?? [];
  }

  async saveEvidence(
    runId: string,
    evidenceItems: Array<{
      sourceId: string;
      statement: string;
      claimType?: string | undefined;
      quote?: string | undefined;
      confidence?: number | undefined;
      verified?: boolean | undefined;
    }>,
  ): Promise<ResearchEvidenceRow[]> {
    const current = this.evidence.get(runId) ?? [];
    const created: ResearchEvidenceRow[] = evidenceItems.map((e) => ({
      id: crypto.randomUUID(),
      runId,
      sourceId: e.sourceId,
      statement: e.statement,
      claimType: e.claimType ?? 'sourced_fact',
      quote: e.quote ?? null,
      confidence: e.confidence ?? 0.8,
      verified: e.verified ?? false,
      createdAt: new Date(),
    }));
    this.evidence.set(runId, [...current, ...created]);
    return created;
  }

  async getEvidence(runId: string): Promise<ResearchEvidenceRow[]> {
    return this.evidence.get(runId) ?? [];
  }

  async saveReport(
    runId: string,
    report: {
      title: string;
      contentMarkdown: string;
      confidenceBySection?: Record<string, number> | undefined;
      gaps?: string[] | undefined;
      limitations?: string[] | undefined;
      summary: string;
    },
  ): Promise<ResearchReportRow> {
    const row: ResearchReportRow = {
      id: crypto.randomUUID(),
      runId,
      title: report.title,
      contentMarkdown: report.contentMarkdown,
      confidenceBySection: (report.confidenceBySection as unknown) ?? {},
      gaps: (report.gaps as unknown) ?? [],
      limitations: (report.limitations as unknown) ?? [],
      summary: report.summary,
      createdAt: new Date(),
    };
    this.reports.set(runId, row);
    return row;
  }

  async getReport(runId: string): Promise<ResearchReportRow | null> {
    return this.reports.get(runId) ?? null;
  }

  async getRunDetails(userId: string, runId: string) {
    const run = await this.getRun(userId, runId);
    if (!run) return null;
    return {
      run,
      sources: await this.getSources(runId),
      evidence: await this.getEvidence(runId),
      report: await this.getReport(runId),
    };
  }

  async deleteRun(userId: string, runId: string): Promise<boolean> {
    const run = await this.getRun(userId, runId);
    if (!run) return false;
    this.runs.delete(runId);
    this.sources.delete(runId);
    this.evidence.delete(runId);
    this.reports.delete(runId);
    return true;
  }
}
