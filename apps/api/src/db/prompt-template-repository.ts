import crypto from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import type { Database } from './client.ts';
import { promptTemplates, type PromptTemplateRow } from './schema.ts';

export interface PromptTemplateRecord {
  id: string;
  userId: string;
  name: string;
  title: string;
  content: string;
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

export function extractTemplateVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g);
  const vars = new Set<string>();
  for (const m of matches) {
    if (m[1]) {
      vars.add(m[1].trim());
    }
  }
  return [...vars];
}

export interface PromptTemplateRepository {
  create(
    userId: string,
    data: { name: string; title: string; content: string; variables?: string[] },
  ): Promise<PromptTemplateRecord>;
  get(userId: string, idOrName: string): Promise<PromptTemplateRecord | null>;
  list(userId: string): Promise<PromptTemplateRecord[]>;
  update(
    userId: string,
    id: string,
    updates: { title?: string; content?: string; variables?: string[] },
  ): Promise<PromptTemplateRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

export class SqlPromptTemplateRepository implements PromptTemplateRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async create(
    userId: string,
    data: { name: string; title: string; content: string; variables?: string[] },
  ): Promise<PromptTemplateRecord> {
    const vars = data.variables ?? extractTemplateVariables(data.content);
    const normalizedName = data.name.trim().toLowerCase().replace(/^\/+/, '');

    const [created] = await this.db
      .insert(promptTemplates)
      .values({
        userId,
        name: normalizedName,
        title: data.title.trim(),
        content: data.content,
        variables: vars,
      })
      .returning();

    if (!created) throw new Error('Failed to create prompt template');
    return this.mapRow(created);
  }

  async get(userId: string, idOrName: string): Promise<PromptTemplateRecord | null> {
    const clean = idOrName.trim().toLowerCase().replace(/^\/+/, '');
    const [row] = await this.db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.userId, userId),
          or(eq(promptTemplates.id, idOrName), eq(promptTemplates.name, clean)),
        ),
      );

    return row ? this.mapRow(row) : null;
  }

  async list(userId: string): Promise<PromptTemplateRecord[]> {
    const rows = await this.db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.userId, userId))
      .orderBy(promptTemplates.name);

    return rows.map((r) => this.mapRow(r));
  }

  async update(
    userId: string,
    id: string,
    updates: { title?: string; content?: string; variables?: string[] },
  ): Promise<PromptTemplateRecord | null> {
    const values: Partial<PromptTemplateRow> = {
      updatedAt: new Date(),
    };
    if (updates.title !== undefined) values.title = updates.title.trim();
    if (updates.content !== undefined) {
      values.content = updates.content;
      values.variables = updates.variables ?? extractTemplateVariables(updates.content);
    } else if (updates.variables !== undefined) {
      values.variables = updates.variables;
    }

    const [row] = await this.db
      .update(promptTemplates)
      .set(values)
      .where(and(eq(promptTemplates.id, id), eq(promptTemplates.userId, userId)))
      .returning();

    return row ? this.mapRow(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(promptTemplates)
      .where(and(eq(promptTemplates.id, id), eq(promptTemplates.userId, userId)))
      .returning({ id: promptTemplates.id });

    return rows.length > 0;
  }

  private mapRow(r: PromptTemplateRow): PromptTemplateRecord {
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      title: r.title,
      content: r.content,
      variables: (r.variables as string[]) ?? [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

export class InMemoryPromptTemplateRepository implements PromptTemplateRepository {
  private templates = new Map<string, PromptTemplateRecord>();

  async create(
    userId: string,
    data: { name: string; title: string; content: string; variables?: string[] },
  ): Promise<PromptTemplateRecord> {
    const vars = data.variables ?? extractTemplateVariables(data.content);
    const normalizedName = data.name.trim().toLowerCase().replace(/^\/+/, '');
    const id = crypto.randomUUID();
    const now = new Date();

    const record: PromptTemplateRecord = {
      id,
      userId,
      name: normalizedName,
      title: data.title.trim(),
      content: data.content,
      variables: vars,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(id, record);
    return { ...record };
  }

  async get(userId: string, idOrName: string): Promise<PromptTemplateRecord | null> {
    const clean = idOrName.trim().toLowerCase().replace(/^\/+/, '');
    for (const t of this.templates.values()) {
      if (t.userId === userId && (t.id === idOrName || t.name === clean)) {
        return { ...t };
      }
    }
    return null;
  }

  async list(userId: string): Promise<PromptTemplateRecord[]> {
    return [...this.templates.values()]
      .filter((t) => t.userId === userId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ ...t }));
  }

  async update(
    userId: string,
    id: string,
    updates: { title?: string; content?: string; variables?: string[] },
  ): Promise<PromptTemplateRecord | null> {
    const target = this.templates.get(id);
    if (!target || target.userId !== userId) return null;

    if (updates.title !== undefined) target.title = updates.title.trim();
    if (updates.content !== undefined) {
      target.content = updates.content;
      target.variables = updates.variables ?? extractTemplateVariables(updates.content);
    } else if (updates.variables !== undefined) {
      target.variables = updates.variables;
    }
    target.updatedAt = new Date();
    return { ...target };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const target = this.templates.get(id);
    if (!target || target.userId !== userId) return false;
    this.templates.delete(id);
    return true;
  }
}
