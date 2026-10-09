import { randomUUID } from 'node:crypto';
import type { SkillManifest, SkillRecord, SkillRevisionRecord } from '@personal-ai-os/agent-core';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

export interface SkillRepository {
  listSkills(options?: { isEnabled?: boolean }): Promise<SkillRecord[]>;
  getSkillByName(name: string): Promise<SkillRecord | null>;
  upsertSkill(manifest: SkillManifest): Promise<SkillRecord>;
  enableSkill(name: string): Promise<SkillRecord>;
  disableSkill(name: string): Promise<SkillRecord>;
  rollbackSkill(name: string, targetVersion?: string): Promise<SkillRecord>;
  getSkillRevisions(name: string): Promise<SkillRevisionRecord[]>;
}

export class InMemorySkillRepository implements SkillRepository {
  private readonly skills = new Map<string, SkillRecord>();
  private readonly revisions = new Map<string, SkillRevisionRecord[]>();

  async listSkills(options?: { isEnabled?: boolean }): Promise<SkillRecord[]> {
    const list = Array.from(this.skills.values());
    if (options?.isEnabled !== undefined) {
      return list.filter((s) => s.isEnabled === options.isEnabled);
    }
    return list;
  }

  async getSkillByName(name: string): Promise<SkillRecord | null> {
    return this.skills.get(name) ?? null;
  }

  async upsertSkill(manifest: SkillManifest): Promise<SkillRecord> {
    const existing = this.skills.get(manifest.name);
    const now = new Date();

    if (existing) {
      const history = this.revisions.get(manifest.name) ?? [];
      history.push({
        id: randomUUID(),
        skillName: existing.name,
        version: existing.version,
        manifest: existing.manifest,
        createdAt: existing.updatedAt,
      });
      this.revisions.set(manifest.name, history);

      const updated: SkillRecord = {
        ...existing,
        version: manifest.version,
        description: manifest.description,
        manifest,
        updatedAt: now,
      };
      this.skills.set(manifest.name, updated);
      return updated;
    }

    const created: SkillRecord = {
      id: randomUUID(),
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      manifest,
      isEnabled: true,
      isDefault: false,
      scope: 'system',
      createdAt: now,
      updatedAt: now,
    };
    this.skills.set(manifest.name, created);
    return created;
  }

  async enableSkill(name: string): Promise<SkillRecord> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill '${name}' tidak ditemukan.`);
    skill.isEnabled = true;
    skill.updatedAt = new Date();
    return skill;
  }

  async disableSkill(name: string): Promise<SkillRecord> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill '${name}' tidak ditemukan.`);
    skill.isEnabled = false;
    skill.updatedAt = new Date();
    return skill;
  }

  async getSkillRevisions(name: string): Promise<SkillRevisionRecord[]> {
    return this.revisions.get(name) ?? [];
  }

  async rollbackSkill(name: string, targetVersion?: string): Promise<SkillRecord> {
    const current = this.skills.get(name);
    if (!current) throw new Error(`Skill '${name}' tidak ditemukan.`);

    const history = this.revisions.get(name) ?? [];
    if (history.length === 0) {
      throw new Error(`Tidak ada riwayat revisi untuk rollback skill '${name}'.`);
    }

    let targetRevision: SkillRevisionRecord | undefined;
    if (targetVersion) {
      targetRevision = history.find((r) => r.version === targetVersion);
      if (!targetRevision) {
        throw new Error(
          `Versi revisi '${targetVersion}' tidak ditemukan dalam riwayat skill '${name}'.`,
        );
      }
    } else {
      targetRevision = history[history.length - 1];
    }

    // Save current version as revision
    history.push({
      id: randomUUID(),
      skillName: current.name,
      version: current.version,
      manifest: current.manifest,
      createdAt: current.updatedAt,
    });

    const rolledBack: SkillRecord = {
      ...current,
      version: targetRevision!.version,
      description: targetRevision!.manifest.description,
      manifest: targetRevision!.manifest,
      updatedAt: new Date(),
    };

    this.skills.set(name, rolledBack);
    return rolledBack;
  }
}

export class SqlSkillRepository implements SkillRepository {
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  async listSkills(options?: { isEnabled?: boolean }): Promise<SkillRecord[]> {
    let rows;
    if (options?.isEnabled !== undefined) {
      rows = await this.db
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.isEnabled, options.isEnabled));
    } else {
      rows = await this.db.select().from(schema.skills);
    }

    return rows.map((r) => this.mapRowToRecord(r));
  }

  async getSkillByName(name: string): Promise<SkillRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.name, name))
      .limit(1);

    if (rows.length === 0 || !rows[0]) return null;
    return this.mapRowToRecord(rows[0]);
  }

  async upsertSkill(manifest: SkillManifest): Promise<SkillRecord> {
    const existing = await this.getSkillByName(manifest.name);
    const now = new Date();

    if (existing) {
      // Record current version as revision
      await this.db.insert(schema.skillRevisions).values({
        skillName: existing.name,
        version: existing.version,
        manifest: existing.manifest,
        createdAt: existing.updatedAt,
      });

      const [updated] = await this.db
        .update(schema.skills)
        .set({
          version: manifest.version,
          description: manifest.description,
          manifest,
          updatedAt: now,
        })
        .where(eq(schema.skills.name, manifest.name))
        .returning();

      return this.mapRowToRecord(updated!);
    }

    const [created] = await this.db
      .insert(schema.skills)
      .values({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        manifest,
        isEnabled: true,
        isDefault: false,
        scope: 'system',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapRowToRecord(created!);
  }

  async enableSkill(name: string): Promise<SkillRecord> {
    const [updated] = await this.db
      .update(schema.skills)
      .set({ isEnabled: true, updatedAt: new Date() })
      .where(eq(schema.skills.name, name))
      .returning();

    if (!updated) throw new Error(`Skill '${name}' tidak ditemukan.`);
    return this.mapRowToRecord(updated);
  }

  async disableSkill(name: string): Promise<SkillRecord> {
    const [updated] = await this.db
      .update(schema.skills)
      .set({ isEnabled: false, updatedAt: new Date() })
      .where(eq(schema.skills.name, name))
      .returning();

    if (!updated) throw new Error(`Skill '${name}' tidak ditemukan.`);
    return this.mapRowToRecord(updated);
  }

  async getSkillRevisions(name: string): Promise<SkillRevisionRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.skillRevisions)
      .where(eq(schema.skillRevisions.skillName, name));

    return rows.map((r) => ({
      id: r.id,
      skillName: r.skillName,
      version: r.version,
      manifest: r.manifest as SkillManifest,
      createdAt: r.createdAt,
    }));
  }

  async rollbackSkill(name: string, targetVersion?: string): Promise<SkillRecord> {
    const current = await this.getSkillByName(name);
    if (!current) throw new Error(`Skill '${name}' tidak ditemukan.`);

    const revisions = await this.getSkillRevisions(name);
    if (revisions.length === 0) {
      throw new Error(`Tidak ada riwayat revisi untuk rollback skill '${name}'.`);
    }

    let targetRevision: SkillRevisionRecord | undefined;
    if (targetVersion) {
      targetRevision = revisions.find((r) => r.version === targetVersion);
      if (!targetRevision) {
        throw new Error(
          `Versi revisi '${targetVersion}' tidak ditemukan dalam riwayat skill '${name}'.`,
        );
      }
    } else {
      targetRevision = revisions[revisions.length - 1];
    }

    // Record current as revision
    await this.db.insert(schema.skillRevisions).values({
      skillName: current.name,
      version: current.version,
      manifest: current.manifest,
      createdAt: current.updatedAt,
    });

    const [updated] = await this.db
      .update(schema.skills)
      .set({
        version: targetRevision!.version,
        description: targetRevision!.manifest.description,
        manifest: targetRevision!.manifest,
        updatedAt: new Date(),
      })
      .where(eq(schema.skills.name, name))
      .returning();

    return this.mapRowToRecord(updated!);
  }

  private mapRowToRecord(r: schema.SkillRow): SkillRecord {
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      description: r.description,
      manifest: r.manifest as SkillManifest,
      isEnabled: r.isEnabled,
      isDefault: r.isDefault,
      scope: r.scope,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
