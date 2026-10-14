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

export type SessionMode = 'auto' | 'fast' | 'coding' | 'complex' | 'research';

export type ConversationMetadata = {
  mode?: SessionMode;
  model?: string | null;
  workspaceId?: string | null;
  parentConversationId?: string | null;
  compactedSummary?: string | null;
  lastEventId?: string | null;
  archivedAt?: Date | null;
};

export type ConversationRecord = {
  id: string;
  userId: string;
  projectId: string;
  title?: string | null | undefined;
  mode: SessionMode;
  model?: string | null;
  workspaceId?: string | null;
  parentConversationId?: string | null;
  compactedSummary?: string | null;
  lastEventId?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
};

export interface ChatRepository {
  getOrCreateDefaultProject(userId: string): Promise<string>;
  getOrCreateConversation(
    userId: string,
    projectId: string,
    conversationId?: string,
    title?: string,
    metadata?: ConversationMetadata,
  ): Promise<string>;
  createConversation(
    userId: string,
    projectId: string,
    title?: string,
    metadata?: ConversationMetadata,
  ): Promise<ConversationRecord>;
  listConversations(userId: string, projectId?: string): Promise<ConversationRecord[]>;
  getConversation(userId: string, conversationId: string): Promise<ConversationRecord | null>;
  updateConversation(
    userId: string,
    conversationId: string,
    updates: { title?: string } & ConversationMetadata,
  ): Promise<ConversationRecord | null>;
  deleteConversation(userId: string, conversationId: string): Promise<boolean>;
  appendMessage(
    userId: string,
    conversationId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string,
    metadata?: Record<string, unknown>,
    id?: string,
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
    metadata?: ConversationMetadata,
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
      .values({ userId, projectId, title: title ?? 'New Conversation', ...metadata })
      .returning({ id: conversations.id });
    if (!created) throw new Error('Failed to create conversation');
    return created.id;
  }

  async createConversation(
    userId: string,
    projectId: string,
    title?: string,
    metadata?: ConversationMetadata,
  ): Promise<ConversationRecord> {
    const [created] = await this.db
      .insert(conversations)
      .values({ userId, projectId, title: title ?? 'New Conversation', ...metadata })
      .returning();

    if (!created) throw new Error('Failed to create conversation');
    return { ...created, mode: created.mode as SessionMode };
  }

  async listConversations(userId: string, projectId?: string): Promise<ConversationRecord[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), projectId ? eq(conversations.projectId, projectId) : undefined))
      .orderBy(desc(conversations.createdAt));

    return rows.map((r) => ({ ...r, mode: r.mode as SessionMode }));
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
    return { ...row, mode: row.mode as SessionMode };
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    updates: { title?: string } & ConversationMetadata,
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .update(conversations)
      .set(updates)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .returning();
    if (!row) return null;
    return { ...row, mode: row.mode as SessionMode };
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
    id?: string,
  ): Promise<MessageRecord> {
    const [created] = await this.db
      .insert(messages)
      .values({
        id,
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
  private conversations = new Map<string, ConversationRecord>();
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
    metadata?: ConversationMetadata,
  ): Promise<string> {
    if (conversationId && this.conversations.has(conversationId)) {
      const conv = this.conversations.get(conversationId)!;
      if (conv.userId === userId) return conv.id;
    }
    const id = crypto.randomUUID();
    this.conversations.set(id, {
      id,
      userId,
      projectId,
      title: title ?? 'New Conversation',
      mode: metadata?.mode ?? 'auto',
      ...metadata,
      createdAt: new Date(),
    });
    return id;
  }

  async createConversation(
    userId: string,
    projectId: string,
    title?: string,
    metadata?: ConversationMetadata,
  ): Promise<ConversationRecord> {
    const conv: ConversationRecord = {
      id: crypto.randomUUID(), userId, projectId,
      title: title ?? 'New Conversation', mode: metadata?.mode ?? 'auto',
      ...metadata, createdAt: new Date(),
    };
    this.conversations.set(conv.id, conv);
    return { ...conv };
  }

  async listConversations(userId: string, projectId?: string): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId && (!projectId || c.projectId === projectId))
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
    updates: { title?: string } & ConversationMetadata,
  ): Promise<ConversationRecord | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return null;
    if (updates.title !== undefined) conv.title = updates.title;
    Object.assign(conv, updates);
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
    id?: string,
  ): Promise<MessageRecord> {
    const msg: MessageRecord = {
      id: id ?? crypto.randomUUID(),
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
