import crypto from 'node:crypto';
import type { ApprovalRecord, ApprovalValidator, RiskLevel } from '@personal-ai-os/permissions';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { approvals } from './schema.ts';

export interface CreateApprovalParams {
  userId: string;
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
  action: string;
  resource: string;
  scope: string;
  riskLevel: RiskLevel;
  consequence: string;
  fingerprint: string;
  expiresInSeconds?: number | undefined;
}

export interface ApprovalRepository extends ApprovalValidator {
  createApproval(params: CreateApprovalParams): Promise<ApprovalRecord>;
  getApproval(userId: string, approvalId: string): Promise<ApprovalRecord | null>;
  listApprovals(
    userId: string,
    options?: { status?: string | undefined; taskId?: string | undefined },
  ): Promise<ApprovalRecord[]>;
  decideApproval(
    userId: string,
    approvalId: string,
    decision: 'approved' | 'denied',
    reason?: string | undefined,
    approverId?: string | undefined,
  ): Promise<ApprovalRecord>;
  validateAndConsume(
    approvalId: string,
    expectedFingerprint: string,
    actorId: string,
  ): Promise<{ valid: boolean; reason?: string }>;
}

export class SqlApprovalRepository implements ApprovalRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createApproval(params: CreateApprovalParams): Promise<ApprovalRecord> {
    const ttl = params.expiresInSeconds ?? 3600;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const [created] = await this.db
      .insert(approvals)
      .values({
        userId: params.userId,
        taskId: params.taskId ?? null,
        projectId: params.projectId ?? null,
        action: params.action,
        resource: params.resource,
        scope: params.scope,
        riskLevel: params.riskLevel,
        consequence: params.consequence,
        fingerprint: params.fingerprint,
        status: 'pending',
        expiresAt,
      })
      .returning();

    if (!created) throw new Error('Failed to create approval record');
    return this.mapRow(created);
  }

  async getApproval(userId: string, approvalId: string): Promise<ApprovalRecord | null> {
    const [row] = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
      .limit(1);

    if (!row) return null;
    return this.mapRow(row);
  }

  async listApprovals(
    userId: string,
    options?: { status?: string | undefined; taskId?: string | undefined },
  ): Promise<ApprovalRecord[]> {
    const conditions = [eq(approvals.userId, userId)];
    if (options?.status) {
      conditions.push(eq(approvals.status, options.status));
    }
    if (options?.taskId) {
      conditions.push(eq(approvals.taskId, options.taskId));
    }

    const rows = await this.db
      .select()
      .from(approvals)
      .where(and(...conditions))
      .orderBy(desc(approvals.createdAt));

    return rows.map((r) => this.mapRow(r));
  }

  async decideApproval(
    userId: string,
    approvalId: string,
    decision: 'approved' | 'denied',
    reason?: string | undefined,
    approverId?: string | undefined,
  ): Promise<ApprovalRecord> {
    const existing = await this.getApproval(userId, approvalId);
    if (!existing) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    if (existing.status !== 'pending') {
      throw new Error(`Approval ${approvalId} is already decided (${existing.status})`);
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      // Mark as expired
      await this.db
        .update(approvals)
        .set({ status: 'expired' })
        .where(eq(approvals.id, approvalId));
      throw new Error(`Approval ${approvalId} has expired`);
    }

    const [updated] = await this.db
      .update(approvals)
      .set({
        status: decision,
        decisionReason: reason ?? null,
        approverId: approverId ?? userId,
        decidedAt: new Date(),
      })
      .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
      .returning();

    if (!updated) throw new Error(`Failed to update approval ${approvalId}`);
    return this.mapRow(updated);
  }

  async validateAndConsume(
    approvalId: string,
    expectedFingerprint: string,
    actorId: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const [row] = await this.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);

    if (!row) return { valid: false, reason: 'Approval record not found' };
    if (row.userId !== actorId) return { valid: false, reason: 'Actor identity mismatch' };

    if (row.status !== 'approved') {
      return { valid: false, reason: `Approval is not in approved state (current: ${row.status})` };
    }

    if (row.expiresAt.getTime() < Date.now()) {
      return { valid: false, reason: 'Approval has expired' };
    }

    if (row.usedAt) {
      return { valid: false, reason: 'Approval has already been consumed (single-use only)' };
    }

    if (row.fingerprint !== expectedFingerprint) {
      return {
        valid: false,
        reason: 'Approval fingerprint mismatch: approval does not match action target or scope',
      };
    }

    // Atomically consume
    const [consumed] = await this.db
      .update(approvals)
      .set({ usedAt: new Date() })
      .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'approved')))
      .returning();

    if (!consumed) {
      return { valid: false, reason: 'Approval consumption concurrency conflict' };
    }

    return { valid: true };
  }

  private mapRow(row: typeof approvals.$inferSelect): ApprovalRecord {
    return {
      id: row.id,
      userId: row.userId,
      taskId: row.taskId,
      projectId: row.projectId,
      action: row.action,
      resource: row.resource,
      scope: row.scope,
      riskLevel: row.riskLevel as RiskLevel,
      consequence: row.consequence,
      status: row.status as 'pending' | 'approved' | 'denied' | 'expired',
      decisionReason: row.decisionReason,
      approverId: row.approverId,
      fingerprint: row.fingerprint,
      usedAt: row.usedAt,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
    };
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private approvals = new Map<string, ApprovalRecord>();

  async createApproval(params: CreateApprovalParams): Promise<ApprovalRecord> {
    const id = crypto.randomUUID();
    const ttl = params.expiresInSeconds ?? 3600;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const record: ApprovalRecord = {
      id,
      userId: params.userId,
      taskId: params.taskId ?? null,
      projectId: params.projectId ?? null,
      action: params.action,
      resource: params.resource,
      scope: params.scope,
      riskLevel: params.riskLevel,
      consequence: params.consequence,
      status: 'pending',
      fingerprint: params.fingerprint,
      expiresAt,
      createdAt: now,
    };

    this.approvals.set(id, record);
    return { ...record };
  }

  async getApproval(userId: string, approvalId: string): Promise<ApprovalRecord | null> {
    const record = this.approvals.get(approvalId);
    if (!record || record.userId !== userId) return null;
    return { ...record };
  }

  async listApprovals(
    userId: string,
    options?: { status?: string | undefined; taskId?: string | undefined },
  ): Promise<ApprovalRecord[]> {
    return [...this.approvals.values()]
      .filter(
        (a) =>
          a.userId === userId &&
          (!options?.status || a.status === options.status) &&
          (!options?.taskId || a.taskId === options.taskId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((a) => ({ ...a }));
  }

  async decideApproval(
    userId: string,
    approvalId: string,
    decision: 'approved' | 'denied',
    reason?: string | undefined,
    approverId?: string | undefined,
  ): Promise<ApprovalRecord> {
    const record = this.approvals.get(approvalId);
    if (!record || record.userId !== userId) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    if (record.status !== 'pending') {
      throw new Error(`Approval ${approvalId} is already decided (${record.status})`);
    }

    if (record.expiresAt.getTime() < Date.now()) {
      record.status = 'expired';
      throw new Error(`Approval ${approvalId} has expired`);
    }

    record.status = decision;
    record.decisionReason = reason ?? null;
    record.approverId = approverId ?? userId;
    record.decidedAt = new Date();

    return { ...record };
  }

  async validateAndConsume(
    approvalId: string,
    expectedFingerprint: string,
    actorId: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const record = this.approvals.get(approvalId);
    if (!record) return { valid: false, reason: 'Approval not found' };
    if (record.userId !== actorId) return { valid: false, reason: 'Actor identity mismatch' };

    if (record.status !== 'approved') {
      return {
        valid: false,
        reason: `Approval status is not approved (current: ${record.status})`,
      };
    }

    if (record.expiresAt.getTime() < Date.now()) {
      record.status = 'expired';
      return { valid: false, reason: 'Approval has expired' };
    }

    if (record.usedAt) {
      return { valid: false, reason: 'Approval has already been consumed (single-use only)' };
    }

    if (record.fingerprint !== expectedFingerprint) {
      return { valid: false, reason: 'Approval fingerprint mismatch' };
    }

    record.usedAt = new Date();
    return { valid: true };
  }
}
