import type { RiskLevel } from '@personal-ai-os/permissions';
import type { McpServerConfig } from '../types.ts';

/** Launch details for one stdio server, kept separate from the hub-facing config. */
export interface StdioMcpLaunchSpec {
  command: string;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
}

export interface StdioMcpServerDefinition {
  /** Passed to `McpHub.registerServer`. */
  config: McpServerConfig;
  /** Passed to `StdioMcpServerAdapter`. */
  launch: StdioMcpLaunchSpec;
  /**
   * Capability stamped on every tool this server exposes. MCP has no capability
   * concept, so the operator declares one and `McpHub` allows exactly that.
   */
  capability: string;
}

const RISK_LEVELS: Record<string, RiskLevel> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

/** External servers are untrusted by default, so an omitted risk level is never the lowest. */
const DEFAULT_RISK_LEVEL: RiskLevel = 'MEDIUM';

/**
 * Parses the `MCP_SERVERS` environment variable into launch definitions.
 *
 * The value is a JSON array of objects:
 * ```json
 * [{"id":"docs","command":"npx","args":["-y","@acme/mcp-docs"],"capability":"docs:read"}]
 * ```
 *
 * Throws on any malformed entry instead of skipping it. A typo that silently
 * registered nothing would look identical to a server with no tools, and the
 * operator would have no way to tell the difference.
 *
 * SECURITY: this grants arbitrary local process execution to whoever can set the
 * variable. It is a deployment-time control and must never be driven by end-user input.
 */
export function parseMcpServerDefinitions(raw: string | undefined): StdioMcpServerDefinition[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: unknown) {
    throw new Error(
      `MCP_SERVERS bukan JSON yang valid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('MCP_SERVERS harus berupa array JSON.');
  }

  return parsed.map((entry, index) => parseEntry(entry, index));
}

function parseEntry(entry: unknown, index: number): StdioMcpServerDefinition {
  const where = `MCP_SERVERS[${index}]`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`${where} harus berupa objek.`);
  }

  const record = entry as Record<string, unknown>;
  const id = requireString(record, 'id', where);
  const command = requireString(record, 'command', where);
  const capability = requireString(record, 'capability', where);

  const name = optionalString(record, 'name', where) ?? id;
  const cwd = optionalString(record, 'cwd', where);

  const rawRisk = record['riskLevel'];
  let riskLevel = DEFAULT_RISK_LEVEL;
  if (rawRisk !== undefined) {
    if (typeof rawRisk !== 'string') {
      throw new Error(`${where}.riskLevel harus berupa string.`);
    }
    const normalized = RISK_LEVELS[rawRisk.toUpperCase()];
    if (!normalized) {
      throw new Error(
        `${where}.riskLevel '${rawRisk}' tidak dikenal. Gunakan salah satu dari ${Object.keys(RISK_LEVELS).join(', ')}.`,
      );
    }
    riskLevel = normalized;
  }

  const launch: StdioMcpLaunchSpec = { command };
  const args = optionalStringArray(record, 'args', where);
  if (args) launch.args = args;
  const env = optionalStringRecord(record, 'env', where);
  if (env) launch.env = env;
  if (cwd) launch.cwd = cwd;

  const config: McpServerConfig = {
    id,
    name,
    transport: 'stdio',
    allowedCapabilities: [capability],
    riskLevel,
  };

  return { config, launch, capability };
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where}.${key} wajib diisi dan harus berupa string tidak kosong.`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${where}.${key} harus berupa string.`);
  }
  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${where}.${key} harus berupa array string.`);
  }
  return value as string[];
}

function optionalStringRecord(
  record: Record<string, unknown>,
  key: string,
  where: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where}.${key} harus berupa objek berisi string.`);
  }
  const entries = Object.entries(value);
  for (const [entryKey, entryValue] of entries) {
    if (typeof entryValue !== 'string') {
      throw new Error(`${where}.${key}.${entryKey} harus berupa string.`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
