import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

export interface McpServerRecord {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string | null | undefined;
  args?: string[] | null | undefined;
  url?: string | null | undefined;
  allowedCapabilities: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'connected' | 'disconnected' | 'error' | 'pending_approval';
  approvalId?: string | null | undefined;
  isApproved: boolean;
  createdBy?: string | null | undefined;
  lastSeenAt?: Date | null | undefined;
  lastError?: string | null | undefined;
  updatedAt: Date;
  createdAt: Date;
}

export interface McpCallLogRecord {
  id: string;
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown> | null | undefined;
  durationMs: number;
  status: 'success' | 'failure';
  error?: string | null | undefined;
  createdAt: Date;
}

export interface McpRepository {
  listServers(): Promise<McpServerRecord[]>;
  getServerById(id: string): Promise<McpServerRecord | null>;
  createServer(server: Omit<McpServerRecord, 'createdAt' | 'updatedAt'>): Promise<McpServerRecord>;
  updateServerStatus(
    id: string,
    status: McpServerRecord['status'],
    error?: string | null,
  ): Promise<McpServerRecord | null>;
  deleteServer(id: string): Promise<boolean>;
  logCall(entry: Omit<McpCallLogRecord, 'id' | 'createdAt'>): Promise<McpCallLogRecord>;
  listCallLogs(options?: { serverId?: string | undefined; limit?: number | undefined }): Promise<McpCallLogRecord[]>;
}

export class InMemoryMcpRepository implements McpRepository {
  private readonly servers = new Map<string, McpServerRecord>();
  private readonly callLogs: McpCallLogRecord[] = [];

  async listServers(): Promise<McpServerRecord[]> {
    return Array.from(this.servers.values());
  }

  async getServerById(id: string): Promise<McpServerRecord | null> {
    return this.servers.get(id) ?? null;
  }

  async createServer(
    server: Omit<McpServerRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<McpServerRecord> {
    const now = new Date();
    const created: McpServerRecord = {
      ...server,
      createdAt: now,
      updatedAt: now,
    };
    this.servers.set(server.id, created);
    return created;
  }

  async updateServerStatus(
    id: string,
    status: McpServerRecord['status'],
    error?: string | null,
  ): Promise<McpServerRecord | null> {
    const existing = this.servers.get(id);
    if (!existing) return null;
    const updated: McpServerRecord = {
      ...existing,
      status,
      lastError: error ?? null,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    this.servers.set(id, updated);
    return updated;
  }

  async deleteServer(id: string): Promise<boolean> {
    return this.servers.delete(id);
  }

  async logCall(
    entry: Omit<McpCallLogRecord, 'id' | 'createdAt'>,
  ): Promise<McpCallLogRecord> {
    const log: McpCallLogRecord = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.callLogs.unshift(log);
    return log;
  }

  async listCallLogs(options?: { serverId?: string; limit?: number }): Promise<McpCallLogRecord[]> {
    let list = this.callLogs;
    if (options?.serverId) {
      list = list.filter((l) => l.serverId === options.serverId);
    }
    const limit = options?.limit ?? 50;
    return list.slice(0, limit);
  }
}

export class SqlMcpRepository implements McpRepository {
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  async listServers(): Promise<McpServerRecord[]> {
    const rows = await this.db.select().from(schema.mcpServers);
    return rows.map((r) => this.mapServerRow(r));
  }

  async getServerById(id: string): Promise<McpServerRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.id, id))
      .limit(1);
    return row ? this.mapServerRow(row) : null;
  }

  async createServer(
    server: Omit<McpServerRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<McpServerRecord> {
    const now = new Date();
    const [created] = await this.db
      .insert(schema.mcpServers)
      .values({
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command ?? null,
        args: server.args ?? null,
        url: server.url ?? null,
        allowedCapabilities: server.allowedCapabilities,
        riskLevel: server.riskLevel,
        status: server.status,
        approvalId: server.approvalId ?? null,
        isApproved: server.isApproved,
        createdBy: server.createdBy ?? null,
        lastSeenAt: server.lastSeenAt ?? null,
        lastError: server.lastError ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapServerRow(created!);
  }

  async updateServerStatus(
    id: string,
    status: McpServerRecord['status'],
    error?: string | null,
  ): Promise<McpServerRecord | null> {
    const [updated] = await this.db
      .update(schema.mcpServers)
      .set({
        status,
        lastError: error ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.mcpServers.id, id))
      .returning();

    return updated ? this.mapServerRow(updated) : null;
  }

  async deleteServer(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.mcpServers)
      .where(eq(schema.mcpServers.id, id))
      .returning();
    return deleted.length > 0;
  }

  async logCall(
    entry: Omit<McpCallLogRecord, 'id' | 'createdAt'>,
  ): Promise<McpCallLogRecord> {
    const [created] = await this.db
      .insert(schema.mcpCallLogs)
      .values({
        serverId: entry.serverId,
        toolName: entry.toolName,
        arguments: entry.arguments ?? null,
        durationMs: entry.durationMs,
        status: entry.status,
        error: entry.error ?? null,
      })
      .returning();

    return {
      id: created!.id,
      serverId: created!.serverId,
      toolName: created!.toolName,
      arguments: (created!.arguments as Record<string, unknown>) ?? null,
      durationMs: created!.durationMs,
      status: created!.status as 'success' | 'failure',
      error: created!.error ?? null,
      createdAt: created!.createdAt,
    };
  }

  async listCallLogs(options?: { serverId?: string; limit?: number }): Promise<McpCallLogRecord[]> {
    let query = this.db.select().from(schema.mcpCallLogs);
    if (options?.serverId) {
      query = query.where(eq(schema.mcpCallLogs.serverId, options.serverId)) as typeof query;
    }
    const limit = options?.limit ?? 50;
    const rows = await query.orderBy(desc(schema.mcpCallLogs.createdAt)).limit(limit);

    return rows.map((r) => ({
      id: r.id,
      serverId: r.serverId,
      toolName: r.toolName,
      arguments: (r.arguments as Record<string, unknown>) ?? null,
      durationMs: r.durationMs,
      status: r.status as 'success' | 'failure',
      error: r.error ?? null,
      createdAt: r.createdAt,
    }));
  }

  private mapServerRow(r: schema.McpServerRow): McpServerRecord {
    return {
      id: r.id,
      name: r.name,
      transport: r.transport as 'stdio' | 'sse' | 'http',
      command: r.command,
      args: (r.args as string[]) ?? null,
      url: r.url,
      allowedCapabilities: (r.allowedCapabilities as string[]) ?? [],
      riskLevel: r.riskLevel as McpServerRecord['riskLevel'],
      status: r.status as McpServerRecord['status'],
      approvalId: r.approvalId,
      isApproved: r.isApproved,
      createdBy: r.createdBy,
      lastSeenAt: r.lastSeenAt,
      lastError: r.lastError,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
