import type { TaskStatus } from './types.ts';

export class IllegalTaskStateTransitionError extends Error {
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;

  constructor(fromStatus: TaskStatus, toStatus: TaskStatus, reason?: string) {
    const detail = reason ? ` (${reason})` : '';
    super(`Illegal task state transition from '${fromStatus}' to '${toStatus}'${detail}`);
    this.name = 'IllegalTaskStateTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['planning', 'running', 'paused', 'cancelled'],
  planning: ['running', 'paused', 'failed', 'cancelled'],
  running: ['waiting_approval', 'paused', 'completed', 'failed', 'cancelled'],
  waiting_approval: ['running', 'paused', 'cancelled', 'failed'],
  paused: ['queued', 'running', 'cancelled'],
  failed: ['queued'], // Allowed only on retry
  completed: [], // Terminal
  cancelled: [], // Terminal
};

export class TaskStateMachine {
  static canTransition(current: TaskStatus, next: TaskStatus): boolean {
    if (current === next) {
      return true;
    }
    const allowed = VALID_TRANSITIONS[current] ?? [];
    return allowed.includes(next);
  }

  static assertTransition(current: TaskStatus, next: TaskStatus, reason?: string): void {
    if (!this.canTransition(current, next)) {
      throw new IllegalTaskStateTransitionError(current, next, reason);
    }
  }

  static isTerminal(status: TaskStatus): boolean {
    return status === 'completed' || status === 'cancelled';
  }
}
