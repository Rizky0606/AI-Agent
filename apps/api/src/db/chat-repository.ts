import crypto from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from './client.ts';
import { conversations, messages, projects } from './schema.ts';

export type MessageRecord = {
  id: string;
  userId: string;
  conversationId: string;
  parentMessageId?: string | null | undefined;
  isActiveBranch?: boolean | undefined;
  branchIndex?: number | undefined;
  branchCount?: number | undefined;
  siblingMessageIds?: string[] | undefined;
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
    parentMessageId?: string | null,
  ): Promise<MessageRecord>;
  getMessages(
    userId: string,
    conversationId: string,
    options?: { allTree?: boolean },
  ): Promise<MessageRecord[]>;
  switchBranch(
    userId: string,
    conversationId: string,
    targetMessageId: string,
  ): Promise<MessageRecord[]>;
  deleteBranch(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<boolean>;
  compactConversation(
    userId: string,
    conversationId: string,
    summary: string,
  ): Promise<ConversationRecord | null>;
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
    parentMessageId?: string | null,
  ): Promise<MessageRecord> {
    let resolvedParentId = parentMessageId;
    if (resolvedParentId === undefined) {
      const [lastActive] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.userId, userId),
            eq(messages.conversationId, conversationId),
            eq(messages.isActiveBranch, true),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(1);
      resolvedParentId = lastActive?.id ?? null;
    }

    const [created] = await this.db
      .insert(messages)
      .values({
        id,
        userId,
        conversationId,
        parentMessageId: resolvedParentId,
        isActiveBranch: true,
        branchIndex: 0,
        role,
        content,
        metadata,
      })
      .returning();

    if (!created) throw new Error('Failed to insert message');

    // If explicit branching specified, update active path
    if (parentMessageId !== undefined) {
      await this.switchBranch(userId, conversationId, created.id);
    }

    const siblings = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.conversationId, conversationId),
          resolvedParentId === null || resolvedParentId === undefined
            ? isNull(messages.parentMessageId)
            : eq(messages.parentMessageId, resolvedParentId),
        ),
      )
      .orderBy(asc(messages.createdAt));

    const siblingIds = siblings.map((s) => s.id);
    const branchIndex = siblingIds.indexOf(created.id);

    return {
      id: created.id,
      userId: created.userId,
      conversationId: created.conversationId,
      parentMessageId: created.parentMessageId,
      isActiveBranch: created.isActiveBranch,
      branchIndex: branchIndex >= 0 ? branchIndex : 0,
      branchCount: siblingIds.length,
      siblingMessageIds: siblingIds,
      role: created.role as 'system' | 'user' | 'assistant' | 'tool',
      content: created.content,
      metadata: (created.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: created.createdAt,
    };
  }

  async getMessages(
    userId: string,
    conversationId: string,
    options?: { allTree?: boolean },
  ): Promise<MessageRecord[]> {
    const allRows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)))
      .orderBy(messages.createdAt);

    // Compute sibling counts and indices
    const parentGroups = new Map<string, string[]>();
    for (const r of allRows) {
      const pKey = r.parentMessageId ?? 'ROOT';
      const list = parentGroups.get(pKey) ?? [];
      list.push(r.id);
      parentGroups.set(pKey, list);
    }

    const decorated: MessageRecord[] = allRows.map((r) => {
      const pKey = r.parentMessageId ?? 'ROOT';
      const siblings = parentGroups.get(pKey) ?? [r.id];
      const idx = siblings.indexOf(r.id);
      return {
        id: r.id,
        userId: r.userId,
        conversationId: r.conversationId,
        parentMessageId: r.parentMessageId,
        isActiveBranch: r.isActiveBranch,
        branchIndex: idx >= 0 ? idx : r.branchIndex,
        branchCount: siblings.length,
        siblingMessageIds: siblings,
        role: r.role as 'system' | 'user' | 'assistant' | 'tool',
        content: r.content,
        metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
        createdAt: r.createdAt,
      };
    });

    if (options?.allTree) {
      return decorated;
    }

    return decorated.filter((m) => m.isActiveBranch);
  }

  async switchBranch(
    userId: string,
    conversationId: string,
    targetMessageId: string,
  ): Promise<MessageRecord[]> {
    const all = await this.getMessages(userId, conversationId, { allTree: true });
    const target = all.find((m) => m.id === targetMessageId);
    if (!target) return all.filter((m) => m.isActiveBranch);

    const map = new Map<string, MessageRecord>(all.map((m) => [m.id, m]));
    const childrenMap = new Map<string, MessageRecord[]>();
    for (const m of all) {
      const pKey = m.parentMessageId ?? 'ROOT';
      const list = childrenMap.get(pKey) ?? [];
      list.push(m);
      childrenMap.set(pKey, list);
    }

    const activeSet = new Set<string>();

    // Walk up from target to root
    let curr: MessageRecord | undefined = target;
    while (curr) {
      activeSet.add(curr.id);
      curr = curr.parentMessageId ? map.get(curr.parentMessageId) : undefined;
    }

    // Walk down from target to leaf
    curr = target;
    while (curr) {
      const children = childrenMap.get(curr.id);
      if (!children || children.length === 0) break;
      const next: MessageRecord = children.find((c) => c.isActiveBranch) ?? children[children.length - 1]!;
      activeSet.add(next.id);
      curr = next;
    }

    // Persist new active branch states
    for (const m of all) {
      const shouldBeActive = activeSet.has(m.id);
      if (m.isActiveBranch !== shouldBeActive) {
        await this.db
          .update(messages)
          .set({ isActiveBranch: shouldBeActive })
          .where(and(eq(messages.id, m.id), eq(messages.conversationId, conversationId)));
      }
    }

    return this.getMessages(userId, conversationId);
  }

  async deleteBranch(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<boolean> {
    const all = await this.getMessages(userId, conversationId, { allTree: true });
    const target = all.find((m) => m.id === messageId);
    if (!target) return false;

    // Collect all descendants recursively
    const childrenMap = new Map<string, string[]>();
    for (const m of all) {
      if (m.parentMessageId) {
        const list = childrenMap.get(m.parentMessageId) ?? [];
        list.push(m.id);
        childrenMap.set(m.parentMessageId, list);
      }
    }

    const toDelete = new Set<string>();
    const queue = [messageId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      toDelete.add(id);
      const kids = childrenMap.get(id);
      if (kids) queue.push(...kids);
    }

    for (const id of toDelete) {
      await this.db
        .delete(messages)
        .where(and(eq(messages.id, id), eq(messages.conversationId, conversationId)));
    }

    // If deleted message was active, activate an available sibling or remaining message
    if (target.isActiveBranch) {
      const targetParent = target.parentMessageId ?? null;
      const siblings = all.filter(
        (m) => (m.parentMessageId ?? null) === targetParent && !toDelete.has(m.id),
      );
      if (siblings.length > 0) {
        await this.switchBranch(userId, conversationId, siblings[siblings.length - 1]!.id);
      } else {
        const remaining = all.filter((m) => !toDelete.has(m.id));
        if (remaining.length > 0) {
          await this.switchBranch(userId, conversationId, remaining[remaining.length - 1]!.id);
        }
      }
    }

    return true;
  }

  async compactConversation(
    userId: string,
    conversationId: string,
    summary: string,
  ): Promise<ConversationRecord | null> {
    return this.updateConversation(userId, conversationId, { compactedSummary: summary });
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
    parentMessageId?: string | null,
  ): Promise<MessageRecord> {
    let resolvedParentId = parentMessageId;
    if (resolvedParentId === undefined) {
      const active = this.messages
        .filter((m) => m.userId === userId && m.conversationId === conversationId && m.isActiveBranch)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      resolvedParentId = active[0]?.id ?? null;
    }

    const msg: MessageRecord = {
      id: id ?? crypto.randomUUID(),
      userId,
      conversationId,
      parentMessageId: resolvedParentId,
      isActiveBranch: true,
      branchIndex: 0,
      role,
      content,
      metadata,
      createdAt: new Date(Date.now() + this.messages.length),
    };
    this.messages.push(msg);

    if (parentMessageId !== undefined) {
      await this.switchBranch(userId, conversationId, msg.id);
    }

    const siblings = this.messages
      .filter((m) => m.userId === userId && m.conversationId === conversationId && (m.parentMessageId ?? null) === (resolvedParentId ?? null))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => m.id);
    const branchIndex = siblings.indexOf(msg.id);
    msg.branchIndex = branchIndex >= 0 ? branchIndex : 0;
    msg.branchCount = siblings.length;
    msg.siblingMessageIds = siblings;

    return { ...msg };
  }

  async getMessages(
    userId: string,
    conversationId: string,
    options?: { allTree?: boolean },
  ): Promise<MessageRecord[]> {
    const all = this.messages
      .filter((m) => m.userId === userId && m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const parentGroups = new Map<string, string[]>();
    for (const r of all) {
      const pKey = r.parentMessageId ?? 'ROOT';
      const list = parentGroups.get(pKey) ?? [];
      list.push(r.id);
      parentGroups.set(pKey, list);
    }

    const decorated: MessageRecord[] = all.map((r) => {
      const pKey = r.parentMessageId ?? 'ROOT';
      const siblings = parentGroups.get(pKey) ?? [r.id];
      const idx = siblings.indexOf(r.id);
      return {
        ...r,
        branchIndex: idx >= 0 ? idx : 0,
        branchCount: siblings.length,
        siblingMessageIds: siblings,
      };
    });

    if (options?.allTree) return decorated;
    return decorated.filter((m) => m.isActiveBranch);
  }

  async switchBranch(
    userId: string,
    conversationId: string,
    targetMessageId: string,
  ): Promise<MessageRecord[]> {
    const all = await this.getMessages(userId, conversationId, { allTree: true });
    const target = all.find((m) => m.id === targetMessageId);
    if (!target) return all.filter((m) => m.isActiveBranch);

    const map = new Map<string, MessageRecord>(all.map((m) => [m.id, m]));
    const childrenMap = new Map<string, MessageRecord[]>();
    for (const m of all) {
      const pKey = m.parentMessageId ?? 'ROOT';
      const list = childrenMap.get(pKey) ?? [];
      list.push(m);
      childrenMap.set(pKey, list);
    }

    const activeSet = new Set<string>();

    let curr: MessageRecord | undefined = target;
    while (curr) {
      activeSet.add(curr.id);
      curr = curr.parentMessageId ? map.get(curr.parentMessageId) : undefined;
    }

    curr = target;
    while (curr) {
      const children = childrenMap.get(curr.id);
      if (!children || children.length === 0) break;
      const next: MessageRecord = children.find((c) => c.isActiveBranch) ?? children[children.length - 1]!;
      activeSet.add(next.id);
      curr = next;
    }

    for (const m of this.messages) {
      if (m.conversationId === conversationId) {
        m.isActiveBranch = activeSet.has(m.id);
      }
    }

    return this.getMessages(userId, conversationId);
  }

  async deleteBranch(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<boolean> {
    const all = await this.getMessages(userId, conversationId, { allTree: true });
    const target = all.find((m) => m.id === messageId);
    if (!target) return false;

    const childrenMap = new Map<string, string[]>();
    for (const m of all) {
      if (m.parentMessageId) {
        const list = childrenMap.get(m.parentMessageId) ?? [];
        list.push(m.id);
        childrenMap.set(m.parentMessageId, list);
      }
    }

    const toDelete = new Set<string>();
    const queue = [messageId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      toDelete.add(id);
      const kids = childrenMap.get(id);
      if (kids) queue.push(...kids);
    }

    this.messages = this.messages.filter((m) => !toDelete.has(m.id));

    if (target.isActiveBranch) {
      const targetParent = target.parentMessageId ?? null;
      const siblings = all.filter(
        (m) => (m.parentMessageId ?? null) === targetParent && !toDelete.has(m.id),
      );
      if (siblings.length > 0) {
        await this.switchBranch(userId, conversationId, siblings[siblings.length - 1]!.id);
      } else {
        const remaining = all.filter((m) => !toDelete.has(m.id));
        if (remaining.length > 0) {
          await this.switchBranch(userId, conversationId, remaining[remaining.length - 1]!.id);
        }
      }
    }

    return true;
  }

  async compactConversation(
    userId: string,
    conversationId: string,
    summary: string,
  ): Promise<ConversationRecord | null> {
    return this.updateConversation(userId, conversationId, { compactedSummary: summary });
  }
}
