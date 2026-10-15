import React, { useRef, useEffect } from 'react';
import { ArrowUp, Square, Cpu, SlidersHorizontal } from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { idID } from '../locales/id-ID.ts';

interface ChatComposerProps {
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({ textareaRef }) => {
  const {
    chatDraft,
    setChatDraft,
    sendChat,
    cancelChat,
    chatStreaming,
    selectedModel,
    setSelectedModel,
    selectedMode,
    setSelectedMode,
  } = useAgentStore();

  const localRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto resize textarea height based on content up to 140px
  useEffect(() => {
    if (localRef.current) {
      localRef.current.style.height = 'auto';
      localRef.current.style.height = `${Math.min(localRef.current.scrollHeight, 140)}px`;
    }
  }, [chatDraft]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatDraft.trim() && !chatStreaming) {
        sendChat();
      }
    }
  };

  return (
    <div className="floating-composer-wrapper">
      <div className="floating-composer-card">
        {/* Top Toolbar with Model and Mode Chips */}
        <div className="composer-toolbar-top">
          <div className="composer-chips-group">
            {/* Mode Chip */}
            <div className="composer-chip" title="Mode Asisten">
              <SlidersHorizontal size={12} color="var(--accent-cyan)" />
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value as typeof selectedMode)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 11,
                  color: 'inherit',
                  cursor: 'pointer',
                  outline: 'none',
                  padding: 0,
                }}
                aria-label={idID.chat.modeLabel}
              >
                <option value="auto">{idID.chat.modes.auto}</option>
                <option value="fast">{idID.chat.modes.fast}</option>
                <option value="coding">{idID.chat.modes.coding}</option>
                <option value="complex">{idID.chat.modes.complex}</option>
                <option value="research">{idID.chat.modes.research}</option>
              </select>
            </div>

            {/* Model Chip */}
            <div className="composer-chip" title="Model AI">
              <Cpu size={12} color="var(--accent-blue)" />
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="Auto"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 11,
                  color: 'inherit',
                  width: 70,
                  outline: 'none',
                  padding: 0,
                }}
                aria-label={idID.chat.modelLabel}
              />
            </div>
          </div>
        </div>

        {/* Input Textarea and Send/Stop Button */}
        <div className="composer-input-row">
          <textarea
            ref={(node) => {
              localRef.current = node;
              if (typeof textareaRef === 'function') {
                textareaRef(node);
              } else if (textareaRef && 'current' in textareaRef) {
                (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
              }
            }}
            className="composer-textarea"
            placeholder={idID.chat.composerPlaceholder}
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={chatStreaming}
            aria-label="Pesan Anda"
          />

          {chatStreaming ? (
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-danger ui-icon-btn-md"
              onClick={cancelChat}
              title={idID.chat.stop}
              aria-label={idID.chat.stop}
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-primary ui-icon-btn-md"
              onClick={sendChat}
              disabled={!chatDraft.trim()}
              title={idID.chat.send}
              aria-label={idID.chat.send}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
