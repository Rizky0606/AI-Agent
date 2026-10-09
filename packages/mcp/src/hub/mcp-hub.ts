import type { ToolDefinition } from '@personal-ai-os/tools';
import { sanitizeMcpOutput } from '../security/untrusted-sanitizer.ts';
import {
  type McpAuditLog,
  type McpCallResult,
  type McpServerAdapter,
  type McpServerConfig,
  type McpToolDescriptor,
  McpCapabilityViolationError,
  McpError,
} from '../types.ts';

interface RegisteredServer {
  config: McpServerConfig;
  adapter: McpServerAdapter;
  tools: Map<string, McpToolDescriptor>;
}

export interface McpHubOptions {
  auditSink?: ((log: McpAuditLog) => Promise<void> | void) | undefined;
}

export class McpHub {
  private readonly servers = new Map<string, RegisteredServer>();
  private readonly auditLogs: McpAuditLog[] = [];
  private readonly auditSink?: ((log: McpAuditLog) => Promise<void> | void) | undefined;

  constructor(options?: McpHubOptions) {
    this.auditSink = options?.auditSink;
  }

  /**
   * Registers an external MCP server, treating it as strictly UNTRUSTED.
   * Restricts capabilities to the allowlist, and builds ToolDefinitions for ToolRegistry.
   */
  async registerServer(
    config: McpServerConfig,
    adapter: McpServerAdapter,
  ): Promise<ToolDefinition[]> {
    const rawTools = await adapter.listTools();
    const toolMap = new Map<string, McpToolDescriptor>();
    const allowedCapabilitySet = new Set(config.allowedCapabilities);
    const convertedToolDefs: ToolDefinition[] = [];

    for (const tool of rawTools) {
      // 1. Enforce capability allowlist: skip tools with unauthorized capabilities
      if (!allowedCapabilitySet.has(tool.capability)) {
        continue;
      }

      toolMap.set(tool.name, tool);

      // 2. Wrap tool as a safe, untrusted ToolDefinition
      const toolDef: ToolDefinition = {
        name: `mcp_${config.id}_${tool.name}`,
        description: `[MCP: ${config.name}] ${tool.description}`,
        capability: tool.capability,
        resourceScope: 'external_mcp',
        riskLevel: config.riskLevel,
        action: `tool:mcp_${config.id}_${tool.name}`,
        timeoutMs: 20000,
        supportsCancellation: true,
        outputLimitBytes: 32768,
        inputValidator: (input: unknown) => {
          if (typeof input !== 'object' || input === null) {
            return { valid: false, error: 'Input MCP harus berupa objek JSON.' };
          }
          return { valid: true, data: input };
        },
        healthCheck: async () => ({
          status: 'healthy',
          latencyMs: 1,
          timestamp: new Date().toISOString(),
        }),
        execute: async (input: unknown, context) => {
          const res = await this.callTool(
            config.id,
            tool.name,
            input as Record<string, unknown>,
            context.traceId,
            context.signal,
          );
          return {
            content: res.sanitizedContent,
            isUntrusted: true,
            isInstruction: false,
          };
        },
      };

      convertedToolDefs.push(toolDef);
    }

    this.servers.set(config.id, {
      config,
      adapter,
      tools: toolMap,
    });

    return convertedToolDefs;
  }

  /**
   * Executes a tool on an untrusted MCP server, sanitizing output and preventing prompt injection.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    traceId?: string | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<McpCallResult> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new McpError(`Server MCP '${serverId}' tidak terdaftar.`, serverId);
    }

    const tool = server.tools.get(toolName);
    if (!tool) {
      throw new McpError(
        `Tool '${toolName}' tidak ditemukan atau capability-nya diblokir pada server '${serverId}'.`,
        serverId,
      );
    }

    // Verify capability allowlist again
    if (!server.config.allowedCapabilities.includes(tool.capability)) {
      throw new McpCapabilityViolationError(serverId, tool.capability);
    }

    const startTime = Date.now();
    let rawContent = '';
    let callError: string | undefined;

    try {
      const result = await server.adapter.callTool(toolName, args, signal);
      rawContent = result.content;
      if (result.error) callError = result.error;
    } catch (err: unknown) {
      callError = err instanceof Error ? err.message : String(err);
      rawContent = `Error: ${callError}`;
    }

    const durationMs = Date.now() - startTime;

    // Sanitize and wrap in non-instruction untrusted tags
    const { wrappedContent } = sanitizeMcpOutput(rawContent, serverId, toolName);

    const auditEntry: McpAuditLog = {
      traceId,
      serverId,
      toolName,
      arguments: args,
      durationMs,
      status: callError ? 'failure' : 'success',
      error: callError,
      timestamp: new Date().toISOString(),
    };

    this.auditLogs.push(auditEntry);
    if (this.auditSink) {
      await this.auditSink(auditEntry);
    }

    return {
      serverId,
      toolName,
      rawContent,
      sanitizedContent: wrappedContent,
      isUntrusted: true,
      isInstruction: false,
      provenance: 'mcp',
      durationMs,
      timestamp: auditEntry.timestamp,
      error: callError,
    };
  }

  getAuditLogs(): McpAuditLog[] {
    return [...this.auditLogs];
  }

  listServers(): McpServerConfig[] {
    return Array.from(this.servers.values()).map((s) => s.config);
  }
}
