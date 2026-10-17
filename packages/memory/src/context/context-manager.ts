import type { ChatMessage } from '@personal-ai-os/model-gateway';
import type { MemoryRecord } from '../types.ts';

export interface ContextAssemblyInput {
  systemPolicies: readonly string[];
  userPrompt: string;
  conversationHistory?:
    | readonly {
        role: 'user' | 'assistant' | 'system' | 'tool';
        content: string;
      }[]
    | undefined;
  relevantMemories?: readonly MemoryRecord[] | undefined;
  projectState?: Record<string, unknown> | undefined;
  taskState?: Record<string, unknown> | undefined;
  toolOutputs?: readonly { toolName: string; output: string }[] | undefined;
  artifacts?: readonly { id: string; title: string; content: string }[] | undefined;
  compactedSummary?: string | undefined;
  options?:
    | {
        tokenBudget?: number | undefined;
        toolOutputMaxChars?: number | undefined;
        maxHistoryMessages?: number | undefined;
        topK?: number | undefined;
        compactionThreshold?: number | undefined;
      }
    | undefined;
}

export interface ContextAssemblyResult {
  assembledMessages: readonly ChatMessage[];
  totalEstimatedTokens: number;
  tokenBudget: number;
  budgetRemaining: number;
  truncatedSections: readonly string[];
  summarizedHistoryCount: number;
  isCompacted: boolean;
  compactedSummary?: string | undefined;
  preservedSecurityPoliciesCount: number;
  usedMemories: readonly MemoryRecord[];
  usedMemoryIds: readonly string[];
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class ContextManager {
  private readonly defaultTokenBudget: number;
  private readonly defaultToolOutputMaxChars: number;

  constructor(options?: { defaultTokenBudget?: number; defaultToolOutputMaxChars?: number }) {
    this.defaultTokenBudget = options?.defaultTokenBudget ?? 4096;
    this.defaultToolOutputMaxChars = options?.defaultToolOutputMaxChars ?? 2000;
  }

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const tokenBudget = input.options?.tokenBudget ?? this.defaultTokenBudget;
    const toolOutputMaxChars = input.options?.toolOutputMaxChars ?? this.defaultToolOutputMaxChars;
    const truncatedSections: string[] = [];

    // 1. BOUND TOOL OUTPUTS
    const boundedToolOutputs = (input.toolOutputs ?? []).map((t) => {
      if (t.output.length > toolOutputMaxChars) {
        truncatedSections.push(`tool_output:${t.toolName}`);
        return {
          toolName: t.toolName,
          output:
            t.output.slice(0, toolOutputMaxChars) +
            `\n[... truncated by Context Manager (limit: ${toolOutputMaxChars} chars) ...]`,
        };
      }
      return t;
    });

    // 2. DEDUPLICATE MEMORIES
    const seenMemoryContent = new Set<string>();
    const deduplicatedMemories: MemoryRecord[] = [];
    for (const mem of input.relevantMemories ?? []) {
      const normalized = mem.content.trim().toLowerCase();
      if (!seenMemoryContent.has(normalized)) {
        seenMemoryContent.add(normalized);
        deduplicatedMemories.push(mem);
      }
    }

    // 3. MANDATORY SECURITY POLICIES (CANNOT BE TRUNCATED OR REMOVED)
    // "Aturan keamanan TIDAK boleh hilang saat merangkum."
    const securityPoliciesText = input.systemPolicies
      .map((p, idx) => `[KEBIJAKAN-KEAMANAN-${idx + 1}] ${p.trim()}`)
      .join('\n');
    const securityPoliciesTokens = estimateTokens(securityPoliciesText);

    // Reserve tokens for security policy + user prompt
    const userPromptTokens = estimateTokens(input.userPrompt);
    let remainingBudget = tokenBudget - securityPoliciesTokens - userPromptTokens;

    if (remainingBudget < 0) {
      // Even if budget is extremely tight, security policies are preserved 100%!
      remainingBudget = 0;
      truncatedSections.push('context_severely_constrained');
    }

    // 4. ASSEMBLE PROJECT & TASK STATE (bounded)
    const contextSections: string[] = [];

    if (input.projectState && Object.keys(input.projectState).length > 0) {
      const projText = `[PROJECT STATE]: ${JSON.stringify(input.projectState)}`;
      if (estimateTokens(projText) <= remainingBudget * 0.2) {
        contextSections.push(projText);
        remainingBudget -= estimateTokens(projText);
      } else {
        truncatedSections.push('project_state');
      }
    }

    if (input.taskState && Object.keys(input.taskState).length > 0) {
      const taskText = `[TASK STATE]: ${JSON.stringify(input.taskState)}`;
      if (estimateTokens(taskText) <= remainingBudget * 0.2) {
        contextSections.push(taskText);
        remainingBudget -= estimateTokens(taskText);
      } else {
        truncatedSections.push('task_state');
      }
    }

    // 5. ASSEMBLE MEMORIES (respect topK and token budget)
    const usedMemories: MemoryRecord[] = [];
    if (deduplicatedMemories.length > 0) {
      const memoryLines: string[] = [];
      const candidateList =
        typeof input.options?.topK === 'number' && input.options.topK > 0
          ? deduplicatedMemories.slice(0, input.options.topK)
          : deduplicatedMemories;

      for (const mem of candidateList) {
        const line = `- [${mem.type.toUpperCase()}] (${mem.scope}) ${mem.content}`;
        const lineTokens = estimateTokens(line);
        if (remainingBudget >= lineTokens) {
          memoryLines.push(line);
          usedMemories.push(mem);
          remainingBudget -= lineTokens;
        } else {
          truncatedSections.push(`memory:${mem.id}`);
        }
      }
      if (memoryLines.length > 0) {
        contextSections.push(`[RELEVANT MEMORIES]:\n${memoryLines.join('\n')}`);
      }
    }

    // 6. ASSEMBLE ARTIFACTS
    if (input.artifacts && input.artifacts.length > 0) {
      const artifactLines: string[] = [];
      for (const art of input.artifacts) {
        const artText = `[ARTIFACT: ${art.title}]: ${art.content.slice(0, 500)}`;
        const artTokens = estimateTokens(artText);
        if (remainingBudget >= artTokens) {
          artifactLines.push(artText);
          remainingBudget -= artTokens;
        } else {
          truncatedSections.push(`artifact:${art.id}`);
        }
      }
      if (artifactLines.length > 0) {
        contextSections.push(artifactLines.join('\n\n'));
      }
    }

    // 7. CONVERSATION HISTORY & SUMMARIZATION / COMPACTION
    const history = input.conversationHistory ?? [];
    let summarizedHistoryCount = 0;
    let isCompacted = Boolean(input.compactedSummary);
    let resultingCompactedSummary: string | undefined = input.compactedSummary;
    const recentMessages: ChatMessage[] = [];

    // Inject existing compactedSummary if provided
    if (input.compactedSummary && input.compactedSummary.trim().length > 0) {
      contextSections.push(`[RINGKASAN KONTEKS PERCAKAPAN TERDAHULU]:\n${input.compactedSummary.trim()}`);
    }

    if (history.length > 0) {
      const compactionThreshold = input.options?.compactionThreshold ?? 0.75;
      const historyTokens = history.reduce((acc, m) => acc + estimateTokens(m.content), 0);
      const isApproachingLimit = historyTokens > tokenBudget * compactionThreshold;
      const recentWindow = isApproachingLimit ? 4 : 6;

      if (history.length > recentWindow) {
        summarizedHistoryCount = history.length - recentWindow;
        const older = history.slice(0, summarizedHistoryCount);
        resultingCompactedSummary = `[RINGKASAN RIWAYAT LAMBAU (${older.length} pesan)]: Diskusi sebelumnya melibatkan topik terkait: ${older.map((m) => `${m.role}: ${m.content.slice(0, 50)}`).join('; ')}...`;
        contextSections.push(resultingCompactedSummary);
        isCompacted = true;
      }

      const sliceToKeep = history.slice(summarizedHistoryCount);
      for (const msg of sliceToKeep) {
        const msgTokens = estimateTokens(msg.content);
        if (remainingBudget >= msgTokens) {
          recentMessages.push({
            role: msg.role,
            content: msg.content,
          });
          remainingBudget -= msgTokens;
        } else {
          truncatedSections.push('older_conversation_messages');
        }
      }
    }

    // Add tool output messages
    for (const tool of boundedToolOutputs) {
      const toolText = `[TOOL RESULT: ${tool.toolName}]\n${tool.output}`;
      const toolTokens = estimateTokens(toolText);
      if (remainingBudget >= toolTokens) {
        recentMessages.push({
          role: 'tool',
          name: tool.toolName,
          content: tool.output,
        });
        remainingBudget -= toolTokens;
      } else {
        truncatedSections.push(`tool_omitted:${tool.toolName}`);
      }
    }

    // 8. DETERMINISTIC PROMPT ASSEMBLY
    // System message: Security Policies (guaranteed) + Additional Context sections
    const systemContent = [securityPoliciesText, ...contextSections].filter(Boolean).join('\n\n');

    const assembledMessages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...recentMessages,
      { role: 'user', content: input.userPrompt },
    ];

    let totalTokens = 0;
    for (const msg of assembledMessages) {
      totalTokens += estimateTokens(
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      );
    }

    return {
      assembledMessages,
      totalEstimatedTokens: totalTokens,
      tokenBudget,
      budgetRemaining: Math.max(0, tokenBudget - totalTokens),
      truncatedSections,
      summarizedHistoryCount,
      isCompacted,
      compactedSummary: resultingCompactedSummary,
      preservedSecurityPoliciesCount: input.systemPolicies.length,
      usedMemories,
      usedMemoryIds: usedMemories.map((m) => m.id),
    };
  }
}
