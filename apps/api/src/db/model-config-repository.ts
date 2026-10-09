import { and, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { modelConfigs, modelProviders } from './schema.ts';
import type { ModelCapability } from '@personal-ai-os/model-gateway';

export type ActiveModelRecord = {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  costMetadata?: Record<string, unknown> | undefined;
};

export interface ModelConfigRepository {
  upsertProvider(
    name: string,
    baseUrl: string,
    enabled?: boolean,
  ): Promise<{ id: string; name: string; baseUrl: string; enabled: boolean }>;
  upsertModelConfig(
    providerId: string,
    model: string,
    capabilities: ModelCapability[],
    contextWindow?: number,
    costMetadata?: Record<string, unknown>,
    enabled?: boolean,
  ): Promise<{ id: string; model: string; capabilities: ModelCapability[]; contextWindow: number }>;
  listActiveModels(): Promise<ActiveModelRecord[]>;
}

export class SqlModelConfigRepository implements ModelConfigRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async upsertProvider(
    name: string,
    baseUrl: string,
    enabled = true,
  ): Promise<{ id: string; name: string; baseUrl: string; enabled: boolean }> {
    const [existing] = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.name, name))
      .limit(1);

    if (existing) {
      const [updated] = await this.db
        .update(modelProviders)
        .set({ baseUrl, enabled })
        .where(eq(modelProviders.id, existing.id))
        .returning();
      if (!updated) throw new Error('Failed to update provider');
      return {
        id: updated.id,
        name: updated.name,
        baseUrl: updated.baseUrl,
        enabled: updated.enabled,
      };
    }

    const [created] = await this.db
      .insert(modelProviders)
      .values({ name, baseUrl, enabled })
      .returning();
    if (!created) throw new Error('Failed to insert provider');
    return {
      id: created.id,
      name: created.name,
      baseUrl: created.baseUrl,
      enabled: created.enabled,
    };
  }

  async upsertModelConfig(
    providerId: string,
    model: string,
    capabilities: ModelCapability[],
    contextWindow = 4096,
    costMetadata?: Record<string, unknown>,
    enabled = true,
  ): Promise<{
    id: string;
    model: string;
    capabilities: ModelCapability[];
    contextWindow: number;
  }> {
    const [existing] = await this.db
      .select()
      .from(modelConfigs)
      .where(and(eq(modelConfigs.providerId, providerId), eq(modelConfigs.model, model)))
      .limit(1);

    if (existing) {
      const [updated] = await this.db
        .update(modelConfigs)
        .set({ capabilities, contextWindow, costMetadata, enabled })
        .where(eq(modelConfigs.id, existing.id))
        .returning();
      if (!updated) throw new Error('Failed to update model config');
      return {
        id: updated.id,
        model: updated.model,
        capabilities: updated.capabilities as ModelCapability[],
        contextWindow: updated.contextWindow ?? 4096,
      };
    }

    const [created] = await this.db
      .insert(modelConfigs)
      .values({ providerId, model, capabilities, contextWindow, costMetadata, enabled })
      .returning();
    if (!created) throw new Error('Failed to insert model config');
    return {
      id: created.id,
      model: created.model,
      capabilities: created.capabilities as ModelCapability[],
      contextWindow: created.contextWindow ?? 4096,
    };
  }

  async listActiveModels(): Promise<ActiveModelRecord[]> {
    const rows = await this.db
      .select({
        id: modelConfigs.id,
        providerId: modelConfigs.providerId,
        providerName: modelProviders.name,
        baseUrl: modelProviders.baseUrl,
        model: modelConfigs.model,
        capabilities: modelConfigs.capabilities,
        contextWindow: modelConfigs.contextWindow,
        costMetadata: modelConfigs.costMetadata,
      })
      .from(modelConfigs)
      .innerJoin(modelProviders, eq(modelConfigs.providerId, modelProviders.id))
      .where(and(eq(modelConfigs.enabled, true), eq(modelProviders.enabled, true)));

    return rows.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      providerName: row.providerName,
      baseUrl: row.baseUrl,
      model: row.model,
      capabilities: (row.capabilities as ModelCapability[]) ?? ['chat'],
      contextWindow: row.contextWindow ?? 4096,
      costMetadata: (row.costMetadata as Record<string, unknown> | null) ?? undefined,
    }));
  }
}

export class InMemoryModelConfigRepository implements ModelConfigRepository {
  private providers = new Map<
    string,
    { id: string; name: string; baseUrl: string; enabled: boolean }
  >();
  private configs = new Map<
    string,
    {
      id: string;
      providerId: string;
      model: string;
      capabilities: ModelCapability[];
      contextWindow: number;
      costMetadata?: Record<string, unknown> | undefined;
      enabled: boolean;
    }
  >();

  async upsertProvider(
    name: string,
    baseUrl: string,
    enabled = true,
  ): Promise<{ id: string; name: string; baseUrl: string; enabled: boolean }> {
    const existing = [...this.providers.values()].find((p) => p.name === name);
    if (existing) {
      existing.baseUrl = baseUrl;
      existing.enabled = enabled;
      return existing;
    }
    const record = { id: `provider-${this.providers.size + 1}`, name, baseUrl, enabled };
    this.providers.set(record.id, record);
    return record;
  }

  async upsertModelConfig(
    providerId: string,
    model: string,
    capabilities: ModelCapability[],
    contextWindow = 4096,
    costMetadata?: Record<string, unknown>,
    enabled = true,
  ): Promise<{
    id: string;
    model: string;
    capabilities: ModelCapability[];
    contextWindow: number;
  }> {
    const existing = [...this.configs.values()].find(
      (c) => c.providerId === providerId && c.model === model,
    );
    if (existing) {
      existing.capabilities = capabilities;
      existing.contextWindow = contextWindow;
      existing.costMetadata = costMetadata;
      existing.enabled = enabled;
      return existing;
    }
    const record = {
      id: `config-${this.configs.size + 1}`,
      providerId,
      model,
      capabilities,
      contextWindow,
      costMetadata,
      enabled,
    };
    this.configs.set(record.id, record);
    return record;
  }

  async listActiveModels(): Promise<ActiveModelRecord[]> {
    const result: ActiveModelRecord[] = [];
    for (const config of this.configs.values()) {
      if (!config.enabled) continue;
      const provider = this.providers.get(config.providerId);
      if (!provider || !provider.enabled) continue;
      result.push({
        id: config.id,
        providerId: config.providerId,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        model: config.model,
        capabilities: config.capabilities,
        contextWindow: config.contextWindow,
        costMetadata: config.costMetadata,
      });
    }
    return result;
  }
}
