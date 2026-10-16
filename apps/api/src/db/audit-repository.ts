import crypto from 'node:crypto';
import type { AuditLogEntry, AuditLogger } from '@personal-ai-os/permissions';
import type { ArtifactAuditRecord } from '@personal-ai-os/tools';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { auditLogs } from './schema.ts';

const SENSITIVE_PATTERNS = /(password|secret|token|key|authorization|credential)/i;

export const redactAuditMetadata = (data: unknown): unknown => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactAuditMetadata(item));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_PATTERNS.test(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactAuditMetadata(v);
    } else {
      result[k] = v;
    }
  }
  return result;
};

/** Maps a stored artifact onto the audit row that records the write. */
export const artifactWriteAuditEntry = (record: ArtifactAuditRecord): AuditLogEntry => ({
  userId: record.ownerId,
  projectId: record.projectId ?? null,
  action: 'artifact:write',
  resourceType: 'artifact',
  resourceId: record.artifactId,
  decision: 'allow',
  metadata: {
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    checksum: record.checksum,
    taskId: record.taskId ?? null,
  },
});

export interface AuditRepository extends AuditLogger {
  log(entry: AuditLogEntry): Promise<void>;
  listAuditLogs(
    userId: string,
    options?: { projectId?: string | undefined; limit?: number | undefined },
  ): Promise<AuditLogEntry[]>;
}

export class SqlAuditRepository implements AuditRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const sanitizedMetadata = entry.metadata
      ? (redactAuditMetadata(entry.metadata) as Record<string, unknown>)
      : null;

    await this.db.insert(auditLogs).values({
      userId: entry.userId ?? null,
      projectId: entry.projectId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      decision: entry.decision,
      traceId: entry.traceId ?? null,
      metadata: sanitizedMetadata,
    });
  }

  async listAuditLogs(
    userId: string,
    options?: { projectId?: string | undefined; limit?: number | undefined },
  ): Promise<AuditLogEntry[]> {
    const conditions = [eq(auditLogs.userId, userId)];
    if (options?.projectId) {
      conditions.push(eq(auditLogs.projectId, options.projectId));
    }

    const query = this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt));

    const rows = options?.limit ? await query.limit(options.limit) : await query;

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      projectId: r.projectId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      decision: (r.decision as AuditLogEntry['decision']) ?? 'allow',
      traceId: r.traceId,
      metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: r.createdAt,
    }));
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private logs: AuditLogEntry[] = [];

  async log(entry: AuditLogEntry): Promise<void> {
    const sanitizedMetadata = entry.metadata
      ? (redactAuditMetadata(entry.metadata) as Record<string, unknown>)
      : undefined;
    this.logs.push({
      ...entry,
      id: crypto.randomUUID(),
      metadata: sanitizedMetadata,
      createdAt: new Date(),
    });
  }

  async listAuditLogs(
    userId: string,
    options?: { projectId?: string | undefined; limit?: number | undefined },
  ): Promise<AuditLogEntry[]> {
    let filtered = this.logs
      .filter(
        (l) => l.userId === userId && (!options?.projectId || l.projectId === options.projectId),
      )
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered.map((l) => ({ ...l }));
  }
}
