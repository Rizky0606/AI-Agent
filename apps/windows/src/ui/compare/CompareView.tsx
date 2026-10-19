import React, { useState, useEffect } from 'react';
import {
  Columns2,
  ArrowLeft,
  Plus,
  Eye,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { idID } from '../locales/id-ID.ts';
import { useToast } from '../components/Toast.tsx';
import { CompareColumn } from './CompareColumn.tsx';
import { CompareSynthesisCard } from './CompareSynthesisCard.tsx';
import { CompareSidebar } from './CompareSidebar.tsx';
import './CompareView.css';

interface CompareViewProps {
  onNavigateToChat?: () => void;
}

export const CompareView: React.FC<CompareViewProps> = ({ onNavigateToChat }) => {
  const {
    models,
    refreshModels,
    activeCompareId,
    activeCompareState,
    compareHistory,
    isLoadingCompare,
    startCompare,
    openCompare,
    closeActiveCompare,
    refreshCompareHistory,
    revealCompare,
    selectCompareWinner,
    synthesizeCompare,
    promoteCompare,
    deleteCompare,
    setActiveConversation,
  } = useAgentStore();

  const { success, warning, error: toastError } = useToast();

  // Form state
  const [prompt, setPrompt] = useState('');
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [blindMode, setBlindMode] = useState(true);
  const [requestSynthesis, setRequestSynthesis] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  useEffect(() => {
    void refreshModels();
    void refreshCompareHistory();
  }, [refreshModels, refreshCompareHistory]);

  // Pre-select 2-3 available models if none selected
  useEffect(() => {
    if (selectedModelIds.length === 0 && models.length >= 2) {
      const candidates = models
        .filter((m) => m.availabilityStatus !== 'unavailable')
        .slice(0, 2)
        .map((m) => m.id);
      if (candidates.length >= 2) {
        setSelectedModelIds(candidates);
      }
    }
  }, [models, selectedModelIds.length]);

  const handleToggleModel = (modelId: string) => {
    if (selectedModelIds.includes(modelId)) {
      setSelectedModelIds(selectedModelIds.filter((id) => id !== modelId));
    } else {
      if (selectedModelIds.length >= 3) {
        warning('Maksimal 3 model untuk satu perbandingan.');
        return;
      }
      setSelectedModelIds([...selectedModelIds, modelId]);
    }
  };

  const handleStartCompare = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || selectedModelIds.length < 2 || selectedModelIds.length > 3) {
      return;
    }

    try {
      await startCompare({
        prompt: prompt.trim(),
        modelIds: selectedModelIds,
        blindMode,
        requestSynthesis,
      });
      setPrompt('');
      success('Perbandingan multi-model dimulai.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError(msg || 'Gagal memulai perbandingan.');
    }
  };

  const handleReveal = async () => {
    if (!activeCompareId) return;
    try {
      await revealCompare(activeCompareId);
      success('Identitas model berhasil diungkap.');
    } catch {
      toastError('Gagal mengungkap identitas model.');
    }
  };

  const handleSelectWinner = async (modelId: string | undefined) => {
    if (!activeCompareId || !modelId) return;
    try {
      await selectCompareWinner(activeCompareId, modelId);
      success('Pemenang berhasil dipilih!');
    } catch {
      toastError('Gagal memilih pemenang.');
    }
  };

  const handleSynthesize = async () => {
    if (!activeCompareId) return;
    setIsSynthesizing(true);
    try {
      await synthesizeCompare(activeCompareId);
      success('Sintesis perbandingan selesai dibuat.');
    } catch {
      toastError('Gagal membuat sintesis perbandingan.');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handlePromote = async () => {
    if (!activeCompareId) return;
    try {
      const res = await promoteCompare(activeCompareId, { target: 'new' });
      success(idID.compare.promotedSuccess);
      if (res.conversationId) {
        setActiveConversation(res.conversationId);
        if (onNavigateToChat) {
          onNavigateToChat();
        }
      }
    } catch {
      toastError('Gagal mempromosikan jawaban ke percakapan.');
    }
  };

  const handleDeleteRun = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Hapus perbandingan ini dari riwayat?')) {
      try {
        await deleteCompare(id);
        success('Perbandingan dihapus.');
      } catch {
        toastError('Gagal menghapus perbandingan.');
      }
    }
  };

  const state = activeCompareState;
  const isRunning = state?.status === 'running' || state?.status === 'queued';
  const canSubmit = prompt.trim().length > 0 && selectedModelIds.length >= 2 && selectedModelIds.length <= 3 && !isLoadingCompare;

  return (
    <div className="compare-layout-container">
      {/* Main Center Area */}
      <main className="compare-main-content">
        {/* Header */}
        <header className="compare-view-header">
          <div className="compare-header-left">
            {onNavigateToChat && (
              <button
                type="button"
                className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
                onClick={onNavigateToChat}
                title="Kembali ke Obrolan"
                aria-label="Kembali ke Obrolan"
              >
                <ArrowLeft size={16} />
              </button>
            )}

            <div className="compare-title-group">
              <div className="compare-title-row">
                <Columns2 size={18} color="var(--color-primary, #3b82f6)" />
                <h1 className="compare-header-title">{idID.compare.title}</h1>
              </div>
              <p className="compare-header-desc">{idID.compare.subtitle}</p>
            </div>
          </div>

          <div className="compare-header-actions">
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={closeActiveCompare}
            >
              <Plus size={14} />
              <span>{idID.compare.newComparison}</span>
            </button>
          </div>
        </header>

        {/* View Mode: Active Comparison vs New Comparison Form */}
        {state ? (
          <div>
            {/* Active Run Overview Banner */}
            <div className="compare-overview-banner">
              <div className="compare-overview-top">
                <div className="compare-badges-row">
                  <span className={`compare-badge compare-badge-status-${state.status}`}>
                    {state.status === 'running'
                      ? idID.compare.status.running
                      : state.status === 'completed'
                        ? idID.compare.status.completed
                        : state.status}
                  </span>

                  {state.blindMode && (
                    <span className={`compare-badge ${state.isRevealed ? 'compare-badge-revealed' : 'compare-badge-blind'}`}>
                      {state.isRevealed ? idID.compare.revealedBadge : idID.compare.blindModeBadge}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {state.blindMode && !state.isRevealed && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-xs"
                      onClick={handleReveal}
                    >
                      <Eye size={13} />
                      <span>{idID.compare.revealAction}</span>
                    </button>
                  )}

                  {!state.synthesis && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-xs"
                      onClick={handleSynthesize}
                      disabled={isSynthesizing || isRunning}
                    >
                      <Sparkles size={13} />
                      <span>{isSynthesizing ? idID.compare.synthesizing : idID.compare.synthesizeAction}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Prompt Text */}
              <div className="compare-prompt-display">{state.prompt}</div>

              <div className="compare-notice-banner">
                <ShieldCheck size={14} color="var(--color-primary, #3b82f6)" />
                <span>{idID.compare.noFallbackNotice}</span>
              </div>
            </div>

            {/* Side-by-Side Columns Grid */}
            <div
              className="compare-columns-grid"
              data-cols={state.results.length === 2 ? '2' : '3'}
            >
              {state.results.map((result) => (
                <CompareColumn
                  key={result.modelId || result.columnLabel}
                  result={result}
                  blindMode={state.blindMode}
                  isRevealed={state.isRevealed}
                  isWinner={state.winnerModelId === result.modelId}
                  onSelectWinner={() => handleSelectWinner(result.modelId || result.id)}
                  onPromote={() => handlePromote()}
                  isRunRunning={isRunning}
                />
              ))}
            </div>

            {/* Synthesis Card if available */}
            {state.synthesis && (
              <CompareSynthesisCard
                synthesis={state.synthesis}
                synthesisModelId={state.synthesisModelId}
              />
            )}
          </div>
        ) : (
          /* New Comparison Form Card */
          <form className="compare-form-card" onSubmit={handleStartCompare}>
            {/* Prompt input */}
            <div>
              <label htmlFor="compare-prompt-input" className="compare-form-section-title">
                <span>Prompt / Pertanyaan</span>
              </label>
              <textarea
                id="compare-prompt-input"
                className="compare-prompt-textarea"
                placeholder={idID.compare.promptPlaceholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
              />
            </div>

            {/* Model Picker */}
            <div>
              <div className="compare-form-section-title">
                <span>{idID.compare.selectModels}</span>
                <span style={{ fontSize: '0.8rem', color: selectedModelIds.length >= 2 ? 'var(--color-success, #10b981)' : 'var(--text-muted)' }}>
                  {idID.compare.modelsSelectedCount(selectedModelIds.length)}
                </span>
              </div>

              <div className="compare-models-grid">
                {models.map((model) => {
                  const isSelected = selectedModelIds.includes(model.id);
                  const isDegraded = model.availabilityStatus === 'degraded';
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`compare-model-chip ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleToggleModel(model.id)}
                    >
                      <div className="compare-model-chip-name">{model.name || model.id}</div>
                      <span className="compare-model-provider-badge">
                        {model.provider}
                        {isDegraded ? ' (degraded)' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Options */}
            <div className="compare-options-row">
              <label className="compare-toggle-label">
                <input
                  type="checkbox"
                  checked={blindMode}
                  onChange={(e) => setBlindMode(e.target.checked)}
                />
                <span>{idID.compare.blindMode}</span>
              </label>

              <label className="compare-toggle-label">
                <input
                  type="checkbox"
                  checked={requestSynthesis}
                  onChange={(e) => setRequestSynthesis(e.target.checked)}
                />
                <span>{idID.compare.requestSynthesis}</span>
              </label>
            </div>

            {/* Form Footer */}
            <div className="compare-form-footer">
              <span className="compare-form-hint">
                {canSubmit
                  ? 'Permintaan akan dijalankan secara paralel tanpa fallback.'
                  : idID.compare.startCompareDisabledReason}
              </span>

              <button
                type="submit"
                className="ui-btn ui-btn-primary ui-btn-md"
                disabled={!canSubmit}
              >
                <span>{idID.compare.startCompare}</span>
              </button>
            </div>
          </form>
        )}
      </main>

      {/* Right History Sidebar */}
      <CompareSidebar
        history={compareHistory}
        activeRunId={activeCompareId}
        onSelectRun={(id) => void openCompare(id)}
        onDeleteRun={handleDeleteRun}
      />
    </div>
  );
};
