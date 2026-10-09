import type { SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHealthCheckResult,
  ToolCancelledError,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolOutputValidationError,
  ToolTimeoutError,
} from '../types.ts';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly guard: SecuredCapabilityGuard;

  constructor(guard: SecuredCapabilityGuard) {
    this.guard = guard;
  }

  registerTool<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Executes a tool with:
   * 1. Schema validation (input & output)
   * 2. Mandatory Permission Engine check (SecuredCapabilityGuard)
   * 3. Timeout and cancellation (AbortSignal)
   * 4. Output limit enforcement and clear truncation marker
   * 5. Audit trail
   */
  async executeTool<TInput = unknown, TOutput = unknown>(options: {
    toolName: string;
    input: TInput;
    context: ToolExecutionContext;
    approvalId?: string | undefined;
    resource?: string | undefined;
  }): Promise<ToolExecutionResult<TOutput>> {
    const startTime = Date.now();
    const tool = this.tools.get(options.toolName) as ToolDefinition<TInput, TOutput> | undefined;

    if (!tool) {
      throw new ToolNotFoundError(options.toolName);
    }

    // 1. Validate Input
    if (tool.inputValidator) {
      const validation = tool.inputValidator(options.input);
      if (!validation.valid) {
        throw new ToolInputValidationError(tool.name, validation.error);
      }
    }

    // 2. Mandatory Permission Engine Check via SecuredCapabilityGuard
    const resourceTarget =
      options.resource ??
      (typeof options.input === 'object' && options.input !== null
        ? String(
            (options.input as Record<string, unknown>).path ??
              (options.input as Record<string, unknown>).url ??
              (options.input as Record<string, unknown>).filename ??
              tool.name,
          )
        : tool.name);

    const permissionRequest = {
      actor: options.context.actor,
      action: tool.action,
      resource: resourceTarget,
      scope: tool.resourceScope,
      traceId: options.context.traceId,
      context: {
        toolName: tool.name,
        capability: tool.capability,
        riskLevel: tool.riskLevel,
        ...options.context.metadata,
      },
    };

    // 3. Setup Cancellation and Timeout via AbortController
    const abortController = new AbortController();
    let timedOut = false;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      abortController.abort(new ToolTimeoutError(tool.name, tool.timeoutMs));
    }, tool.timeoutMs);

    const parentSignal = options.context.signal;
    const abortListener = () => {
      abortController.abort(new ToolCancelledError(tool.name));
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timeoutTimer);
        throw new ToolCancelledError(tool.name);
      }
      parentSignal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      // 4. Guarded execution through Permission Engine
      const rawOutput = await this.guard.executeProtected(
        permissionRequest,
        async () => {
          if (abortController.signal.aborted) {
            if (timedOut) throw new ToolTimeoutError(tool.name, tool.timeoutMs);
            throw new ToolCancelledError(tool.name);
          }

          const execContext: ToolExecutionContext = {
            ...options.context,
            signal: abortController.signal,
          };

          return await tool.execute(options.input, execContext);
        },
        { approvalId: options.approvalId },
      );

      // 5. Output limit check & clear truncation marker
      let outputData: unknown = rawOutput;
      let truncated = false;
      let outputSizeBytes = 0;

      if (typeof rawOutput === 'string') {
        const rawBytes = Buffer.byteLength(rawOutput, 'utf-8');
        outputSizeBytes = rawBytes;
        if (rawBytes > tool.outputLimitBytes) {
          truncated = true;
          // Truncate to limit and append clear marker
          const truncatedBuffer = Buffer.from(rawOutput, 'utf-8').subarray(
            0,
            tool.outputLimitBytes,
          );
          const truncatedString = truncatedBuffer.toString('utf-8');
          const marker = `\n[OUTPUT TRUNCATED: Exceeded limit of ${tool.outputLimitBytes} bytes. Original size was ${rawBytes} bytes.]`;
          outputData = truncatedString + marker;
          outputSizeBytes = Buffer.byteLength(outputData as string, 'utf-8');
        }
      } else if (rawOutput !== null && rawOutput !== undefined) {
        const jsonStr = JSON.stringify(rawOutput);
        const jsonBytes = Buffer.byteLength(jsonStr, 'utf-8');
        outputSizeBytes = jsonBytes;
        if (jsonBytes > tool.outputLimitBytes) {
          truncated = true;
          const truncatedBuffer = Buffer.from(jsonStr, 'utf-8').subarray(0, tool.outputLimitBytes);
          outputData = {
            _truncated: true,
            _originalBytes: jsonBytes,
            _limitBytes: tool.outputLimitBytes,
            _warning: `[OUTPUT TRUNCATED: Exceeded limit of ${tool.outputLimitBytes} bytes. Original size was ${jsonBytes} bytes.]`,
            snippet: truncatedBuffer.toString('utf-8'),
          };
        }
      }

      // 6. Validate Output Schema if provided
      if (tool.outputValidator && !truncated) {
        const outValidation = tool.outputValidator(outputData);
        if (!outValidation.valid) {
          throw new ToolOutputValidationError(tool.name, outValidation.error);
        }
      }

      const durationMs = Date.now() - startTime;
      return {
        toolName: tool.name,
        status: 'success',
        data: outputData as TOutput,
        truncated,
        outputSizeBytes,
        durationMs,
        traceId: options.context.traceId,
      };
    } catch (err: unknown) {
      if (timedOut) {
        throw new ToolTimeoutError(tool.name, tool.timeoutMs);
      }
      if (abortController.signal.aborted && !timedOut) {
        throw new ToolCancelledError(tool.name);
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', abortListener);
      }
    }
  }

  /**
   * Runs health checks for all registered tools.
   */
  async healthCheckAll(): Promise<Record<string, ToolHealthCheckResult>> {
    const results: Record<string, ToolHealthCheckResult> = {};
    for (const [name, tool] of this.tools) {
      try {
        results[name] = await tool.healthCheck();
      } catch (err) {
        results[name] = {
          status: 'unhealthy',
          latencyMs: 0,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        };
      }
    }
    return results;
  }
}
