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
  Clock,
  FileText,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { idID } from '../locales/id-ID.ts';
import { ModelSelectorPopover } from './ModelSelectorPopover.tsx';
import type { PromptTemplateRecord } from '../../api/client.ts';

interface ChatComposerProps {
  textareaRef?: React.Ref<HTMLTextAreaElement> | undefined;
  onNavigateToResearch?: (() => void) | undefined;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  textareaRef,
  onNavigateToResearch,
}) => {
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
    researchDepth,
    setResearchDepth,
    researchBudgets,
    fetchResearchConfig,
    startResearch,
    isLoadingResearch,
    messageQueue,
    queueMessage,
    promptTemplates,
    fetchPromptTemplates,
    cycleFavoriteModel,
  } = useAgentStore();

  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState<string | null>(null);
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const modelChipAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (runtimes.length === 0) {
      void refreshRuntimes();
    }
  }, [runtimes.length, refreshRuntimes]);

  useEffect(() => {
    if (selectedMode === 'research') {
      void fetchResearchConfig();
    }
  }, [selectedMode, fetchResearchConfig]);

  useEffect(() => {
    void fetchPromptTemplates();
  }, [fetchPromptTemplates]);

  // Handle slash template trigger detection
  useEffect(() => {
    if (chatDraft.startsWith('/')) {
      const query = chatDraft.slice(1).trim().toLowerCase();
      setTemplateSearch(query);
    } else {
      setTemplateSearch(null);
    }
  }, [chatDraft]);

  // Auto resize textarea height based on content up to 140px
  useEffect(() => {
    if (localRef.current) {
      localRef.current.style.height = 'auto';
      localRef.current.style.height = `${Math.min(localRef.current.scrollHeight, 140)}px`;
    }
  }, [chatDraft]);

  const handleSubmit = async () => {
    if (!chatDraft.trim() || isLoadingResearch) return;
    if (chatStreaming) {
      queueMessage(chatDraft);
      return;
    }
    if (selectedMode === 'research') {
      const q = chatDraft.trim();
      setChatDraft('');
      try {
        await startResearch(q, researchDepth);
        if (onNavigateToResearch) {
          onNavigateToResearch();
        }
      } catch {
        // Error logged to store
      }
    } else {
      sendChat();
    }
  };

  const handleSelectTemplate = (template: PromptTemplateRecord) => {
    setChatDraft(template.content);
    setTemplateSearch(null);
    if (localRef.current) {
      localRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Sesi 27: Shortcut keyboard Ctrl+M / Alt+M untuk siklus model favorit
    if ((e.ctrlKey || e.altKey) && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      cycleFavoriteModel();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
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

        {/* Research Depth Bar (when mode is research) */}
        {selectedMode === 'research' && (
          <div className="composer-research-depth-bar" role="radiogroup" aria-label={idID.research.depth.label}>
            <div className="research-depth-chips">
              <button
                type="button"
                className={`research-depth-chip-btn ${researchDepth === 'quick' ? 'active' : ''}`}
                onClick={() => setResearchDepth('quick')}
                role="radio"
                aria-checked={researchDepth === 'quick'}
              >
                <span>{idID.research.depth.quick}</span>
              </button>
              <button
                type="button"
                className={`research-depth-chip-btn ${researchDepth === 'standard' ? 'active' : ''}`}
                onClick={() => setResearchDepth('standard')}
                role="radio"
                aria-checked={researchDepth === 'standard'}
              >
                <span>{idID.research.depth.standard}</span>
              </button>
              <button
                type="button"
                className={`research-depth-chip-btn ${researchDepth === 'deep' ? 'active' : ''}`}
                onClick={() => setResearchDepth('deep')}
                role="radio"
                aria-checked={researchDepth === 'deep'}
              >
                <span>{idID.research.depth.deep}</span>
              </button>
            </div>

            <div className="research-depth-estimate-text">
              {researchDepth === 'quick' &&
                `Estimasi server: ~${researchBudgets.quick.maxSearches} pencarian, ~${researchBudgets.quick.maxPagesRead} halaman, maks ${Math.round(researchBudgets.quick.maxDurationMs / 1000)} dtk`}
              {researchDepth === 'standard' &&
                `Estimasi server: ~${researchBudgets.standard.maxSearches} pencarian, ~${researchBudgets.standard.maxPagesRead} halaman, maks ${Math.round(researchBudgets.standard.maxDurationMs / 60000)} mnt`}
              {researchDepth === 'deep' &&
                `Estimasi server: ~${researchBudgets.deep.maxSearches} pencarian, ~${researchBudgets.deep.maxPagesRead} halaman, maks ${Math.round(researchBudgets.deep.maxDurationMs / 60000)} mnt (tinjau rencana)`}
            </div>
          </div>
        )}

        {/* Prompt Template Autocomplete Popover (Sesi 27) */}
        {templateSearch !== null && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 12,
              right: 12,
              marginBottom: 8,
              maxHeight: 220,
              overflowY: 'auto',
              borderRadius: 8,
              border: '1px solid var(--border-subtle, #334155)',
              background: 'var(--bg-secondary, #1e293b)',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
              zIndex: 50,
              padding: 6,
            }}
            role="listbox"
            aria-label="Daftar Template Prompt"
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-sub, #94a3b8)',
                padding: '4px 8px',
                borderBottom: '1px solid var(--border-subtle, #334155)',
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <FileText size={12} color="var(--accent-cyan, #06b6d4)" />
              <span>{idID.chat.templates.title} ({promptTemplates.length})</span>
            </div>
            {promptTemplates
              .filter(
                (t) =>
                  t.name.toLowerCase().includes(templateSearch) ||
                  (t.title && t.title.toLowerCase().includes(templateSearch)),
              )
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTemplate(t)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-main, #f8fafc)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary, #334155)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ color: 'var(--accent-cyan, #06b6d4)' }}>/{t.name}</strong>
                    <span style={{ color: 'var(--text-sub, #94a3b8)' }}>{t.title || t.description || ''}</span>
                  </div>
                  {t.variables && t.variables.length > 0 && (
                    <div style={{ display: 'flex', gap: 3 }}>
                      {t.variables.map((v) => (
                        <span
                          key={v}
                          style={{
                            fontSize: 10,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: 'rgba(6, 182, 212, 0.15)',
                            color: 'var(--accent-cyan, #06b6d4)',
                          }}
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            {promptTemplates.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-sub, #94a3b8)', padding: '8px 10px' }}>
                {idID.chat.templates.noTemplates}
              </div>
            )}
          </div>
        )}

        {/* Message Queue Ribbon Banner (Sesi 27) */}
        {messageQueue.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 12px',
              background: 'rgba(6, 182, 212, 0.1)',
              borderBottom: '1px solid rgba(6, 182, 212, 0.2)',
              fontSize: 11,
              color: 'var(--accent-cyan, #06b6d4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={12} />
              <span>
                {idID.chat.queue.queuedCount(messageQueue.length)}: &quot;{messageQueue[0]?.slice(0, 36)}...&quot;
              </span>
            </div>
            <button
              type="button"
              onClick={() => useAgentStore.setState({ messageQueue: [] })}
              className="ui-btn ui-btn-ghost ui-btn-sm"
              style={{ fontSize: 10, padding: '1px 6px', height: 20 }}
            >
              {idID.chat.queue.clearQueue}
            </button>
          </div>
        )}

        {/* Input Textarea and Send/Queue/Stop Button */}
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
            placeholder={
              selectedMode === 'research'
                ? 'Tulis topik riset mendalam... (Enter untuk mulai riset)'
                : chatStreaming
                  ? 'Ketik pesan untuk dimasukkan ke antrean (Enter untuk Antre)...'
                  : idID.chat.composerPlaceholder
            }
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoadingResearch}
            aria-label="Pesan Anda"
          />

          {chatStreaming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {chatDraft.trim().length > 0 && (
                <button
                  type="button"
                  className="ui-btn ui-btn-primary ui-btn-sm"
                  onClick={() => void handleSubmit()}
                  title={idID.chat.queue.action}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 32 }}
                >
                  <Clock size={13} />
                  <span>{idID.chat.queue.action}</span>
                </button>
              )}
              <button
                type="button"
                className="ui-icon-btn ui-icon-btn-danger ui-icon-btn-md"
                onClick={cancelChat}
                title={idID.chat.stop}
                aria-label={idID.chat.stop}
              >
                <Square size={16} fill="currentColor" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-primary ui-icon-btn-md"
              onClick={() => void handleSubmit()}
              disabled={!chatDraft.trim() || isLoadingResearch}
              title={selectedMode === 'research' ? 'Mulai riset' : idID.chat.send}
              aria-label={selectedMode === 'research' ? 'Mulai riset' : idID.chat.send}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
