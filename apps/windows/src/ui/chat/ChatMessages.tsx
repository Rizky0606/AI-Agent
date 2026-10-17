import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, RotateCcw, Edit2, XCircle } from 'lucide-react';
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
  const { conversationTasks, taskEvents, cancelServerTask } = useAgentStore();

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

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="chat-messages-scroll"
      role="log"
      aria-live="polite"
    >
      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isLastAssistant = !isUser && index === messages.length - 1;
        const isCopied = copiedId === message.id;

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

            {/* Actions for Message */}
            <div className="chat-message-actions">
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
