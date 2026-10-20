import {
  type ToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolTimeoutError,
  ToolCancelledError,
  ToolOutputValidationError,
} from '@personal-ai-os/tools';
import {
  type ActorContext,
  ApprovalRequiredError,
  PermissionDeniedError,
  InvalidApprovalError,
} from '@personal-ai-os/permissions';
import { sanitizeMcpOutput } from '../security/untrusted-sanitizer.ts';

export const MAX_JSON_DEPTH = 5;
export const MAX_ARG_STRING_LENGTH = 16_384;
export const MAX_ARG_ARRAY_LENGTH = 100;
export const MAX_NDJSON_LINE_BYTES = 131_072; // 128 KB

export interface HostToolServerOptions {
  registry: ToolRegistry;
  actor: ActorContext;
  workspaceDir: string;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  conversationId?: string | null | undefined;
  traceId?: string | undefined;
  allowedToolNames?: string[] | undefined;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null | undefined;
  method: string;
  params?: Record<string, unknown> | undefined;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown | undefined;
  error?: {
    code: number;
    message: string;
    data?: unknown | undefined;
  } | undefined;
}

/**
 * Validates JSON structures to prevent prototype pollution, excessive nesting,
 * and oversized payloads from untrusted external runtimes.
 */
export function validateInputPayload(value: unknown, currentDepth = 0): void {
  if (currentDepth > MAX_JSON_DEPTH) {
    throw new Error(`JSON depth melebihi batas maksimum yang diizinkan (${MAX_JSON_DEPTH}).`);
  }

  if (typeof value === 'string') {
    if (value.length > MAX_ARG_STRING_LENGTH) {
      throw new Error(`Panjang string argumen melebihi batas maksimum (${MAX_ARG_STRING_LENGTH} karakter).`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_ARG_ARRAY_LENGTH) {
      throw new Error(`Ukuran array argumen melebihi batas maksimum (${MAX_ARG_ARRAY_LENGTH} elemen).`);
    }
    for (const item of value) {
      validateInputPayload(item, currentDepth + 1);
    }
    return;
  }

  if (typeof value === 'object' && value !== null) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
      throw new Error('Injeksi prototype pollution terdeteksi: custom prototype.');
    }

    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error(`Injeksi prototype pollution terdeteksi pada atribut '${key}'.`);
      }
      validateInputPayload((value as Record<string, unknown>)[key], currentDepth + 1);
    }
  }
}

/**
 * HostToolMcpServer: An MCP stdio/in-process server that exposes host tools via ToolRegistry
 * with SecuredCapabilityGuard enforcement, strict schema validation, untrusted sanitization,
 * and zero side-effects on approval halts.
 */
export class HostToolMcpServer {
  private readonly options: HostToolServerOptions;

  constructor(options: HostToolServerOptions) {
    this.options = options;
  }

  listExposedTools(): ToolDefinition[] {
    const allTools = this.options.registry.listTools();
    if (!this.options.allowedToolNames || this.options.allowedToolNames.length === 0) {
      return allTools;
    }
    const allowSet = new Set(this.options.allowedToolNames);
    return allTools.filter((t) => allowSet.has(t.name));
  }

  async handleJsonRpcMessage(rawLine: string): Promise<string | null> {
    const trimmed = rawLine.trim();
    if (!trimmed) return null;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        },
      } satisfies JsonRpcResponse);
    }

    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: req?.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid Request: Missing required jsonrpc 2.0 fields',
        },
      } satisfies JsonRpcResponse);
    }

    // Handle notifications (no response)
    if (req.method === 'notifications/initialized') {
      return null;
    }

    const id = req.id ?? null;

    try {
      if (req.method === 'initialize') {
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'personal-ai-host-tools',
              version: '1.0.0',
            },
          },
        } satisfies JsonRpcResponse);
      }

      if (req.method === 'ping') {
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {},
        } satisfies JsonRpcResponse);
      }

      if (req.method === 'tools/list') {
        const tools = this.listExposedTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: {
            type: 'object',
            properties: {},
          },
        }));

        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            tools,
          },
        } satisfies JsonRpcResponse);
      }

      if (req.method === 'tools/call') {
        const params = req.params ?? {};
        const toolName = String(params.name ?? '');
        const rawArgs = params.arguments;
        const approvalId = typeof params.approvalId === 'string' ? params.approvalId : undefined;

        const exposed = this.listExposedTools().find((t) => t.name === toolName);
        if (!exposed) {
          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Tool '${toolName}' tidak ditemukan atau tidak diizinkan untuk runtime ini.`,
                },
              ],
              isError: true,
              status: 'not_found',
            },
          } satisfies JsonRpcResponse);
        }

        // 1. Strict input validation (depth, string length, array length, prototype pollution)
        try {
          validateInputPayload(rawArgs);
        } catch (err) {
          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Input schema validation error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
              status: 'validation_error',
            },
          } satisfies JsonRpcResponse);
        }

        // 2. Bound Actor Execution Context (IMMUTABLE: runtime cannot forge userId or permissions)
        const executionContext: ToolExecutionContext = {
          actor: this.options.actor,
          projectId: this.options.projectId,
          taskId: this.options.taskId,
          conversationId: this.options.conversationId,
          traceId: this.options.traceId,
          metadata: {
            workspaceDir: this.options.workspaceDir,
            caller: 'external_runtime',
          },
        };

        // 3. Execute tool via ToolRegistry & SecuredCapabilityGuard
        try {
          const execResult = await this.options.registry.executeTool({
            toolName,
            input: rawArgs ?? {},
            context: executionContext,
            approvalId,
          });

          // Serialize output and sanitize through UntrustedSanitizer
          const serializedOutput =
            typeof execResult.data === 'string'
              ? execResult.data
              : JSON.stringify(execResult.data ?? {});

          const sanitized = sanitizeMcpOutput(serializedOutput, 'host-tools', toolName);

          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: sanitized.wrappedContent,
                },
              ],
              isError: false,
              isUntrusted: true,
              isInstruction: false,
              truncated: execResult.truncated,
            },
          } satisfies JsonRpcResponse);
        } catch (err: unknown) {
          // Handle Approval Requirement: zero side-effects, paused at waiting_approval
          if (err instanceof ApprovalRequiredError) {
            return JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `[APPROVAL_REQUIRED] Operasi '${toolName}' memerlukan persetujuan pemilik (Tingkat Risiko: ${err.riskLevel}). Approval ID: ${err.requiredApproval.fingerprint}. Alasan: ${err.message}`,
                  },
                ],
                isError: true,
                status: 'waiting_approval',
                approvalId: err.requiredApproval.fingerprint,
                riskLevel: err.riskLevel,
              },
            } satisfies JsonRpcResponse);
          }

          if (err instanceof PermissionDeniedError) {
            return JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `[PERMISSION_DENIED] Izin ditolak untuk tool '${toolName}': ${err.message}`,
                  },
                ],
                isError: true,
                status: 'permission_denied',
                riskLevel: err.riskLevel,
              },
            } satisfies JsonRpcResponse);
          }

          if (err instanceof InvalidApprovalError) {
            return JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `[INVALID_APPROVAL] Persetujuan tidak sah, kedaluwarsa, atau fingerprint tidak cocok: ${err.message}`,
                  },
                ],
                isError: true,
                status: 'invalid_approval',
              },
            } satisfies JsonRpcResponse);
          }

          if (
            err instanceof ToolInputValidationError ||
            err instanceof ToolTimeoutError ||
            err instanceof ToolCancelledError ||
            err instanceof ToolOutputValidationError ||
            err instanceof ToolNotFoundError
          ) {
            return JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `[TOOL_ERROR] ${err.message}`,
                  },
                ],
                isError: true,
                status: 'error',
              },
            } satisfies JsonRpcResponse);
          }

          // Generic error caught
          return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `[EXECUTION_ERROR] ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
              status: 'error',
            },
          } satisfies JsonRpcResponse);
        }
      }

      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${req.method}`,
        },
      } satisfies JsonRpcResponse);
    } catch (unexpectedErr) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Internal error: ${unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr)}`,
        },
      } satisfies JsonRpcResponse);
    }
  }

  /**
   * Runs the MCP server listening to NDJSON lines on stdin and writing responses to stdout.
   */
  async runStdio(
    inputStream: NodeJS.ReadableStream = process.stdin,
    outputStream: NodeJS.WritableStream = process.stdout,
  ): Promise<void> {
    let lineBuffer = '';

    for await (const chunk of inputStream) {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      if (lineBuffer.length + str.length > MAX_NDJSON_LINE_BYTES && !str.includes('\n')) {
        lineBuffer = '';
        continue;
      }

      lineBuffer += str;
      let newlineIdx: number;

      while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);

        if (!line) continue;
        if (line.length > MAX_NDJSON_LINE_BYTES) continue;

        const responseStr = await this.handleJsonRpcMessage(line);
        if (responseStr) {
          outputStream.write(responseStr + '\n');
        }
      }
    }
  }
}
