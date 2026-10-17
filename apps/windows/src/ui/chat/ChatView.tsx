import React, { useRef } from 'react';
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
  } = useAgentStore();

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

  return (
    <div className="chat-viewport">
      <div className="chat-center-container">
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
