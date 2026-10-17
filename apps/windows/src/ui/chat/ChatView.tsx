import React, { useRef, useState } from 'react';
import { Archive, FileText, Code2 } from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { ChatMessages } from './ChatMessages.tsx';
import { EmptyChatState } from './EmptyChatState.tsx';
import { ChatComposer } from './ChatComposer.tsx';
import { idID } from '../locales/id-ID.ts';

interface ChatViewProps {
  onNavigateToResearch?: (() => void) | undefined;
}

export const ChatView: React.FC<ChatViewProps> = ({ onNavigateToResearch }) => {
  const {
    conversations,
    activeConversationId,
    chatStreaming,
    chatError,
    clearChatError,
    retryChat,
    setChatDraft,
    exportActiveConversation,
    compactActiveConversation,
  } = useAgentStore();

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [compactStatus, setCompactStatus] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConversation = conversations.find((item) => item.id === activeConversationId);
  const messages = activeConversation?.messages ?? [];
  const hasMessages = messages.length > 0;

  const handleSelectSamplePrompt = (prompt: string) => {
    setChatDraft(prompt);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.focus();
    }
  };

  const handleEditUserMessage = (content: string) => {
    setChatDraft(content);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.focus();
    }
  };

  const handleExport = async (format: 'markdown' | 'html') => {
    try {
      setIsExporting(true);
      const res = await exportActiveConversation(format);
      const mime = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8';
      const blob = new Blob([res.content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Error handled
    } finally {
      setIsExporting(false);
    }
  };

  const handleCompact = async () => {
    setCompactStatus(idID.chat.compaction.compacting);
    const res = await compactActiveConversation();
    if (res.compacted) {
      setCompactStatus(idID.chat.compaction.success);
      setTimeout(() => setCompactStatus(null), 3000);
    } else {
      setCompactStatus(res.reason || idID.chat.compaction.tooShort);
      setTimeout(() => setCompactStatus(null), 4000);
    }
  };

  return (
    <div className="chat-viewport">
      <div className="chat-center-container">
        {/* Session Toolbar for Active Conversation (Sesi 27) */}
        {hasMessages && !activeConversationId.startsWith('draft-') && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 16px',
              borderBottom: '1px solid var(--border-subtle, #334155)',
              fontSize: 11,
              color: 'var(--text-sub, #94a3b8)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{messages.length} pesan</span>
              {compactStatus && (
                <span style={{ color: 'var(--accent-cyan, #06b6d4)', fontWeight: 500 }}>
                  · {compactStatus}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                onClick={() => void handleCompact()}
                title={idID.chat.compaction.compactNow}
                style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
              >
                <Archive size={12} />
                <span>{idID.chat.compaction.compactNow}</span>
              </button>

              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                onClick={() => void handleExport('markdown')}
                disabled={isExporting}
                title={idID.chat.export.markdown}
                style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
              >
                <FileText size={12} />
                <span>MD</span>
              </button>

              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                onClick={() => void handleExport('html')}
                disabled={isExporting}
                title={idID.chat.export.html}
                style={{ fontSize: 11, padding: '2px 8px', height: 26 }}
              >
                <Code2 size={12} />
                <span>HTML</span>
              </button>
            </div>
          </div>
        )}

        {hasMessages ? (
          <ChatMessages
            messages={messages}
            streaming={chatStreaming}
            onRetry={retryChat}
            onEditUserMessage={handleEditUserMessage}
          />
        ) : (
          <EmptyChatState onSelectPrompt={handleSelectSamplePrompt} />
        )}

        {/* Chat Error Banner */}
        {chatError && (
          <div className="chat-error-banner" role="alert">
            <span className="chat-error-text">{chatError}</span>
            <div className="chat-error-actions">
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                onClick={clearChatError}
              >
                {idID.chat.clearError}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary ui-btn-sm"
                onClick={retryChat}
                disabled={chatStreaming}
              >
                {idID.chat.retryError}
              </button>
            </div>
          </div>
        )}

        {/* Floating Composer */}
        <ChatComposer
          textareaRef={composerTextareaRef}
          onNavigateToResearch={onNavigateToResearch}
        />
      </div>
    </div>
  );
};
