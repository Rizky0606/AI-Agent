import React, { useState, useRef, useEffect } from 'react';
import {
  Copy,
  Check,
  RotateCcw,
  Edit2,
  XCircle,
  GitBranch,
  ChevronLeft,
  ChevronRight,
  Archive,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import type { ChatMessage } from '../../state/agent-store.ts';
import { useAgentStore } from '../context.ts';
import { aggregateRuntimeSteps } from '@personal-ai-os/shared';
import { MarkdownMessage } from '../components/MarkdownMessage.tsx';
import { ToolStepCard } from './ToolStepCard.tsx';
import { idID } from '../locales/id-ID.ts';

interface ChatMessagesProps {
  messages: ChatMessage[];
  streaming: boolean;
  onRetry: () => void;
  onEditUserMessage: (content: string) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  streaming,
  onRetry,
  onEditUserMessage,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCompacted, setShowCompacted] = useState<boolean>(false);
  const {
    conversations,
    activeConversationId,
    conversationTasks,
    taskEvents,
    cancelServerTask,
    switchMessageBranch,
    deleteMessageBranch,
  } = useAgentStore();

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef<boolean>(true);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    isAtBottomRef.current = atBottom;
  };

  useEffect(() => {
    if (isAtBottomRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, conversationTasks, taskEvents, streaming]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard access fallback
    }
  };

  const handleSwitchSibling = async (message: ChatMessage, delta: -1 | 1) => {
    if (!message.siblingMessageIds || !message.branchCount) return;
    const currentIdx = message.branchIndex ?? 0;
    const targetIdx = currentIdx + delta;
    if (targetIdx < 0 || targetIdx >= message.siblingMessageIds.length) return;
    const targetId = message.siblingMessageIds[targetIdx];
    if (targetId) {
      await switchMessageBranch(targetId);
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="chat-messages-scroll"
      role="log"
      aria-live="polite"
    >
      {/* Context Compaction Accordion Banner (Sesi 27) */}
      {activeConv?.compactedSummary && (
        <div
          style={{
            margin: '8px 16px 16px 16px',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle, #334155)',
            background: 'var(--bg-secondary, #1e293b)',
            fontSize: 12,
          }}
          aria-label="Ringkasan Konteks Percakapan"
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Archive size={14} color="var(--accent-cyan, #06b6d4)" />
              <strong style={{ color: 'var(--text-main, #f8fafc)' }}>
                {idID.chat.compaction.title}
              </strong>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(6, 182, 212, 0.15)',
                  color: 'var(--accent-cyan, #06b6d4)',
                }}
              >
                {idID.chat.compaction.badge}
              </span>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => setShowCompacted((prev) => !prev)}
              style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
            >
              {showCompacted ? (
                <>
                  <ChevronUp size={12} />
                  <span>{idID.chat.compaction.hide}</span>
                </>
              ) : (
                <>
                  <ChevronDown size={12} />
                  <span>{idID.chat.compaction.show}</span>
                </>
              )}
            </button>
          </div>

          {showCompacted && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.25)',
                color: 'var(--text-sub, #94a3b8)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                borderLeft: '3px solid var(--accent-cyan, #06b6d4)',
              }}
            >
              {activeConv.compactedSummary}
            </div>
          )}
        </div>
      )}

      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isLastAssistant = !isUser && index === messages.length - 1;
        const isCopied = copiedId === message.id;
        const hasBranches = Boolean(message.branchCount && message.branchCount > 1);
        const branchIdx = message.branchIndex ?? 0;
        const branchTotal = message.branchCount ?? 1;

        return (
          <article
            key={message.id || `msg-${index}`}
            className={`chat-message-row ${message.role}`}
            aria-label={`Pesan dari ${isUser ? 'Anda' : 'Asisten'}`}
          >
            {/* Message Bubble */}
            <div className={`chat-message-bubble ${message.role}`}>
              {isUser ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
              ) : (
                <MarkdownMessage content={message.content || (streaming && isLastAssistant ? idID.chat.responding : '')} />
              )}
            </div>

            {/* Actions & Branch Switcher for Message */}
            <div className="chat-message-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Branch Navigator if message has multiple alternatives */}
              {hasBranches && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    background: 'var(--bg-tertiary, #334155)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 11,
                    color: 'var(--text-main, #f8fafc)',
                  }}
                  title="Navigasi cabang alternatif pesan ini"
                >
                  <GitBranch size={11} color="var(--accent-cyan, #06b6d4)" />
                  <button
                    type="button"
                    disabled={branchIdx === 0}
                    onClick={() => void handleSwitchSibling(message, -1)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: branchIdx === 0 ? 'var(--text-disabled, #64748b)' : 'inherit',
                      cursor: branchIdx === 0 ? 'default' : 'pointer',
                      padding: '0 2px',
                    }}
                    title={idID.chat.actions.previousBranch}
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <span style={{ fontWeight: 600 }}>{idID.chat.actions.branch(branchIdx + 1, branchTotal)}</span>
                  <button
                    type="button"
                    disabled={branchIdx >= branchTotal - 1}
                    onClick={() => void handleSwitchSibling(message, 1)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: branchIdx >= branchTotal - 1 ? 'var(--text-disabled, #64748b)' : 'inherit',
                      cursor: branchIdx >= branchTotal - 1 ? 'default' : 'pointer',
                      padding: '0 2px',
                    }}
                    title={idID.chat.actions.nextBranch}
                  >
                    <ChevronRight size={12} />
                  </button>

                  <button
                    type="button"
                    onClick={() => void deleteMessageBranch(message.id)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--accent-rose, #f43f5e)',
                      cursor: 'pointer',
                      padding: '0 2px',
                      marginLeft: 2,
                    }}
                    title={idID.chat.actions.deleteBranch}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}

              <button
                type="button"
                className="msg-action-btn"
                onClick={() => void handleCopy(message.id, message.content)}
                title={idID.chat.actions.copy}
              >
                {isCopied ? <Check size={12} color="var(--accent-emerald)" /> : <Copy size={12} />}
                <span>{isCopied ? idID.chat.actions.copied : idID.chat.actions.copy}</span>
              </button>

              {isUser && (
                <button
                  type="button"
                  className="msg-action-btn"
                  onClick={() => onEditUserMessage(message.content)}
                  title={idID.chat.actions.edit}
                >
                  <Edit2 size={12} />
                  <span>{idID.chat.actions.edit}</span>
                </button>
              )}

              {!isUser && isLastAssistant && !streaming && (
                <button
                  type="button"
                  className="msg-action-btn"
                  onClick={onRetry}
                  title={idID.chat.actions.retry}
                >
                  <RotateCcw size={12} />
                  <span>{idID.chat.actions.retry}</span>
                </button>
              )}

              {!isUser && (message.resolvedModel || message.model) && (
                <span
                  style={{
                    fontSize: 11,
                    color: message.fallbackUsed ? 'var(--accent-amber, #f59e0b)' : 'var(--text-sub)',
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: message.fallbackUsed ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                    border: message.fallbackUsed ? '1px solid rgba(245, 158, 11, 0.3)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title={message.fallbackUsed ? 'Model cadangan (fallback) digunakan karena model utama tidak merespons.' : undefined}
                >
                  {message.fallbackUsed
                    ? `Dijawab oleh ${message.resolvedModel || message.model} (fallback)`
                    : `Dijawab oleh ${message.resolvedModel || message.model}`}
                </span>
              )}
            </div>
          </article>
        );
      })}

      {/* Real-time Conversation Tasks & Runtime Steps Strip */}
      {conversationTasks && conversationTasks.length > 0 && (
        <div className="chat-conversation-tasks-section" aria-label={idID.chat.conversationTasks}>
          {conversationTasks.map((task) => {
            const runtimeLabel = String(task.payload?.runtime || task.payload?.selectedRuntimeId || 'omp');
            const formattedEvents = taskEvents.map((ev, idx) => ({
              id: ev.id || `ev-${idx}`,
              taskId: task.id,
              eventType: ev.eventType,
              payload: (ev.payload ?? {}) as Record<string, unknown>,
              createdAt: ev.createdAt ?? new Date().toISOString(),
            }));
            const steps = aggregateRuntimeSteps(formattedEvents);

            return (
              <div key={task.id} className="chat-task-execution-strip">
                <div className="chat-task-header-row">
                  <div className="chat-task-title-group">
                    <strong className="card-title-text">{task.kind}</strong>
                    <span className={`status-pill ${task.status}`}>{task.status}</span>
                    <span className="task-runtime-pill">
                      Runtime: {runtimeLabel}
                    </span>
                    {task.progress != null && <span>{task.progress}%</span>}
                  </div>

                  {(task.status === 'running' || task.status === 'paused' || task.status === 'waiting_approval') && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-danger ui-btn-sm"
                      onClick={() => void cancelServerTask(task.id)}
                      title="Hentikan / Batalkan Tugas"
                    >
                      <XCircle size={12} />
                      <span>Hentikan</span>
                    </button>
                  )}
                </div>

                {steps.length > 0 ? (
                  <div className="chat-task-steps-container">
                    {steps.map((step) => (
                      <ToolStepCard
                        key={step.id}
                        step={step}
                        onStop={task.status === 'running' ? () => void cancelServerTask(task.id) : undefined}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
