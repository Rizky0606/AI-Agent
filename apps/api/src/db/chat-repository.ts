import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { conversations, messages, projects } from './schema.ts';

export type MessageRecord = {
  id: string;
  userId: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata?: Record<string, unknown> | undefined;
  createdAt: Date;
};

export type ConversationRecord = {
  id: string;
  userId: string;
  projectId: string;
  title?: string | null | undefined;
  createdAt: Date;
};

export interface ChatRepository {
  getOrCreateDefaultProject(userId: string): Promise<string>;
  getOrCreateConversation(
    userId: string,
    projectId: string,
    conversationId?: string,
    title?: string,
  ): Promise<string>;
  createConversation(
    userId: string,
    projectId: string,
    title?: string,
  ): Promise<ConversationRecord>;
  listConversations(userId: string, projectId: string): Promise<ConversationRecord[]>;
  getConversation(userId: string, conversationId: string): Promise<ConversationRecord | null>;
  updateConversation(
    userId: string,
    conversationId: string,
    updates: { title?: string },
  ): Promise<ConversationRecord | null>;
  deleteConversation(userId: string, conversationId: string): Promise<boolean>;
  appendMessage(
    userId: string,
    conversationId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MessageRecord>;
  getMessages(userId: string, conversationId: string): Promise<MessageRecord[]>;
}

export class SqlChatRepository implements ChatRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getOrCreateDefaultProject(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.name, 'Default Project')))
      .limit(1);

    if (existing) return existing.id;

    const [created] = await this.db
      .insert(projects)
      .values({
        userId,
        name: 'Default Project',
        description: 'Auto-created default project for conversations',
      })
      .returning({ id: projects.id });

    if (!created) throw new Error('Failed to create default project');
    return created.id;
  }

  async getOrCreateConversation(
    userId: string,
    projectId: string,
    conversationId?: string,
    title?: string,
  ): Promise<string> {
    if (conversationId) {
      const [existing] = await this.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .limit(1);
      if (existing) return existing.id;
    }

    const [created] = await this.db
      .insert(conversations)
      .values({
        userId,
        projectId,
        title: title ?? 'New Conversation',
      })
      .returning({ id: conversations.id });

    if (!created) throw new Error('Failed to create conversation');
    return created.id;
  }

  async createConversation(
    userId: string,
    projectId: string,
    title?: string,
  ): Promise<ConversationRecord> {
    const [created] = await this.db
      .insert(conversations)
      .values({
        userId,
        projectId,
        title: title ?? 'New Conversation',
      })
      .returning();

    if (!created) throw new Error('Failed to create conversation');
    return {
      id: created.id,
      userId: created.userId,
      projectId: created.projectId,
      title: created.title,
      createdAt: created.createdAt,
    };
  }

  async listConversations(userId: string, projectId: string): Promise<ConversationRecord[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.projectId, projectId)))
      .orderBy(desc(conversations.createdAt));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      projectId: r.projectId,
      title: r.title,
      createdAt: r.createdAt,
    }));
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      title: row.title,
      createdAt: row.createdAt,
    };
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    updates: { title?: string },
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ title: updates.title })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .returning();

    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      title: row.title,
      createdAt: row.createdAt,
    };
  }

  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const res = await this.db
      .delete(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });

    return res.length > 0;
  }

  async appendMessage(
    userId: string,
    conversationId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MessageRecord> {
    const [created] = await this.db
      .insert(messages)
      .values({
        userId,
        conversationId,
        role,
        content,
        metadata,
      })
      .returning();

    if (!created) throw new Error('Failed to insert message');
    return {
      id: created.id,
      userId: created.userId,
      conversationId: created.conversationId,
      role: created.role as 'system' | 'user' | 'assistant' | 'tool',
      content: created.content,
      metadata: (created.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: created.createdAt,
    };
  }

  async getMessages(userId: string, conversationId: string): Promise<MessageRecord[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)))
      .orderBy(desc(messages.createdAt));

    return rows.reverse().map((r) => ({
      id: r.id,
      userId: r.userId,
      conversationId: r.conversationId,
      role: r.role as 'system' | 'user' | 'assistant' | 'tool',
      content: r.content,
      metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: r.createdAt,
    }));
  }
}

export class InMemoryChatRepository implements ChatRepository {
  private projects = new Map<string, { id: string; userId: string; name: string }>();
  private conversations = new Map<
    string,
    { id: string; userId: string; projectId: string; title: string; createdAt: Date }
  >();
  private messages: MessageRecord[] = [];

  async getOrCreateDefaultProject(userId: string): Promise<string> {
    const existing = [...this.projects.values()].find(
      (p) => p.userId === userId && p.name === 'Default Project',
    );
    if (existing) return existing.id;
    const id = `project-${this.projects.size + 1}`;
    this.projects.set(id, { id, userId, name: 'Default Project' });
    return id;
  }

  async getOrCreateConversation(
    userId: string,
    projectId: string,
    conversationId?: string,
    title?: string,
  ): Promise<string> {
    if (conversationId && this.conversations.has(conversationId)) {
      const conv = this.conversations.get(conversationId)!;
      if (conv.userId === userId) return conv.id;
    }
    const id = conversationId ?? crypto.randomUUID();
    this.conversations.set(id, {
      id,
      userId,
      projectId,
      title: title ?? 'New Conversation',
      createdAt: new Date(),
    });
    return id;
  }

  async createConversation(
    userId: string,
    projectId: string,
    title?: string,
  ): Promise<ConversationRecord> {
    const id = crypto.randomUUID();
    const conv = {
      id,
      userId,
      projectId,
      title: title ?? 'New Conversation',
      createdAt: new Date(),
    };
    this.conversations.set(id, conv);
    return { ...conv };
  }

  async listConversations(userId: string, projectId: string): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId && c.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((c) => ({ ...c }));
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return null;
    return { ...conv };
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    updates: { title?: string },
  ): Promise<ConversationRecord | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return null;
    if (updates.title !== undefined) conv.title = updates.title;
    return { ...conv };
  }

  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return false;
    this.conversations.delete(conversationId);
    this.messages = this.messages.filter((m) => m.conversationId !== conversationId);
    return true;
  }

  async appendMessage(
    userId: string,
    conversationId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MessageRecord> {
    const msg: MessageRecord = {
      id: crypto.randomUUID(),
      userId,
      conversationId,
      role,
      content,
      metadata,
      createdAt: new Date(),
    };
    this.messages.push(msg);
    return msg;
  }

  async getMessages(userId: string, conversationId: string): Promise<MessageRecord[]> {
    return this.messages.filter((m) => m.userId === userId && m.conversationId === conversationId);
  }
}
