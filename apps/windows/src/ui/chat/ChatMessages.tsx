import React, { useState } from 'react';
import { Copy, Check, RotateCcw, Edit2 } from 'lucide-react';
import type { ChatMessage } from '../../state/agent-store.ts';
import { MarkdownMessage } from '../components/MarkdownMessage.tsx';
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
    <div className="chat-messages-scroll" role="log" aria-live="polite">
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

              {message.model && (
                <span style={{ fontSize: 10, color: 'var(--text-sub)', marginLeft: 4 }}>
                  {message.model}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
};
