import type { RiskLevel } from '@personal-ai-os/permissions';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'in_process' | 'stdio' | 'sse';
  allowedCapabilities: string[]; // Explicit capability allowlist
  riskLevel: RiskLevel;
  metadata?: Record<string, unknown> | undefined;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  capability: string;
  inputSchema?: Record<string, unknown> | undefined;
  outputSchema?: Record<string, unknown> | undefined;
}

export interface McpCallResult {
  serverId: string;
  toolName: string;
  rawContent: string;
  sanitizedContent: string;
  isUntrusted: true; // Strictly marked as untrusted
  isInstruction: false; // Must NEVER be treated as an instruction
  provenance: 'mcp';
  durationMs: number;
  timestamp: string;
  error?: string | undefined;
}

export interface McpServerAdapter {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal | undefined,
  ): Promise<{ content: string; error?: string }>;
  close?(): Promise<void>;
}

export interface McpAuditLog {
  traceId?: string | undefined;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  durationMs: number;
  status: 'success' | 'failure';
  error?: string | undefined;
  timestamp: string;
}

export class McpError extends Error {
  readonly serverId: string;

  constructor(message: string, serverId: string) {
    super(message);
    this.name = 'McpError';
    this.serverId = serverId;
  }
}

export class McpCapabilityViolationError extends McpError {
  readonly capability: string;

  constructor(serverId: string, capability: string) {
    super(
      `Server MCP '${serverId}' mencoba mengeksekusi capability '${capability}' yang tidak ada dalam daftar allowlist.`,
      serverId,
    );
    this.name = 'McpCapabilityViolationError';
    this.capability = capability;
  }
}
