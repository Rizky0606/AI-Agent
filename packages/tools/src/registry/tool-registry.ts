import type { SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import { ExecutionLimiter, type ExecutionLimiterOptions } from '../execution-limiter.ts';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutionOptions,
  type ToolExecutionResult,
  type ToolHealthCheckResult,
  ToolCancelledError,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolOutputValidationError,
  ToolTimeoutError,
} from '../types.ts';

/** Used when a registered tool arrives without a usable timeout. */
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/** Stops runaway floods, not ordinary traffic. Override with `TOOL_MAX_IN_FLIGHT` / `TOOL_MAX_STARTS_PER_MINUTE`. */
const DEFAULT_TOOL_LIMITS: ExecutionLimiterOptions = { maxInFlight: 4, maxStartsPerInterval: 600 };

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly guard: SecuredCapabilityGuard;
  private readonly limiter: ExecutionLimiter;

  constructor(guard: SecuredCapabilityGuard, limiter?: ExecutionLimiter | undefined) {
    this.guard = guard;
    this.limiter = limiter ?? ExecutionLimiter.fromEnv('TOOL', DEFAULT_TOOL_LIMITS);
  }

  registerTool<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    // Every registered tool must carry a finite timeout; `undefined`/`NaN`/`0` would abort the
    // call instantly (or never), so the value is normalised once, at registration.
    const timeoutMs =
      Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0 ? tool.timeoutMs : DEFAULT_TOOL_TIMEOUT_MS;
    this.tools.set(tool.name, { ...tool, timeoutMs } as unknown as ToolDefinition);
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
  async executeTool<TInput = unknown, TOutput = unknown>(
    options: ToolExecutionOptions<TInput>,
  ): Promise<ToolExecutionResult<TOutput>> {
    const tool = this.tools.get(options.toolName) as ToolDefinition<TInput, TOutput> | undefined;

    if (!tool) {
      throw new ToolNotFoundError(options.toolName);
    }

    // Rate/concurrency cap first, so a flood is refused before validation, the permission check
    // and the tool body each do work. Released on every exit path below.
    this.limiter.acquire(tool.name);
    try {
      return await this.runTool(tool, options);
    } finally {
      this.limiter.release(tool.name);
    }
  }

  private async runTool<TInput, TOutput>(
    tool: ToolDefinition<TInput, TOutput>,
    options: ToolExecutionOptions<TInput>,
  ): Promise<ToolExecutionResult<TOutput>> {
    const startTime = Date.now();

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
