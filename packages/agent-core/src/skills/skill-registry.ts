import { randomUUID } from 'node:crypto';
import { ManifestValidator } from './manifest-validator.ts';
import { SkillExecutor } from './skill-executor.ts';
import {
  type SkillExecutionContext,
  type SkillHandler,
  type SkillRecord,
  type SkillRevisionRecord,
  SkillNotFoundError,
} from './types.ts';

export class SkillRegistry {
  private readonly skills = new Map<string, SkillRecord>();
  private readonly revisions = new Map<string, SkillRevisionRecord[]>();
  private readonly handlers = new Map<string, SkillHandler<never, never>>();
  private readonly validator: ManifestValidator;
  private readonly executor: SkillExecutor;

  constructor(options?: { validator?: ManifestValidator; executor?: SkillExecutor }) {
    this.validator = options?.validator ?? new ManifestValidator();
    this.executor = options?.executor ?? new SkillExecutor();
  }

  registerSkill(manifestInput: unknown, handler?: SkillHandler<never, never>): SkillRecord {
    const validated = this.validator.validate(manifestInput);
    const existing = this.skills.get(validated.name);
    const now = new Date();

    if (existing) {
      // Save current version to revision history before updating
      const history = this.revisions.get(validated.name) ?? [];
      history.push({
        id: randomUUID(),
        skillName: existing.name,
        version: existing.version,
        manifest: existing.manifest,
        createdAt: existing.updatedAt,
      });
      this.revisions.set(validated.name, history);

      const updated: SkillRecord = {
        ...existing,
        version: validated.version,
        description: validated.description,
        manifest: validated,
        updatedAt: now,
      };
      this.skills.set(validated.name, updated);
      if (handler) {
        this.handlers.set(validated.name, handler);
      }
      return updated;
    }

    const created: SkillRecord = {
      id: randomUUID(),
      name: validated.name,
      version: validated.version,
      description: validated.description,
      manifest: validated,
      isEnabled: true,
      isDefault: false,
      scope: 'system',
      createdAt: now,
      updatedAt: now,
    };

    this.skills.set(validated.name, created);
    if (handler) {
      this.handlers.set(validated.name, handler);
    }
    return created;
  }

  getSkill(name: string): SkillRecord | undefined {
    return this.skills.get(name);
  }

  listSkills(options?: { isEnabled?: boolean }): SkillRecord[] {
    const all = Array.from(this.skills.values());
    if (options?.isEnabled !== undefined) {
      return all.filter((s) => s.isEnabled === options.isEnabled);
    }
    return all;
  }

  enableSkill(name: string): SkillRecord {
    const skill = this.skills.get(name);
    if (!skill) throw new SkillNotFoundError(name);
    skill.isEnabled = true;
    skill.updatedAt = new Date();
    return skill;
  }

  disableSkill(name: string): SkillRecord {
    const skill = this.skills.get(name);
    if (!skill) throw new SkillNotFoundError(name);
    skill.isEnabled = false;
    skill.updatedAt = new Date();
    return skill;
  }

  getRevisions(name: string): SkillRevisionRecord[] {
    return this.revisions.get(name) ?? [];
  }

  rollbackSkill(name: string, targetVersion?: string): SkillRecord {
    const current = this.skills.get(name);
    if (!current) throw new SkillNotFoundError(name);

    const history = this.revisions.get(name) ?? [];
    if (history.length === 0) {
      throw new Error(`Tidak ada riwayat revisi untuk rollback skill '${name}'.`);
    }

    let targetRevision: SkillRevisionRecord | undefined;
    if (targetVersion) {
      targetRevision = history.find((r) => r.version === targetVersion);
      if (!targetRevision) {
        throw new Error(
          `Versi rollback '${targetVersion}' tidak ditemukan dalam riwayat revisi skill '${name}'.`,
        );
      }
    } else {
      // Pop most recent revision
      targetRevision = history[history.length - 1];
    }

    // Save current as revision before rolling back
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

  async executeSkill<TInput = Record<string, unknown>, TOutput = Record<string, unknown>>(
    name: string,
    input: TInput,
    context: SkillExecutionContext,
  ): Promise<TOutput> {
    const skill = this.skills.get(name);
    if (!skill) throw new SkillNotFoundError(name);

    const handler = this.handlers.get(name) as SkillHandler<TInput, TOutput> | undefined;
    if (!handler) {
      throw new Error(`Handler eksekusi untuk skill '${name}' belum terdaftar.`);
    }

    return await this.executor.executeSkill(skill, handler, input, context);
  }
}
