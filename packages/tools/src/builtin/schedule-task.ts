import { ToolError, type ToolDefinition, type ToolExecutionContext } from '../types.ts';
import { NaturalLanguageScheduleParser } from './nl-schedule-parser.ts';

export interface ScheduleTaskInput {
  title?: string | undefined;
  prompt: string;
  scheduleType?: 'one_off' | 'recurring' | undefined;
  cronExpression?: string | undefined;
  runAt?: string | undefined; // ISO 8601 string
  timezone?: string | undefined; // Default: 'Asia/Jakarta'
  projectId?: string | undefined;
  confirmAmbiguity?: boolean | undefined;
  missedRunPolicy?: 'skip' | 'run_once' | 'catch_up' | undefined;
}

export interface ScheduleTaskOutput {
  scheduleId: string;
  name: string;
  type: 'one_off' | 'recurring';
  nextRunAt?: string | undefined;
  status: string;
  message: string;
  requiresConfirmation?: boolean | undefined;
}

export interface ScheduleDispatchPayload {
  userId: string;
  projectId?: string | undefined;
  name: string;
  type: 'one_off' | 'recurring';
  prompt: string;
  cronExpression?: string | undefined;
  runAt?: string | undefined;
  timezone: string;
  missedRunPolicy?: 'skip' | 'run_once' | 'catch_up' | undefined;
}

export interface ScheduleUpdatePayload {
  name?: string | undefined;
  prompt?: string | undefined;
  cronExpression?: string | undefined;
  runAt?: string | undefined;
  timezone?: string | undefined;
  missedRunPolicy?: 'skip' | 'run_once' | 'catch_up' | undefined;
}

export interface ScheduledTaskItem {
  id: string;
  name: string;
  type: 'one_off' | 'recurring';
  status: string;
  cronExpression?: string | undefined;
  runAt?: string | undefined;
  timezone: string;
  nextRunAt?: string | undefined;
  lastRunAt?: string | undefined;
  lastBrief?: string | undefined;
}

export interface ScheduleDispatcher {
  createSchedule(payload: ScheduleDispatchPayload): Promise<{
    id: string;
    status: string;
    nextRunAt?: string | undefined;
    name?: string | undefined;
    type?: string | undefined;
  }>;
  listSchedules?(filter: { userId: string; status?: string | undefined }): Promise<ScheduledTaskItem[]>;
  pauseSchedule?(id: string, userId: string): Promise<{ id: string; status: string }>;
  resumeSchedule?(id: string, userId: string): Promise<{ id: string; status: string; nextRunAt?: string | undefined }>;
  updateSchedule?(id: string, userId: string, updates: ScheduleUpdatePayload): Promise<{
    id: string;
    name: string;
    status: string;
    nextRunAt?: string | undefined;
  }>;
  cancelSchedule?(id: string, userId: string): Promise<{ id: string; status: string }>;
  getActiveCount?(userId: string): Promise<number>;
}

export const MAX_ACTIVE_SCHEDULES_PER_USER = 10;
export const MIN_RECURRING_INTERVAL_MINUTES = 15;
export const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Jakarta';

/**
 * Validasi timezone IANA menggunakan Intl.DateTimeFormat bawaan JavaScript.
 */
export function validateTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mem-parse field menit cron dan mengembalikan daftar menit eksekusi (0-59).
 */
function parseMinuteField(field: string): number[] {
  const minutes = new Set<number>();
  const parts = field.split(',');

  for (const part of parts) {
    if (part === '*') {
      for (let i = 0; i < 60; i++) minutes.add(i);
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10);
      if (isNaN(step) || step <= 0 || step > 59) {
        throw new ToolError(`Ekspresi step menit cron tidak valid: "${part}"`, 'schedule_task');
      }
      for (let i = 0; i < 60; i += step) minutes.add(i);
    } else if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr ?? '', 10);
      const end = parseInt(endStr ?? '', 10);
      if (isNaN(start) || isNaN(end) || start < 0 || end > 59 || start > end) {
        throw new ToolError(`Rentang menit cron tidak valid: "${part}"`, 'schedule_task');
      }
      for (let i = start; i <= end; i++) minutes.add(i);
    } else {
      const val = parseInt(part, 10);
      if (isNaN(val) || val < 0 || val > 59) {
        throw new ToolError(`Nilai menit cron tidak valid: "${part}" (harus 0-59)`, 'schedule_task');
      }
      minutes.add(val);
    }
  }

  return Array.from(minutes).sort((a, b) => a - b);
}

/**
 * Memvalidasi format cron 5-field dan memastikan interval minimum antar eksekusi >= 15 menit.
 */
export function validateCronExpression(expression: string, minMinutes = MIN_RECURRING_INTERVAL_MINUTES): void {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new ToolError(
      `Ekspresi cron harus memiliki tepat 5 field (menit jam hari_bulan bulan hari_minggu), diterima ${fields.length}: "${expression}"`,
      'schedule_task',
    );
  }

  const [minField, hourField] = fields;
  if (!minField || !hourField) {
    throw new ToolError(`Field cron tidak lengkap: "${expression}"`, 'schedule_task');
  }

  const executionMinutes = parseMinuteField(minField);
  if (executionMinutes.length === 0) {
    throw new ToolError(`Field menit cron tidak menghasilkan jadwal aktif: "${expression}"`, 'schedule_task');
  }

  if (minField === '*') {
    throw new ToolError(
      `Frekuensi jadwal (setiap 1 menit) terlalu sering. Batas minimum adalah ${minMinutes} menit untuk menghemat sumber daya sistem VPS.`,
      'schedule_task',
    );
  }

  if (executionMinutes.length > 1) {
    for (let i = 0; i < executionMinutes.length - 1; i++) {
      const diff = (executionMinutes[i + 1] ?? 0) - (executionMinutes[i] ?? 0);
      if (diff < minMinutes) {
        throw new ToolError(
          `Frekuensi jadwal (${diff} menit) terlalu sering. Jarak antar eksekusi minimum adalah ${minMinutes} menit.`,
          'schedule_task',
        );
      }
    }
    if (hourField === '*' || hourField.startsWith('*/')) {
      const first = executionMinutes[0] ?? 0;
      const last = executionMinutes[executionMinutes.length - 1] ?? 0;
      const wrapDiff = (60 - last) + first;
      if (wrapDiff < minMinutes) {
        throw new ToolError(
          `Frekuensi jadwal antar jam (${wrapDiff} menit) terlalu sering. Batas minimum adalah ${minMinutes} menit.`,
          'schedule_task',
        );
      }
    }
  }
}

// ==========================================
// 1. TOOL: schedule_task
// ==========================================
export function createScheduleTaskTool(
  dispatcher: ScheduleDispatcher,
): ToolDefinition<ScheduleTaskInput, ScheduleTaskOutput> {
  return {
    name: 'schedule_task',
    description:
      'Menjadwalkan eksekusi tugas atau pengingat otomatis berkala menggunakan ekspresi bahasa alami ("setiap hari jam 09:00 WIB", "besok jam 08:00") atau parameter terstruktur cron/runAt (interval minimal 15 menit).',
    capability: 'scheduler:manage',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'tool:create_schedule',
    timeoutMs: 10000,
    supportsCancellation: true,
    outputLimitBytes: 16384,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { prompt, ... }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.prompt !== 'string' || raw.prompt.trim().length === 0) {
        return { valid: false, error: 'Atribut "prompt" harus berupa string non-kosong.' };
      }
      return { valid: true, data: input as ScheduleTaskInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: ScheduleTaskInput, context: ToolExecutionContext) => {
      const userId = context.actor.id;
      if (!userId || userId.trim().length === 0) {
        throw new ToolError('Konteks aktor (userId) tidak ditemukan dalam ToolExecutionContext.', 'schedule_task');
      }

      // 1. Periksa batas kuota jadwal aktif per pengguna (maksimal 10 jadwal)
      if (dispatcher.getActiveCount) {
        const activeCount = await dispatcher.getActiveCount(userId);
        if (activeCount >= MAX_ACTIVE_SCHEDULES_PER_USER) {
          throw new ToolError(
            `Batas kuota jadwal aktif (${MAX_ACTIVE_SCHEDULES_PER_USER}) telah tercapai untuk pengguna "${userId}". Hapus atau jeda jadwal yang tidak diperlukan sebelum membuat yang baru.`,
            'schedule_task',
          );
        }
      }

      let title = input.title?.trim();
      let prompt = input.prompt.trim();
      let scheduleType = input.scheduleType;
      let cronExpression = input.cronExpression?.trim();
      let runAt = input.runAt?.trim();
      let timezone = input.timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;

      // 2. Jika parameter terstruktur belum lengkap atau prompt adalah instruksi bahasa alami
      if (!scheduleType || (!cronExpression && !runAt)) {
        const parseResult = NaturalLanguageScheduleParser.parse(prompt, {
          defaultTimezone: timezone,
        });

        if (parseResult.ambiguous) {
          if (!input.confirmAmbiguity) {
            return {
              scheduleId: '',
              name: title || 'Jadwal Ambigu',
              type: 'one_off',
              status: 'requires_confirmation',
              message: `Instruksi jadwal ambigu: ${parseResult.reason} Saran: ${parseResult.suggestedClarification}`,
              requiresConfirmation: true,
            };
          }
        }

        if (!parseResult.success) {
          throw new ToolError(
            parseResult.reason || 'Instruksi jadwal tidak dapat dipahami secara deterministik.',
            'schedule_task',
          );
        }

        title = title || parseResult.name;
        prompt = parseResult.prompt || prompt;
        scheduleType = parseResult.scheduleType;
        cronExpression = parseResult.cronExpression;
        runAt = parseResult.runAt;
        timezone = parseResult.timezone || timezone;
      }

      if (!validateTimezone(timezone)) {
        throw new ToolError(
          `Zona waktu "${timezone}" tidak valid atau tidak didukung oleh sistem IANA.`,
          'schedule_task',
        );
      }

      let validatedRunAt: string | undefined;
      let validatedCron: string | undefined;

      if (scheduleType === 'recurring') {
        if (!cronExpression) {
          throw new ToolError('Jadwal berulang memerlukan cronExpression valid.', 'schedule_task');
        }
        validatedCron = cronExpression;
        validateCronExpression(validatedCron, MIN_RECURRING_INTERVAL_MINUTES);
      } else {
        if (!runAt) {
          throw new ToolError('Jadwal satu kali memerlukan runAt (ISO string).', 'schedule_task');
        }
        const targetDate = new Date(runAt);
        if (isNaN(targetDate.getTime())) {
          throw new ToolError(
            `Format tanggal "runAt" tidak valid: "${runAt}". Gunakan format ISO 8601.`,
            'schedule_task',
          );
        }
        const now = new Date();
        if (targetDate.getTime() <= now.getTime()) {
          throw new ToolError(
            `Waktu eksekusi "runAt" (${targetDate.toISOString()}) harus berada di masa depan.`,
            'schedule_task',
          );
        }
        validatedRunAt = targetDate.toISOString();
      }

      const finalName = title || (scheduleType === 'recurring' ? 'Tugas Terjadwal Berulang' : 'Tugas Terjadwal');

      // 3. Dispatch ke engine scheduler
      const result = await dispatcher.createSchedule({
        userId,
        projectId: input.projectId ?? (context.projectId ?? undefined),
        name: finalName,
        type: scheduleType!,
        prompt,
        cronExpression: validatedCron,
        runAt: validatedRunAt,
        timezone,
        missedRunPolicy: input.missedRunPolicy ?? 'skip',
      });

      return {
        scheduleId: result.id,
        name: finalName,
        type: scheduleType!,
        nextRunAt: result.nextRunAt,
        status: result.status,
        message:
          scheduleType === 'recurring'
            ? `Jadwal berulang "${finalName}" berhasil dibuat dengan cron "${validatedCron}" (${timezone}).`
            : `Jadwal satu kali "${finalName}" berhasil dibuat untuk eksekusi pada ${validatedRunAt}.`,
      };
    },
  };
}

// ==========================================
// 2. TOOL: list_scheduled_tasks
// ==========================================
export interface ListScheduledTasksInput {
  status?: 'active' | 'paused' | 'completed' | 'cancelled' | undefined;
}

export interface ListScheduledTasksOutput {
  schedules: ScheduledTaskItem[];
  count: number;
  message: string;
}

export function createListScheduledTasksTool(
  dispatcher: ScheduleDispatcher,
): ToolDefinition<ListScheduledTasksInput, ListScheduledTasksOutput> {
  return {
    name: 'list_scheduled_tasks',
    description: 'Menampilkan daftar tugas terjadwal milik pengguna beserta status dan waktu eksekusi berikutnya.',
    capability: 'scheduler:manage',
    resourceScope: 'workspace',
    riskLevel: 'LOW',
    action: 'tool:list_schedules',
    timeoutMs: 5000,
    supportsCancellation: false,
    outputLimitBytes: 16384,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: true, data: {} };
      }
      return { valid: true, data: input as ListScheduledTasksInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: ListScheduledTasksInput, context: ToolExecutionContext) => {
      const userId = context.actor.id;
      if (!userId) {
        throw new ToolError('Konteks aktor (userId) tidak ditemukan.', 'list_scheduled_tasks');
      }

      if (!dispatcher.listSchedules) {
        return {
          schedules: [],
          count: 0,
          message: 'Operasi list jadwal tidak didukung oleh dispatcher saat ini.',
        };
      }

      const schedules = await dispatcher.listSchedules({ userId, status: input.status });
      return {
        schedules,
        count: schedules.length,
        message: `Ditemukan ${schedules.length} tugas terjadwal.`,
      };
    },
  };
}

// ==========================================
// 3. TOOL: pause_scheduled_task
// ==========================================
export interface PauseScheduledTaskInput {
  scheduleId: string;
}

export interface PauseScheduledTaskOutput {
  scheduleId: string;
  status: string;
  message: string;
}

export function createPauseScheduledTaskTool(
  dispatcher: ScheduleDispatcher,
): ToolDefinition<PauseScheduledTaskInput, PauseScheduledTaskOutput> {
  return {
    name: 'pause_scheduled_task',
    description: 'Menjeda eksekusi tugas terjadwal yang sedang aktif berdasarkan ID jadwal.',
    capability: 'scheduler:manage',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'tool:pause_schedule',
    timeoutMs: 5000,
    supportsCancellation: false,
    outputLimitBytes: 4096,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { scheduleId }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.scheduleId !== 'string' || raw.scheduleId.trim().length === 0) {
        return { valid: false, error: 'Atribut "scheduleId" wajib diisi.' };
      }
      return { valid: true, data: input as PauseScheduledTaskInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: PauseScheduledTaskInput, context: ToolExecutionContext) => {
      const userId = context.actor.id;
      if (!dispatcher.pauseSchedule) {
        throw new ToolError('Operasi pause jadwal tidak didukung dispatcher.', 'pause_scheduled_task');
      }
      const result = await dispatcher.pauseSchedule(input.scheduleId.trim(), userId);
      return {
        scheduleId: result.id,
        status: result.status,
        message: `Jadwal "${result.id}" berhasil dijeda.`,
      };
    },
  };
}

// ==========================================
// 4. TOOL: resume_scheduled_task
// ==========================================
export interface ResumeScheduledTaskInput {
  scheduleId: string;
}

export interface ResumeScheduledTaskOutput {
  scheduleId: string;
  status: string;
  nextRunAt?: string | undefined;
  message: string;
}

export function createResumeScheduledTaskTool(
  dispatcher: ScheduleDispatcher,
): ToolDefinition<ResumeScheduledTaskInput, ResumeScheduledTaskOutput> {
  return {
    name: 'resume_scheduled_task',
    description: 'Mengaktifkan kembali tugas terjadwal yang sebelumnya dijeda berdasarkan ID jadwal.',
    capability: 'scheduler:manage',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'tool:resume_schedule',
    timeoutMs: 5000,
    supportsCancellation: false,
    outputLimitBytes: 4096,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { scheduleId }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.scheduleId !== 'string' || raw.scheduleId.trim().length === 0) {
        return { valid: false, error: 'Atribut "scheduleId" wajib diisi.' };
      }
      return { valid: true, data: input as ResumeScheduledTaskInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: ResumeScheduledTaskInput, context: ToolExecutionContext) => {
      const userId = context.actor.id;
      if (!dispatcher.resumeSchedule) {
        throw new ToolError('Operasi resume jadwal tidak didukung dispatcher.', 'resume_scheduled_task');
      }
      const result = await dispatcher.resumeSchedule(input.scheduleId.trim(), userId);
      return {
        scheduleId: result.id,
        status: result.status,
        nextRunAt: result.nextRunAt,
        message: `Jadwal "${result.id}" berhasil diaktifkan kembali.`,
      };
    },
  };
}

// ==========================================
// 5. TOOL: update_scheduled_task
// ==========================================
export interface UpdateScheduledTaskInput {
  scheduleId: string;
  title?: string | undefined;
  prompt?: string | undefined;
  cronExpression?: string | undefined;
  runAt?: string | undefined;
  timezone?: string | undefined;
  missedRunPolicy?: 'skip' | 'run_once' | 'catch_up' | undefined;
}

export interface UpdateScheduledTaskOutput {
  scheduleId: string;
  name: string;
  status: string;
  nextRunAt?: string | undefined;
  message: string;
}

export function createUpdateScheduledTaskTool(
  dispatcher: ScheduleDispatcher,
): ToolDefinition<UpdateScheduledTaskInput, UpdateScheduledTaskOutput> {
  return {
    name: 'update_scheduled_task',
    description: 'Memperbarui parameter tugas terjadwal (nama, prompt, cron, runAt, timezone, atau policy).',
    capability: 'scheduler:manage',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'tool:update_schedule',
    timeoutMs: 5000,
    supportsCancellation: false,
    outputLimitBytes: 4096,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { scheduleId, ... }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.scheduleId !== 'string' || raw.scheduleId.trim().length === 0) {
        return { valid: false, error: 'Atribut "scheduleId" wajib diisi.' };
      }
      return { valid: true, data: input as UpdateScheduledTaskInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: UpdateScheduledTaskInput, context: ToolExecutionContext) => {
      const userId = context.actor.id;
      if (!dispatcher.updateSchedule) {
        throw new ToolError('Operasi update jadwal tidak didukung dispatcher.', 'update_scheduled_task');
      }

      if (input.timezone && !validateTimezone(input.timezone)) {
        throw new ToolError(`Zona waktu "${input.timezone}" tidak valid.`, 'update_scheduled_task');
      }
      if (input.cronExpression) {
        validateCronExpression(input.cronExpression, MIN_RECURRING_INTERVAL_MINUTES);
      }
      if (input.runAt) {
        const runDate = new Date(input.runAt);
        if (isNaN(runDate.getTime()) || runDate.getTime() <= Date.now()) {
          throw new ToolError('Waktu eksekusi "runAt" harus berupa tanggal valid di masa depan.', 'update_scheduled_task');
        }
      }

      const result = await dispatcher.updateSchedule(input.scheduleId.trim(), userId, {
        name: input.title?.trim(),
        prompt: input.prompt?.trim(),
        cronExpression: input.cronExpression?.trim(),
        runAt: input.runAt?.trim(),
        timezone: input.timezone?.trim(),
        missedRunPolicy: input.missedRunPolicy,
      });

      return {
        scheduleId: result.id,
        name: result.name,
        status: result.status,
        nextRunAt: result.nextRunAt,
        message: `Jadwal "${result.id}" berhasil diperbarui.`,
      };
    },
  };
}

// ==========================================
// 6. TOOL: cancel_scheduled_task
// ==========================================
export interface CancelScheduledTaskInput {
  scheduleId: string;
}

export interface CancelScheduledTaskOutput {
  scheduleId: string;
  status: string;
  message: string;
}

export function createCancelScheduledTaskTool(
  dispatcher: ScheduleDispatcher,
): ToolDefinition<CancelScheduledTaskInput, CancelScheduledTaskOutput> {
  return {
    name: 'cancel_scheduled_task',
    description: 'Membatalkan atau menghapus tugas terjadwal berdasarkan ID jadwal.',
    capability: 'scheduler:manage',
    resourceScope: 'workspace',
    riskLevel: 'MEDIUM',
    action: 'tool:cancel_schedule',
    timeoutMs: 5000,
    supportsCancellation: false,
    outputLimitBytes: 4096,
    inputValidator: (input: unknown) => {
      if (typeof input !== 'object' || input === null) {
        return { valid: false, error: 'Input harus berupa objek { scheduleId }.' };
      }
      const raw = input as Record<string, unknown>;
      if (typeof raw.scheduleId !== 'string' || raw.scheduleId.trim().length === 0) {
        return { valid: false, error: 'Atribut "scheduleId" wajib diisi.' };
      }
      return { valid: true, data: input as CancelScheduledTaskInput };
    },
    healthCheck: async () => ({
      status: 'healthy',
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    }),
    execute: async (input: CancelScheduledTaskInput, context: ToolExecutionContext) => {
      const userId = context.actor.id;
      if (!dispatcher.cancelSchedule) {
        throw new ToolError('Operasi cancel jadwal tidak didukung dispatcher.', 'cancel_scheduled_task');
      }
      const result = await dispatcher.cancelSchedule(input.scheduleId.trim(), userId);
      return {
        scheduleId: result.id,
        status: result.status,
        message: `Jadwal "${result.id}" berhasil dibatalkan.`,
      };
    },
  };
}
