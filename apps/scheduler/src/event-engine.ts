import { type EvaluationResult, PermissionEngine } from '@personal-ai-os/permissions';
import {
  type EventEnvelope,
  type EventProcessingResult,
  type EventSubscriptionRule,
  EventValidationError,
  type TaskPayload,
} from './types.ts';

export type EventTaskDispatcher = (options: {
  ruleId: string;
  eventId: string;
  taskPayload: TaskPayload;
  decision: EvaluationResult;
}) => Promise<string | undefined>; // Returns taskId if created

export class EventEngine {
  private readonly rules = new Map<string, EventSubscriptionRule>();
  private readonly processedDedupKeys = new Map<string, number>(); // dedupKey -> expireTimestamp
  private readonly dedupWindowMs: number;
  private readonly permissionEngine: PermissionEngine;
  private readonly taskDispatcher: EventTaskDispatcher;

  constructor(options?: {
    permissionEngine?: PermissionEngine | undefined;
    taskDispatcher?: EventTaskDispatcher | undefined;
    dedupWindowMs?: number | undefined;
  }) {
    this.permissionEngine = options?.permissionEngine ?? new PermissionEngine();
    this.taskDispatcher = options?.taskDispatcher ?? (async () => undefined);
    this.dedupWindowMs = options?.dedupWindowMs ?? 5 * 60 * 1000; // 5 minutes TTL
  }

  registerRule(rule: EventSubscriptionRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  listRules(): EventSubscriptionRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Validate event structure and envelope fields
   */
  validateEvent(event: unknown): EventEnvelope {
    if (!event || typeof event !== 'object') {
      throw new EventValidationError('Event must be a valid object');
    }

    const rec = event as Record<string, unknown>;
    if (!rec['id'] || typeof rec['id'] !== 'string') {
      throw new EventValidationError('Event id is required and must be a string');
    }
    if (!rec['source'] || typeof rec['source'] !== 'string') {
      throw new EventValidationError(
        'Event source is required (e.g. internal:task or external:webhook)',
      );
    }
    if (!rec['type'] || typeof rec['type'] !== 'string') {
      throw new EventValidationError(
        'Event type is required (e.g. task.completed, approval.required)',
      );
    }
    if (
      !rec['timestamp'] ||
      typeof rec['timestamp'] !== 'string' ||
      isNaN(Date.parse(rec['timestamp']))
    ) {
      throw new EventValidationError('Event timestamp is required and must be a valid ISO string');
    }
    if (!rec['payload'] || typeof rec['payload'] !== 'object') {
      throw new EventValidationError('Event payload is required and must be an object');
    }

    return event as EventEnvelope;
  }

  /**
   * Cleans up expired deduplication keys
   */
  private cleanExpiredDedupKeys(now: number): void {
    for (const [key, expiresAt] of this.processedDedupKeys.entries()) {
      if (expiresAt <= now) {
        this.processedDedupKeys.delete(key);
      }
    }
  }

  /**
   * Process incoming internal or external event with deduplication and permission enforcement.
   */
  async processEvent(rawEvent: unknown, now = Date.now()): Promise<EventProcessingResult> {
    const event = this.validateEvent(rawEvent);
    this.cleanExpiredDedupKeys(now);

    // Compute or extract deduplication key
    const dedupKey = event.dedupKey ?? `${event.source}:${event.type}:${event.id}`;

    if (this.processedDedupKeys.has(dedupKey)) {
      return {
        eventId: event.id,
        accepted: false,
        duplicate: true,
        matchedRules: [],
        dispatchedTasks: [],
      };
    }

    // Mark event as processed within window
    this.processedDedupKeys.set(dedupKey, now + this.dedupWindowMs);

    const matchedRuleIds: string[] = [];
    const dispatchedTasks: EventProcessingResult['dispatchedTasks'] = [];

    for (const rule of this.rules.values()) {
      // Check event type match (exact match or wildcard e.g. "task.*")
      const matchesType =
        rule.eventType === '*' ||
        rule.eventType === event.type ||
        (rule.eventType.endsWith('*') && event.type.startsWith(rule.eventType.slice(0, -1)));

      if (!matchesType) continue;

      // Check source pattern if defined
      if (rule.sourcePattern && !event.source.includes(rule.sourcePattern)) {
        continue;
      }

      matchedRuleIds.push(rule.id);

      // MANDATORY PERMISSION ENGINE EVALUATION (Rule 9)
      // Event-triggered task MUST NOT bypass Permission Engine
      const decision = this.permissionEngine.evaluate({
        actor: { id: 'event-engine', role: 'system' },
        action: rule.targetAction.action,
        resource: rule.targetAction.resource,
        scope: rule.targetAction.scope,
        context: {
          eventId: event.id,
          eventType: event.type,
          source: event.source,
          riskLevel: rule.targetAction.riskLevel,
        },
      });

      if (decision.decision === 'deny') {
        dispatchedTasks.push({
          ruleId: rule.id,
          permissionDecision: 'deny',
          reason: decision.reason,
        });
        continue;
      }

      if (decision.decision === 'require_approval') {
        // High/Critical risk actions triggered by events require human approval!
        const taskPayload = rule.createTaskPayload(event);
        const taskId = await this.taskDispatcher({
          ruleId: rule.id,
          eventId: event.id,
          taskPayload,
          decision,
        });

        dispatchedTasks.push({
          ruleId: rule.id,
          permissionDecision: 'require_approval',
          taskId,
          approvalRequired: true,
          reason: decision.reason,
        });
        continue;
      }

      // Allowed (Low / authorized Medium risk)
      const taskPayload = rule.createTaskPayload(event);
      const taskId = await this.taskDispatcher({
        ruleId: rule.id,
        eventId: event.id,
        taskPayload,
        decision,
      });

      dispatchedTasks.push({
        ruleId: rule.id,
        permissionDecision: 'allow',
        taskId,
        approvalRequired: false,
      });
    }

    return {
      eventId: event.id,
      accepted: true,
      duplicate: false,
      matchedRules: matchedRuleIds,
      dispatchedTasks,
    };
  }
}
