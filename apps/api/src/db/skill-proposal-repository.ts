import { randomUUID } from 'node:crypto';
import type { SkillManifest } from '@personal-ai-os/agent-core';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { auditLogs, skillProposals, skills } from './schema.ts';

export interface SkillProposalRecord {
  id: string;
  userId: string;
  taskId?: string | null | undefined;
  skillName: string;
  title: string;
  description: string;
  proposedManifest: SkillManifest;
  promptInstructions?: string | null | undefined;
  changeType: 'new_skill' | 'improvement';
  targetSkillName?: string | null | undefined;
  diff?: string | null | undefined;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  rejectionReason?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProposalInput {
  userId: string;
  taskId?: string | null | undefined;
  skillName: string;
  title: string;
  description: string;
  proposedManifest: SkillManifest;
  promptInstructions?: string | null | undefined;
  changeType?: 'new_skill' | 'improvement' | undefined;
  targetSkillName?: string | null | undefined;
  diff?: string | null | undefined;
}

export interface SkillProposalRepository {
  createProposal(input: CreateProposalInput): Promise<SkillProposalRecord>;
  getProposalById(id: string): Promise<SkillProposalRecord | null>;
  listProposals(userId: string, filter?: { status?: string | undefined }): Promise<SkillProposalRecord[]>;
  approveProposal(
    id: string,
    reviewerId: string,
  ): Promise<{ proposal: SkillProposalRecord; createdSkillName: string }>;
  rejectProposal(id: string, reviewerId: string, reason: string): Promise<SkillProposalRecord>;
}

export class SqlSkillProposalRepository implements SkillProposalRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createProposal(input: CreateProposalInput): Promise<SkillProposalRecord> {
    const id = randomUUID();
    const now = new Date();
    const changeType = input.changeType ?? 'new_skill';

    const [row] = await this.db
      .insert(skillProposals)
      .values({
        id,
        userId: input.userId,
        taskId: input.taskId ?? null,
        skillName: input.skillName,
        title: input.title,
        description: input.description,
        proposedManifest: input.proposedManifest as never,
        promptInstructions: input.promptInstructions ?? null,
        changeType,
        targetSkillName: input.targetSkillName ?? null,
        diff: input.diff ?? null,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new Error('Gagal menyimpan usulan skill ke basis data');
    }

    // Catat ke audit log
    await this.db.insert(auditLogs).values({
      userId: input.userId,
      action: 'skill.proposed',
      resourceType: 'skill_proposal',
      resourceId: id,
      decision: 'pending',
      metadata: {
        skillName: input.skillName,
        changeType,
        targetSkillName: input.targetSkillName ?? null,
      },
    });

    return this.mapRow(row);
  }

  async getProposalById(id: string): Promise<SkillProposalRecord | null> {
    const [row] = await this.db
      .select()
      .from(skillProposals)
      .where(eq(skillProposals.id, id))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async listProposals(
    userId: string,
    filter?: { status?: string | undefined },
  ): Promise<SkillProposalRecord[]> {
    const conditions = [eq(skillProposals.userId, userId)];
    if (filter?.status) {
      conditions.push(eq(skillProposals.status, filter.status));
    }

    const rows = await this.db
      .select()
      .from(skillProposals)
      .where(and(...conditions))
      .orderBy(desc(skillProposals.createdAt));

    return rows.map((r) => this.mapRow(r));
  }

  async approveProposal(
    id: string,
    reviewerId: string,
  ): Promise<{ proposal: SkillProposalRecord; createdSkillName: string }> {
    const proposal = await this.getProposalById(id);
    if (!proposal) {
      throw new Error(`Usulan skill dengan ID "${id}" tidak ditemukan.`);
    }
    if (proposal.status !== 'pending') {
      throw new Error(`Usulan skill sudah berstatus "${proposal.status}" dan tidak dapat disetujui.`);
    }

    const now = new Date();

    // 1. Update status proposal menjadi 'approved'
    const [updatedRow] = await this.db
      .update(skillProposals)
      .set({
        status: 'approved',
        reviewedBy: reviewerId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(skillProposals.id, id))
      .returning();

    // 2. Terapkan skill ke tabel skills dalam keadaan NONAKTIF (isEnabled: false)
    const manifest = proposal.proposedManifest;
    await this.db
      .insert(skills)
      .values({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        manifest: manifest as never,
        isEnabled: false, // KEAMANAN: Selalu mulai dalam keadaan NONAKTIF!
        isDefault: false,
        scope: 'custom',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: skills.name,
        set: {
          version: manifest.version,
          description: manifest.description,
          manifest: manifest as never,
          isEnabled: false, // Perubahan versi tetap mempertahankan status aman
          updatedAt: now,
        },
      });

    // 3. Catat di audit log
    await this.db.insert(auditLogs).values({
      userId: reviewerId,
      action: 'skill_proposal.approved',
      resourceType: 'skill_proposal',
      resourceId: id,
      decision: 'approved',
      metadata: {
        skillName: manifest.name,
        changeType: proposal.changeType,
        appliedAsDisabled: true,
      },
    });

    return {
      proposal: this.mapRow(updatedRow!),
      createdSkillName: manifest.name,
    };
  }

  async rejectProposal(
    id: string,
    reviewerId: string,
    reason: string,
  ): Promise<SkillProposalRecord> {
    const proposal = await this.getProposalById(id);
    if (!proposal) {
      throw new Error(`Usulan skill dengan ID "${id}" tidak ditemukan.`);
    }
    if (proposal.status !== 'pending') {
      throw new Error(`Usulan skill sudah berstatus "${proposal.status}" dan tidak dapat ditolak.`);
    }

    const now = new Date();
    const [updatedRow] = await this.db
      .update(skillProposals)
      .set({
        status: 'rejected',
        reviewedBy: reviewerId,
        reviewedAt: now,
        rejectionReason: reason,
        updatedAt: now,
      })
      .where(eq(skillProposals.id, id))
      .returning();

    // Catat di audit log
    await this.db.insert(auditLogs).values({
      userId: reviewerId,
      action: 'skill_proposal.rejected',
      resourceType: 'skill_proposal',
      resourceId: id,
      decision: 'rejected',
      metadata: {
        skillName: proposal.skillName,
        reason,
      },
    });

    return this.mapRow(updatedRow!);
  }

  private mapRow(row: Record<string, unknown>): SkillProposalRecord {
    return {
      id: String(row['id']),
      userId: String(row['userId'] ?? row['user_id']),
      taskId: row['taskId'] || row['task_id'] ? String(row['taskId'] ?? row['task_id']) : null,
      skillName: String(row['skillName'] ?? row['skill_name']),
      title: String(row['title']),
      description: String(row['description']),
      proposedManifest: (row['proposedManifest'] ?? row['proposed_manifest']) as SkillManifest,
      promptInstructions: (row['promptInstructions'] ?? row['prompt_instructions']) as string | null,
      changeType: (row['changeType'] ?? row['change_type'] ?? 'new_skill') as 'new_skill' | 'improvement',
      targetSkillName: (row['targetSkillName'] ?? row['target_skill_name']) as string | null,
      diff: (row['diff'] as string | null) ?? null,
      status: (row['status'] ?? 'pending') as 'pending' | 'approved' | 'rejected',
      reviewedBy: (row['reviewedBy'] ?? row['reviewed_by']) as string | null,
      reviewedAt: row['reviewedAt'] || row['reviewed_at']
        ? new Date(row['reviewedAt'] as string | Date ?? row['reviewed_at']).toISOString()
        : null,
      rejectionReason: (row['rejectionReason'] ?? row['rejection_reason']) as string | null,
      createdAt: new Date(row['createdAt'] as string | Date ?? row['created_at']).toISOString(),
      updatedAt: new Date(row['updatedAt'] as string | Date ?? row['updated_at']).toISOString(),
    };
  }
}

export class InMemorySkillProposalRepository implements SkillProposalRepository {
  private readonly proposals = new Map<string, SkillProposalRecord>();

  async createProposal(input: CreateProposalInput): Promise<SkillProposalRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: SkillProposalRecord = {
      id,
      userId: input.userId,
      taskId: input.taskId ?? null,
      skillName: input.skillName,
      title: input.title,
      description: input.description,
      proposedManifest: input.proposedManifest,
      promptInstructions: input.promptInstructions ?? null,
      changeType: input.changeType ?? 'new_skill',
      targetSkillName: input.targetSkillName ?? null,
      diff: input.diff ?? null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.set(id, record);
    return record;
  }

  async getProposalById(id: string): Promise<SkillProposalRecord | null> {
    return this.proposals.get(id) ?? null;
  }

  async listProposals(
    userId: string,
    filter?: { status?: string | undefined },
  ): Promise<SkillProposalRecord[]> {
    let list = Array.from(this.proposals.values()).filter((p) => p.userId === userId);
    if (filter?.status) {
      list = list.filter((p) => p.status === filter.status);
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async approveProposal(
    id: string,
    reviewerId: string,
  ): Promise<{ proposal: SkillProposalRecord; createdSkillName: string }> {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error(`Usulan skill dengan ID "${id}" tidak ditemukan.`);
    if (proposal.status !== 'pending') {
      throw new Error(`Usulan skill sudah berstatus "${proposal.status}".`);
    }

    const now = new Date().toISOString();
    proposal.status = 'approved';
    proposal.reviewedBy = reviewerId;
    proposal.reviewedAt = now;
    proposal.updatedAt = now;

    return { proposal, createdSkillName: proposal.proposedManifest.name };
  }

  async rejectProposal(
    id: string,
    reviewerId: string,
    reason: string,
  ): Promise<SkillProposalRecord> {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error(`Usulan skill dengan ID "${id}" tidak ditemukan.`);
    if (proposal.status !== 'pending') {
      throw new Error(`Usulan skill sudah berstatus "${proposal.status}".`);
    }

    const now = new Date().toISOString();
    proposal.status = 'rejected';
    proposal.reviewedBy = reviewerId;
    proposal.reviewedAt = now;
    proposal.rejectionReason = reason;
    proposal.updatedAt = now;

    return proposal;
  }
}
