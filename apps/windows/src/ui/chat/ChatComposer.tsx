import React, { useRef, useEffect, useState } from 'react';
import {
  ArrowUp,
  Square,
  Cpu,
  SlidersHorizontal,
  ChevronDown,
  RefreshCw,
  X,
  AlertCircle,
  Terminal,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { idID } from '../locales/id-ID.ts';
import { ModelSelectorPopover } from './ModelSelectorPopover.tsx';

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
    selectedMode,
    setSelectedMode,
    selectedRuntime,
    setSelectedRuntime,
    runtimes,
    runtimeStatus,
    refreshRuntimes,
    modelCatalogUnavailable,
    modelNotice,
    clearModelNotice,
    refreshModels,
  } = useAgentStore();

  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const modelChipAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (runtimes.length === 0) {
      void refreshRuntimes();
    }
  }, [runtimes.length, refreshRuntimes]);

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

  const modelDisplayText =
    selectedModel === 'auto'
      ? 'Auto (Cerdas)'
      : selectedModel.length > 20
        ? `${selectedModel.slice(0, 18)}…`
        : selectedModel;

  return (
    <div className="floating-composer-wrapper">
      <div className="floating-composer-card">
        {/* Model Notice Banner if model disappeared and reverted to Auto */}
        {modelNotice && (
          <div className="composer-model-notice" role="status">
            <div className="composer-notice-content">
              <AlertCircle size={13} />
              <span>{modelNotice}</span>
            </div>
            <button
              type="button"
              onClick={clearModelNotice}
              className="composer-notice-close-btn"
              aria-label="Tutup pemberitahuan"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Top Toolbar with Model and Mode Chips */}
        <div className="composer-toolbar-top">
          <div className="composer-chips-group">
            {/* Mode Chip */}
            <div className="composer-chip" title="Mode Asisten AI">
              <SlidersHorizontal size={12} color="var(--accent-cyan)" />
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value as typeof selectedMode)}
                className="composer-chip-select"
                aria-label={idID.chat.modeLabel}
              >
                <option value="auto">{idID.chat.modes.auto}</option>
                <option value="fast">{idID.chat.modes.fast}</option>
                <option value="coding">{idID.chat.modes.coding}</option>
                <option value="complex">{idID.chat.modes.complex}</option>
                <option value="research">{idID.chat.modes.research}</option>
              </select>
            </div>

            {/* Runtime Chip */}
            <div className="composer-chip" title={runtimeStatus || 'Pilih target eksekusi runtime'}>
              <Terminal size={12} color="var(--accent-emerald, #10b981)" />
              <select
                value={selectedRuntime}
                onChange={(e) => setSelectedRuntime(e.target.value as typeof selectedRuntime)}
                className="composer-chip-select"
                aria-label={idID.chat.runtimeLabel}
              >
                <option value="auto">{idID.chat.runtime.auto}</option>
                <option value="omp">{idID.chat.runtime.omp}</option>
                <option value="hermes">{idID.chat.runtime.hermes}</option>
                <option value="native">{idID.chat.runtime.native}</option>
              </select>
            </div>

            {/* Model Chip (Interactive Popover Trigger) */}
            <div
              ref={modelChipAnchorRef}
              className={`composer-chip interactive ${modelCatalogUnavailable ? 'disabled' : ''}`}
              onClick={() => setIsModelPopoverOpen((prev) => !prev)}
              title={
                modelCatalogUnavailable
                  ? 'Katalog model tidak dapat dihubungi. Mode Auto tetap berfungsi.'
                  : 'Klik untuk memilih Model AI'
              }
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={isModelPopoverOpen}
            >
              <Cpu size={12} color="var(--accent-blue)" />
              <span className="composer-chip-text">{modelDisplayText}</span>

              {modelCatalogUnavailable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void refreshModels();
                  }}
                  className="composer-model-offline-retry"
                  title="Katalog offline. Klik untuk coba lagi."
                >
                  <RefreshCw size={10} />
                  <span>Coba lagi</span>
                </button>
              ) : (
                <ChevronDown size={11} color="var(--text-sub)" />
              )}
            </div>

            {/* Model Selector Popover */}
            <ModelSelectorPopover
              isOpen={isModelPopoverOpen}
              onClose={() => setIsModelPopoverOpen(false)}
              anchorRef={modelChipAnchorRef}
            />
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
