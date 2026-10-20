/**
 * Runtime Step Event Schema and Sanitization Utilities
 *
 * Provides a unified cross-platform schema for real-time agent execution steps
 * emitted by external runtimes (omp, hermes) or native agents.
 *
 * Pure TypeScript — safe for Node.js, React Native (Metro), and browser/Vite.
 */

export type RuntimeStepType =
  | 'message'
  | 'tool_start'
  | 'tool_end'
  | 'file_edit'
  | 'plan'
  | 'subagent'
  | 'error'
  | 'done';

export type RuntimeStepStatus = 'running' | 'completed' | 'failed';

export interface RuntimeStepEvent {
  id: string;
  taskId: string;
  runtime: string; // e.g. 'omp', 'hermes', 'native'
  urutan: number; // 1-based sequential step order
  waktu: string; // ISO 8601 timestamp
  type: RuntimeStepType;
  jenis?: RuntimeStepType | undefined; // Indonesian alias
  status?: RuntimeStepStatus | undefined;
  text?: string | undefined;
  toolName?: string | undefined;
  input?: unknown | undefined;
  output?: unknown | undefined;
  path?: string | undefined;
  diff?: string | undefined;
  error?: string | undefined;
  summary?: string | undefined;
  durationMs?: number | undefined;
  exitCode?: number | undefined;
  planItems?: string[] | undefined;
  isSubagent?: boolean | undefined;
  subagentTask?: string | undefined;
}

export const MAX_RUNTIME_TEXT_LENGTH = 16_384; // 16 KB
export const MAX_RUNTIME_DIFF_LENGTH = 32_768; // 32 KB
export const TRUNCATION_INDICATOR = '... [dipotong karena melebihi batas ukuran]';

const RUNTIME_SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Bearer / JWT Tokens
  {
    regex: /Bearer\s+[-A-Za-z0-9._~+/]+=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  // API Keys (sk-..., etc.)
  {
    regex: /sk-[A-Za-z0-9_-]{16,}/gi,
    replacement: '[REDACTED]',
  },
  // Generic token / secret / password assignments (e.g. token: "...", token sensitive-...)
  {
    regex: /(password|secret|passwd|token|apikey)\s*[:=]\s*["']?([^\s"',;]+)["']?/gi,
    replacement: '$1: "[REDACTED]"',
  },
  {
    regex: /\b(token|secret)\s+([A-Za-z0-9_.-]{10,})\b/gi,
    replacement: '$1 [REDACTED]',
  },
];

/**
 * Strips dangerous HTML tags, javascript pseudo-protocols, and inline event handlers
 * from untrusted runtime text, and redacts sensitive secrets/tokens.
 */
export function sanitizeRuntimeText(
  text: unknown,
  maxLength: number = MAX_RUNTIME_TEXT_LENGTH,
): string {
  if (text === null || text === undefined) return '';
  let str = typeof text === 'string' ? text : String(text);

  // Redact secrets, auth tokens, and API keys
  for (const pattern of RUNTIME_SECRET_PATTERNS) {
    str = str.replace(pattern.regex, pattern.replacement);
  }

  // Strip script, iframe, object, embed tags and contents
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  str = str.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  str = str.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  str = str.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

  // Neutralize javascript: links and event handlers (e.g. onclick, onerror, onload)
  str = str.replace(/javascript\s*:/gi, 'about:blank#blocked-');
  str = str.replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, ' data-blocked-handler=""');

  if (str.length > maxLength) {
    str = str.slice(0, maxLength) + '\n' + TRUNCATION_INDICATOR;
  }
  return str;
}

/**
 * Validates and limits diff string size.
 */
export function sanitizeRuntimeDiff(
  diff: unknown,
  maxLength: number = MAX_RUNTIME_DIFF_LENGTH,
): string {
  if (diff === null || diff === undefined) return '';
  let str = typeof diff === 'string' ? diff : String(diff);

  if (str.length > maxLength) {
    str = str.slice(0, maxLength) + '\n' + TRUNCATION_INDICATOR;
  }
  return str;
}

/**
 * Normalizes raw events from omp JSON output into a validated RuntimeStepEvent.
 * Based on empirical omp events recorded in docs/verification/runtimes-live.md.
 */
export function normalizeOmpEvent(
  raw: unknown,
  urutan: number,
  taskId: string,
  runtime = 'omp',
): RuntimeStepEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Record<string, unknown>;
  const rawType = String(parsed['type'] ?? '');
  const waktu = typeof parsed['timestamp'] === 'string'
    ? parsed['timestamp']
    : new Date().toISOString();
  const id = typeof parsed['id'] === 'string' && parsed['id']
    ? parsed['id']
    : `omp-step-${taskId}-${urutan}-${Date.now()}`;

  // 1. Assistant message events (message_start, message_update, message_end, turn_end)
  if (
    rawType === 'message_update' ||
    rawType === 'message_end' ||
    rawType === 'turn_end' ||
    rawType === 'text'
  ) {
    let text = '';
    const content = parsed['content'];
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === 'object') {
          const part = item as Record<string, unknown>;
          if (part['type'] === 'text' && typeof part['text'] === 'string') {
            text += part['text'];
          }
        }
      }
    } else if (typeof parsed['text'] === 'string') {
      text = parsed['text'];
    }

    if (!text.trim()) return null;

    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'message',
      status: 'running',
      text: sanitizeRuntimeText(text),
    };
  }

  // 2. Tool invocation start (tool_start) or dedicated plan/subagent
  if (rawType === 'tool_start') {
    const toolName = String(parsed['tool'] ?? parsed['name'] ?? 'tool');
    const input = parsed['input'] ?? parsed['args'];

    // Sub-agent launch detection (omp task tool)
    if (toolName === 'task') {
      const inputObj = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
      const subTask = typeof inputObj['task'] === 'string'
        ? inputObj['task']
        : typeof inputObj['prompt'] === 'string'
          ? inputObj['prompt']
          : 'Tugas sub-agent paralel';
      return {
        id,
        taskId,
        runtime,
        urutan,
        waktu,
        type: 'subagent',
        status: 'running',
        toolName: 'task',
        input,
        isSubagent: true,
        subagentTask: sanitizeRuntimeText(subTask),
        summary: `Meluncurkan sub-agent: ${sanitizeRuntimeText(subTask)}`,
      };
    }

    // Plan mode / todo tool detection
    if (toolName === 'todo' || toolName === 'plan') {
      const inputObj = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
      const rawTodos = inputObj['todos'] ?? inputObj['items'] ?? inputObj['plan'];
      const planItems = Array.isArray(rawTodos)
        ? rawTodos.map((it) => (typeof it === 'object' && it ? String((it as Record<string, unknown>)['text'] ?? (it as Record<string, unknown>)['task'] ?? JSON.stringify(it)) : String(it)))
        : undefined;

      return {
        id,
        taskId,
        runtime,
        urutan,
        waktu,
        type: 'plan',
        status: 'running',
        toolName,
        input,
        planItems,
        summary: 'Menyusun rencana tindakan...',
      };
    }

    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'tool_start',
      status: 'running',
      toolName,
      input,
    };
  }

  // 3. Tool invocation complete (tool_end)
  if (rawType === 'tool_end') {
    const toolName = String(parsed['tool'] ?? parsed['name'] ?? 'tool');
    const output = parsed['output'] ?? parsed['result'];
    const sanitizedOutput = typeof output === 'string'
      ? sanitizeRuntimeText(output)
      : output;

    // Sub-agent completion
    if (toolName === 'task') {
      return {
        id,
        taskId,
        runtime,
        urutan,
        waktu,
        type: 'subagent',
        status: 'completed',
        toolName: 'task',
        output: sanitizedOutput,
        isSubagent: true,
        summary: 'Sub-agent paralel selesai.',
      };
    }

    // Plan completion
    if (toolName === 'todo' || toolName === 'plan') {
      const outputObj = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {};
      const rawTodos = outputObj['todos'] ?? outputObj['items'] ?? outputObj['plan'];
      const planItems = Array.isArray(rawTodos)
        ? rawTodos.map((it) => (typeof it === 'object' && it ? String((it as Record<string, unknown>)['text'] ?? (it as Record<string, unknown>)['task'] ?? JSON.stringify(it)) : String(it)))
        : undefined;

      return {
        id,
        taskId,
        runtime,
        urutan,
        waktu,
        type: 'plan',
        status: 'completed',
        toolName,
        output: sanitizedOutput,
        planItems,
        summary: planItems ? `${planItems.length} langkah rencana ditetapkan.` : 'Rencana langkah selesai disusun.',
      };
    }

    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'tool_end',
      status: 'completed',
      toolName,
      output: sanitizedOutput,
    };
  }

  // 3b. Dedicated plan event
  if (rawType === 'plan') {
    const rawTodos = parsed['todos'] ?? parsed['items'] ?? parsed['plan'];
    const planItems = Array.isArray(rawTodos)
      ? rawTodos.map((it) => (typeof it === 'object' && it ? String((it as Record<string, unknown>)['text'] ?? (it as Record<string, unknown>)['task'] ?? JSON.stringify(it)) : String(it)))
      : undefined;
    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'plan',
      status: 'completed',
      toolName: 'plan',
      planItems,
      text: typeof parsed['text'] === 'string' ? sanitizeRuntimeText(parsed['text']) : undefined,
      summary: planItems ? `${planItems.length} langkah rencana ditetapkan.` : 'Rencana eksekusi diterima.',
    };
  }

  // 4. File modification (file_edit, patch, diff)
  if (rawType === 'file_edit' || rawType === 'patch' || rawType === 'diff') {
    const path = typeof parsed['path'] === 'string' ? parsed['path'] : undefined;
    const diff = typeof parsed['diff'] === 'string'
      ? parsed['diff']
      : typeof parsed['patch'] === 'string'
        ? parsed['patch']
        : undefined;

    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'file_edit',
      status: 'completed',
      path,
      diff: sanitizeRuntimeDiff(diff),
    };
  }

  // 5. Error event
  if (rawType === 'error') {
    const error = String(parsed['error'] ?? parsed['message'] ?? 'Runtime error');
    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'error',
      status: 'failed',
      error: sanitizeRuntimeText(error),
    };
  }

  // 6. Agent end / completion
  if (rawType === 'agent_end' || rawType === 'completed' || rawType === 'done') {
    return {
      id,
      taskId,
      runtime,
      urutan,
      waktu,
      type: 'done',
      status: 'completed',
      summary: typeof parsed['summary'] === 'string' ? sanitizeRuntimeText(parsed['summary']) : undefined,
      durationMs: typeof parsed['durationMs'] === 'number' ? parsed['durationMs'] : undefined,
      exitCode: typeof parsed['exitCode'] === 'number' ? parsed['exitCode'] : 0,
    };
  }

  return null;
}

/**
 * Extracts a standardized RuntimeStepEvent from a TaskEventEnvelope.
 * Fallbacks to legacy event payloads if the envelope was created without runtimeStep.
 */
export function extractRuntimeStepFromEvent(envelope: {
  id: string;
  taskId: string;
  eventType: string;
  payload?: Record<string, unknown> | undefined;
  createdAt: string;
}): RuntimeStepEvent | null {
  const payload = envelope.payload ?? {};

  // If payload has a structured runtimeStep or directly contains step fields
  const stepObj = (payload['runtimeStep'] && typeof payload['runtimeStep'] === 'object'
    ? payload['runtimeStep']
    : (payload['type'] || payload['jenis'] || envelope.eventType === 'runtime.step')
      ? payload
      : null) as Record<string, unknown> | null;

  if (stepObj) {
    const rawType = String(stepObj['type'] ?? stepObj['jenis'] ?? 'message') as RuntimeStepType;
    const urutan = typeof stepObj['urutan'] === 'number' ? stepObj['urutan'] : 1;
    const runtime = typeof stepObj['runtime'] === 'string' ? stepObj['runtime'] : 'omp';
    const waktu = typeof stepObj['waktu'] === 'string'
      ? stepObj['waktu']
      : typeof stepObj['timestamp'] === 'string'
        ? stepObj['timestamp']
        : envelope.createdAt;
    const status = (stepObj['status'] as RuntimeStepStatus) ??
      (rawType === 'tool_end' || rawType === 'done' || rawType === 'file_edit'
        ? 'completed'
        : rawType === 'error'
          ? 'failed'
          : 'running');

    return {
      id: String(stepObj['id'] ?? envelope.id),
      taskId: String(stepObj['taskId'] ?? envelope.taskId),
      runtime,
      urutan,
      waktu,
      type: rawType,
      jenis: rawType,
      status,
      text: stepObj['text'] ? sanitizeRuntimeText(stepObj['text']) : undefined,
      toolName: typeof stepObj['toolName'] === 'string'
        ? stepObj['toolName']
        : typeof stepObj['tool'] === 'string'
          ? stepObj['tool']
          : undefined,
      input: stepObj['input'] ?? stepObj['args'],
      output: stepObj['output']
        ? (typeof stepObj['output'] === 'string' ? sanitizeRuntimeText(stepObj['output']) : stepObj['output'])
        : undefined,
      path: typeof stepObj['path'] === 'string' ? stepObj['path'] : undefined,
      diff: sanitizeRuntimeDiff(stepObj['diff'] ?? stepObj['patch']),
      error: stepObj['error'] ? sanitizeRuntimeText(stepObj['error']) : undefined,
      summary: typeof stepObj['summary'] === 'string' ? sanitizeRuntimeText(stepObj['summary']) : undefined,
      planItems: Array.isArray(stepObj['planItems']) ? (stepObj['planItems'] as unknown[]).map(String) : undefined,
      isSubagent: stepObj['isSubagent'] === true || rawType === 'subagent',
      subagentTask: typeof stepObj['subagentTask'] === 'string' ? sanitizeRuntimeText(stepObj['subagentTask']) : undefined,
    };
  }

  const urutan = typeof payload['urutan'] === 'number'
    ? payload['urutan']
    : 1;
  const runtime = typeof payload['runtime'] === 'string'
    ? payload['runtime']
    : 'omp';
  const waktu = typeof payload['timestamp'] === 'string'
    ? payload['timestamp']
    : envelope.createdAt;

  // Fallback translation from legacy event structures
  if (envelope.eventType === 'task.tool_call') {
    const toolName = String(payload['action'] ?? payload['tool'] ?? 'tool');
    const hasOutput = payload['output'] !== undefined;
    return {
      id: envelope.id,
      taskId: envelope.taskId,
      runtime,
      urutan,
      waktu,
      type: hasOutput ? 'tool_end' : 'tool_start',
      status: hasOutput ? 'completed' : 'running',
      toolName,
      input: payload['input'],
      output: hasOutput ? (typeof payload['output'] === 'string' ? sanitizeRuntimeText(payload['output']) : payload['output']) : undefined,
    };
  }

  if (envelope.eventType === 'task.progress') {
    const action = String(payload['action'] ?? '');
    if (action === 'file_edit' || payload['diff']) {
      return {
        id: envelope.id,
        taskId: envelope.taskId,
        runtime,
        urutan,
        waktu,
        type: 'file_edit',
        status: 'completed',
        path: typeof payload['path'] === 'string' ? payload['path'] : undefined,
        diff: sanitizeRuntimeDiff(payload['diff']),
      };
    }
    if (action === 'runtime_stream' || payload['text']) {
      return {
        id: envelope.id,
        taskId: envelope.taskId,
        runtime,
        urutan,
        waktu,
        type: 'message',
        status: 'running',
        text: sanitizeRuntimeText(payload['text']),
      };
    }
    if (action === 'runtime_error' || payload['error']) {
      return {
        id: envelope.id,
        taskId: envelope.taskId,
        runtime,
        urutan,
        waktu,
        type: 'error',
        status: 'failed',
        error: sanitizeRuntimeText(payload['error']),
      };
    }
  }

  if (envelope.eventType === 'task.failed') {
    return {
      id: envelope.id,
      taskId: envelope.taskId,
      runtime,
      urutan,
      waktu,
      type: 'error',
      status: 'failed',
      error: sanitizeRuntimeText(payload['error'] ?? 'Task failed'),
    };
  }

  if (envelope.eventType === 'task.completed') {
    return {
      id: envelope.id,
      taskId: envelope.taskId,
      runtime,
      urutan,
      waktu,
      type: 'done',
      status: 'completed',
      summary: typeof payload['summary'] === 'string' ? sanitizeRuntimeText(payload['summary']) : 'Tugas selesai.',
    };
  }

  return null;
}

/**
 * Sorts events stably by sequence number (urutan) ascending, then by timestamp ascending.
 */
export function sortRuntimeEvents<
  T extends { urutan?: number; waktu?: string; createdAt?: string }
>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (typeof a.urutan === 'number' && typeof b.urutan === 'number' && a.urutan !== b.urutan) {
      return a.urutan - b.urutan;
    }
    const timeA = new Date(a.waktu ?? a.createdAt ?? 0).getTime();
    const timeB = new Date(b.waktu ?? b.createdAt ?? 0).getTime();
    return timeA - timeB;
  });
}

export interface AggregatedRuntimeStep {
  id: string;
  stepNumber: number;
  toolName: string;
  status: RuntimeStepStatus;
  summary: string;
  diff?: string | undefined;
  path?: string | undefined;
  details?: unknown | undefined;
  runtime?: string | undefined;
  timestamp?: string | undefined;
  isPlan?: boolean | undefined;
  planItems?: string[] | undefined;
  isSubagent?: boolean | undefined;
  subagentTask?: string | undefined;
}

/**
 * Aggregates individual runtime events (tool_start, tool_end, file_edit, message, plan, subagent, error)
 * into high-level steps suitable for ToolStepCard and timeline views.
 */
export function aggregateRuntimeSteps(
  rawEnvelopes: Array<{
    id: string;
    taskId: string;
    eventType: string;
    payload?: Record<string, unknown> | undefined;
    createdAt: string;
  }>,
): AggregatedRuntimeStep[] {
  const steps: AggregatedRuntimeStep[] = [];
  const toolMap = new Map<string, AggregatedRuntimeStep>();

  const runtimeEvents: RuntimeStepEvent[] = [];
  for (const env of rawEnvelopes) {
    const step = extractRuntimeStepFromEvent(env);
    if (step) runtimeEvents.push(step);
  }

  const sorted = sortRuntimeEvents(runtimeEvents);

  let seqCounter = 1;

  for (const ev of sorted) {
    if (ev.type === 'tool_start') {
      const toolName = ev.toolName ?? 'tool';
      const step: AggregatedRuntimeStep = {
        id: ev.id,
        stepNumber: ev.urutan || seqCounter++,
        toolName,
        status: 'running',
        summary: `Menjalankan alat: ${toolName}`,
        details: ev.input,
        runtime: ev.runtime,
        timestamp: ev.waktu,
      };
      steps.push(step);
      toolMap.set(toolName, step);
    } else if (ev.type === 'tool_end') {
      const toolName = ev.toolName ?? 'tool';
      const existing = toolMap.get(toolName);
      if (existing) {
        existing.status = 'completed';
        existing.summary = `Selesai: ${toolName}`;
        if (ev.output !== undefined) {
          existing.details = ev.output;
        }
        toolMap.delete(toolName);
      } else {
        steps.push({
          id: ev.id,
          stepNumber: ev.urutan || seqCounter++,
          toolName,
          status: 'completed',
          summary: `Hasil: ${toolName}`,
          details: ev.output,
          runtime: ev.runtime,
          timestamp: ev.waktu,
        });
      }
    } else if (ev.type === 'plan') {
      steps.push({
        id: ev.id,
        stepNumber: ev.urutan || seqCounter++,
        toolName: 'Rencana Eksekusi',
        status: ev.status ?? 'completed',
        summary: ev.summary ?? (ev.planItems && ev.planItems.length > 0 ? `${ev.planItems.length} langkah rencana disusun` : 'Rencana tindakan disusun'),
        details: ev.planItems ?? ev.text ?? ev.input ?? ev.output,
        isPlan: true,
        planItems: ev.planItems,
        runtime: ev.runtime,
        timestamp: ev.waktu,
      });
    } else if (ev.type === 'subagent') {
      steps.push({
        id: ev.id,
        stepNumber: ev.urutan || seqCounter++,
        toolName: ev.toolName ?? 'Sub-agent Paralel',
        status: ev.status ?? 'running',
        summary: ev.summary ?? (ev.subagentTask ? `Sub-agent: ${ev.subagentTask}` : 'Delegasi sub-agent paralel'),
        details: ev.input ?? ev.output,
        isSubagent: true,
        subagentTask: ev.subagentTask,
        runtime: ev.runtime,
        timestamp: ev.waktu,
      });
    } else if (ev.type === 'file_edit') {
      const activeRunning = [...toolMap.values()].find((s) => s.status === 'running');
      if (activeRunning) {
        activeRunning.diff = ev.diff;
        if (ev.path) activeRunning.path = ev.path;
      } else {
        steps.push({
          id: ev.id,
          stepNumber: ev.urutan || seqCounter++,
          toolName: 'Modifikasi File',
          status: 'completed',
          summary: ev.path ? `Modifikasi ${ev.path}` : 'Perubahan file',
          path: ev.path,
          diff: ev.diff,
          runtime: ev.runtime,
          timestamp: ev.waktu,
        });
      }
    } else if (ev.type === 'message') {
      steps.push({
        id: ev.id,
        stepNumber: ev.urutan || seqCounter++,
        toolName: 'Pesan Runtime',
        status: 'completed',
        summary: ev.text ? ev.text.slice(0, 100) : 'Pesan runtime diterima',
        details: ev.text,
        runtime: ev.runtime,
        timestamp: ev.waktu,
      });
    } else if (ev.type === 'error') {
      steps.push({
        id: ev.id,
        stepNumber: ev.urutan || seqCounter++,
        toolName: 'Kesalahan Runtime',
        status: 'failed',
        summary: ev.error ?? 'Terjadi kesalahan pada runtime',
        details: ev.error,
        runtime: ev.runtime,
        timestamp: ev.waktu,
      });
    } else if (ev.type === 'done') {
      steps.push({
        id: ev.id,
        stepNumber: ev.urutan || seqCounter++,
        toolName: 'Eksekusi Selesai',
        status: 'completed',
        summary: ev.summary ?? 'Seluruh langkah selesai dieksekusi',
        runtime: ev.runtime,
        timestamp: ev.waktu,
      });
    }
  }

  return steps;
}
