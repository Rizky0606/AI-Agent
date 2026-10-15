import type { MemoryCandidate, MemoryType, MemoryProvenance } from '../types.ts';
import { redactSensitiveData } from '../policy/sensitive-data-filter.ts';
import { MemoryWritePolicy } from '../policy/memory-write-policy.ts';

export interface TaskExtractionInput {
  taskId: string;
  userId: string;
  projectId?: string | null | undefined;
  kind?: string | undefined;
  title?: string | undefined;
  instructions?: string | undefined;
  result?: string | undefined;
  summary?: string | undefined;
}

export interface ConversationExtractionInput {
  userId: string;
  projectId?: string | null | undefined;
  userMessage: string;
  assistantMessage?: string | undefined;
}

export class MemoryCandidateExtractor {
  private readonly policy: MemoryWritePolicy;

  constructor(policy = new MemoryWritePolicy()) {
    this.policy = policy;
  }

  /**
   * Evaluates and sanitizes a memory candidate.
   * If it passes sensitive data redaction and the write policy, returns the sanitized proposal candidate.
   * Returns null if rejected by policy or contains unredactable sensitive secrets.
   */
  evaluateCandidate(candidate: MemoryCandidate): MemoryCandidate | null {
    const evaluation = this.policy.evaluate(candidate);
    if (!evaluation.shouldStore) {
      return null;
    }

    const sanitizedContent = evaluation.sanitizedContent ?? redactSensitiveData(candidate.content).sanitized;
    return {
      ...candidate,
      content: sanitizedContent,
      metadata: {
        ...(candidate.metadata ?? {}),
        isProposal: true,
        status: 'proposed',
        extractedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Extracts potential memory proposals from a completed task.
   * All extracted candidates MUST be proposals (never stored silently).
   */
  extractFromTask(input: TaskExtractionInput): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];

    const title = input.title?.trim() || '';
    const instructions = input.instructions?.trim() || '';
    const result = input.result?.trim() || input.summary?.trim() || '';

    // If there is substantive outcome or technical decision in the task
    if (title || instructions || result) {
      let content = '';
      if (title && instructions) {
        content = `Hasil tugas [${title}]: ${instructions}. ${result ? `Ringkasan: ${result}` : ''}`.trim();
      } else if (title) {
        content = `Hasil tugas [${title}]: ${result || 'Tugas selesai dengan sukses.'}`.trim();
      } else {
        content = `Hasil tugas: ${instructions}. ${result}`.trim();
      }

      if (content.length >= 15) {
        const rawCandidate: MemoryCandidate = {
          userId: input.userId,
          projectId: input.projectId ?? undefined,
          content,
          type: 'decision' as MemoryType,
          scope: input.projectId ? 'project' : 'user',
          provenance: 'task_result' as MemoryProvenance,
          metadata: {
            sourceTaskId: input.taskId,
            taskKind: input.kind,
            isProposal: true,
            status: 'proposed',
          },
        };

        const validated = this.evaluateCandidate(rawCandidate);
        if (validated) {
          candidates.push(validated);
        }
      }
    }

    return candidates;
  }

  /**
   * Extracts potential memory proposals from a user/assistant conversation turn.
   * Looks for explicit user preferences, rules, or system guidelines stated by the user.
   */
  extractFromConversation(input: ConversationExtractionInput): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const text = input.userMessage.trim();

    // Heuristics for substantive preferences or decisions
    const preferenceKeywords = [
      'preferensi',
      'selalu gunakan',
      'jangan pernah',
      'mulai sekarang',
      'format laporan',
      'aturan proyek',
      'keputusan arsitektur',
      'standar koding',
      'bahasa indonesia',
      'format markdown',
    ];

    const lower = text.toLowerCase();
    const hasSubstantiveSignal = preferenceKeywords.some((kw) => lower.includes(kw));

    if (hasSubstantiveSignal && text.length >= 20) {
      const type: MemoryType = lower.includes('keputusan') || lower.includes('arsitektur')
        ? 'decision'
        : lower.includes('aturan') || lower.includes('standar')
          ? 'knowledge'
          : 'preference';

      const rawCandidate: MemoryCandidate = {
        userId: input.userId,
        projectId: input.projectId ?? undefined,
        content: text,
        type,
        scope: input.projectId ? 'project' : 'user',
        provenance: 'conversation_extraction' as MemoryProvenance,
        metadata: {
          source: 'conversation',
          isProposal: true,
          status: 'proposed',
        },
      };

      const validated = this.evaluateCandidate(rawCandidate);
      if (validated) {
        candidates.push(validated);
      }
    }

    return candidates;
  }
}
