import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { projects } from './schema.ts';

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  description?: string | null | undefined;
  createdAt: Date;
}

export interface ProjectRepository {
  createProject(userId: string, name: string, description?: string): Promise<ProjectRecord>;
  listProjects(userId: string): Promise<ProjectRecord[]>;
  getProject(userId: string, projectId: string): Promise<ProjectRecord | null>;
  updateProject(
    userId: string,
    projectId: string,
    updates: { name?: string; description?: string },
  ): Promise<ProjectRecord | null>;
  deleteProject(userId: string, projectId: string): Promise<boolean>;
}

export class SqlProjectRepository implements ProjectRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createProject(userId: string, name: string, description?: string): Promise<ProjectRecord> {
    const [created] = await this.db
      .insert(projects)
      .values({
        userId,
        name,
        description: description ?? null,
      })
      .returning();

    if (!created) throw new Error('Failed to create project');
    return {
      id: created.id,
      userId: created.userId,
      name: created.name,
      description: created.description,
      createdAt: created.createdAt,
    };
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.createdAt));

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
    }));
  }

  async getProject(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
    };
  }

  async updateProject(
    userId: string,
    projectId: string,
    updates: { name?: string; description?: string },
  ): Promise<ProjectRecord | null> {
    const toUpdate: { name?: string; description?: string | null } = {};
    if (updates.name !== undefined) toUpdate.name = updates.name;
    if (updates.description !== undefined) toUpdate.description = updates.description;

    const [updated] = await this.db
      .update(projects)
      .set(toUpdate)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();

    if (!updated) return null;
    return {
      id: updated.id,
      userId: updated.userId,
      name: updated.name,
      description: updated.description,
      createdAt: updated.createdAt,
    };
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    const result = await this.db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning({ id: projects.id });

    return result.length > 0;
  }
}

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects: ProjectRecord[] = [];

  async createProject(userId: string, name: string, description?: string): Promise<ProjectRecord> {
    const record: ProjectRecord = {
      id: crypto.randomUUID(),
      userId,
      name,
      description: description ?? null,
      createdAt: new Date(),
    };
    this.projects.push(record);
    return record;
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    return this.projects
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getProject(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const found = this.projects.find((p) => p.id === projectId && p.userId === userId);
    return found ? { ...found } : null;
  }

  async updateProject(
    userId: string,
    projectId: string,
    updates: { name?: string; description?: string },
  ): Promise<ProjectRecord | null> {
    const index = this.projects.findIndex((p) => p.id === projectId && p.userId === userId);
    if (index === -1) return null;

    const current = this.projects[index]!;
    const updated: ProjectRecord = {
      ...current,
      name: updates.name ?? current.name,
      description: updates.description !== undefined ? updates.description : current.description,
    };
    this.projects[index] = updated;
    return { ...updated };
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    const index = this.projects.findIndex((p) => p.id === projectId && p.userId === userId);
    if (index === -1) return false;
    this.projects.splice(index, 1);
    return true;
  }
}
