import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  ArrowLeft,
  Plus,
  AlertCircle,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../context.ts';
import { idID } from '../locales/id-ID.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Button } from '../components/Button.tsx';
import { PlanReviewCard } from './PlanReviewCard.tsx';
import { ProgressTimeline } from './ProgressTimeline.tsx';
import { ResearchReportViewer } from './ResearchReportViewer.tsx';
import { ResearchSidebar } from './ResearchSidebar.tsx';
import './ResearchView.css';

interface ResearchViewProps {
  onNavigateToChat?: () => void;
}

export const ResearchView: React.FC<ResearchViewProps> = ({ onNavigateToChat }) => {
  const {
    activeResearchState,
    researchHistory,
    researchDepth,
    setResearchDepth,
    fetchResearchConfig,
    startResearch,
    openResearch,
    closeActiveResearch,
    refreshResearchHistory,
    approveResearchPlan,
    cancelResearch,
    deleteResearch,
    isLoadingResearch,
  } = useAgentStore();

  const [queryInput, setQueryInput] = useState('');
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null);

  useEffect(() => {
    void fetchResearchConfig();
    void refreshResearchHistory();
  }, [fetchResearchConfig, refreshResearchHistory]);

  const handleStartNew = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!queryInput.trim() || isLoadingResearch) return;
    const q = queryInput.trim();
    setQueryInput('');
    try {
      await startResearch(q, researchDepth);
    } catch {
      // Error handled in store
    }
  };

  const handleConfirmOpenUrl = async () => {
    if (!pendingExternalUrl) return;
    const url = pendingExternalUrl;
    setPendingExternalUrl(null);
    try {
      await invoke('open_external_url', { url });
    } catch {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const state = activeResearchState;

  return (
    <div className="research-layout-container">
      {/* Center Main Area */}
      <main className="research-main-content">
        {/* Research View Header Bar */}
        <header className="research-view-header">
          <div className="research-header-left">
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

            <div className="research-title-group">
              <div className="research-title-row">
                <BookOpen size={18} color="var(--accent-cyan)" />
                <h1 className="research-header-title">
                  {state ? state.query : idID.research.title}
                </h1>
              </div>
              <p className="research-header-desc">{idID.research.subtitle}</p>
            </div>
          </div>

          <div className="research-header-right">
            {state && (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                onClick={closeActiveResearch}
              >
                <Plus size={13} />
                <span>{idID.research.newResearch}</span>
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Center Body based on Active Research State */}
        {!state ? (
          /* Empty / New Research Starter Screen */
          <div className="research-starter-card">
            <div className="starter-icon-wrap">
              <Sparkles size={28} color="var(--accent-cyan)" />
            </div>

            <h2 className="starter-title">Mulai Riset Baru</h2>
            <p className="starter-desc">
              Masukkan topik riset investigatif Anda. Sistem akan memecah kueri, mengumpulkan sumber dari internet, dan menyusun laporan faktual dengan sitasi bernomor.
            </p>

            <form onSubmit={handleStartNew} className="starter-form">
              <input
                type="text"
                className="ui-input starter-query-input"
                placeholder="Tulis topik atau pertanyaan riset mendalam..."
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                disabled={isLoadingResearch}
                aria-label="Topik Riset"
              />

              <div className="starter-depth-section">
                <span className="depth-label">{idID.research.depth.label}</span>
                <div className="depth-chips-row" role="radiogroup" aria-label={idID.research.depth.label}>
                  <button
                    type="button"
                    className={`depth-chip-btn ${researchDepth === 'quick' ? 'active' : ''}`}
                    onClick={() => setResearchDepth('quick')}
                    role="radio"
                    aria-checked={researchDepth === 'quick'}
                  >
                    <strong>{idID.research.depth.quick}</strong>
                    <span className="depth-chip-meta">{idID.research.depth.quickDesc}</span>
                  </button>

                  <button
                    type="button"
                    className={`depth-chip-btn ${researchDepth === 'standard' ? 'active' : ''}`}
                    onClick={() => setResearchDepth('standard')}
                    role="radio"
                    aria-checked={researchDepth === 'standard'}
                  >
                    <strong>{idID.research.depth.standard}</strong>
                    <span className="depth-chip-meta">{idID.research.depth.standardDesc}</span>
                  </button>

                  <button
                    type="button"
                    className={`depth-chip-btn ${researchDepth === 'deep' ? 'active' : ''}`}
                    onClick={() => setResearchDepth('deep')}
                    role="radio"
                    aria-checked={researchDepth === 'deep'}
                  >
                    <strong>{idID.research.depth.deep}</strong>
                    <span className="depth-chip-meta">{idID.research.depth.deepDesc}</span>
                  </button>
                </div>
              </div>

              <div className="starter-actions">
                <button
                  type="submit"
                  className="ui-btn ui-btn-primary ui-btn-md starter-submit-btn"
                  disabled={!queryInput.trim() || isLoadingResearch}
                >
                  <Sparkles size={15} />
                  <span>{isLoadingResearch ? 'Menyiapkan...' : 'Mulai Investigasi'}</span>
                </button>
              </div>
            </form>
          </div>
        ) : state.status === 'waiting_plan_approval' ? (
          /* Plan Review Approval Stage */
          <PlanReviewCard
            initialSubQuestions={state.subQuestions}
            onApproveAndStart={(subQuestions) =>
              approveResearchPlan(state.runId, { subQuestions })
            }
            onCancel={() => cancelResearch(state.runId)}
            isLoading={isLoadingResearch}
          />
        ) : state.status === 'running' || state.status === 'planning' || state.status === 'queued' ? (
          /* Live Progress Timeline Stage */
          <ProgressTimeline
            subQuestions={state.subQuestions}
            budgetConfig={state.budgetConfig}
            budgetUsed={state.budgetUsed}
            sources={state.sources}
            onCancel={() => cancelResearch(state.runId)}
            isStopping={isLoadingResearch}
          />
        ) : state.status === 'completed' && state.report ? (
          /* Completed Report Viewer Stage */
          <ResearchReportViewer
            report={state.report}
            sources={state.sources}
            evidence={state.evidence}
            onOpenExternalLink={(url) => setPendingExternalUrl(url)}
          />
        ) : state.status === 'cancelled' ? (
          /* Cancelled State */
          <div className="research-error-card cancelled" role="alert">
            <div className="error-card-header">
              <Clock size={18} color="var(--accent-amber)" />
              <h3>{idID.research.status.cancelled}</h3>
            </div>
            <p>{idID.research.errors.cancelledByUser}</p>
            {state.report && (
              <div className="partial-report-section">
                <div className="partial-report-banner">Laporan Parsial Sebelum Dibatalkan</div>
                <ResearchReportViewer
                  report={state.report}
                  sources={state.sources}
                  evidence={state.evidence}
                  onOpenExternalLink={(url) => setPendingExternalUrl(url)}
                />
              </div>
            )}
          </div>
        ) : (
          /* Failed / Error State */
          <div className="research-error-card failed" role="alert">
            <div className="error-card-header">
              <AlertCircle size={18} color="var(--accent-rose)" />
              <h3>{idID.research.status.failed}</h3>
            </div>
            <p>{state.error || idID.research.errors.genericError}</p>
            {state.report && (
              <div className="partial-report-section">
                <div className="partial-report-banner">Laporan Parsial yang Berhasil Disintesis</div>
                <ResearchReportViewer
                  report={state.report}
                  sources={state.sources}
                  evidence={state.evidence}
                  onOpenExternalLink={(url) => setPendingExternalUrl(url)}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Side Panel: Sources & History */}
      <ResearchSidebar
        sources={state ? state.sources : []}
        history={researchHistory}
        activeRunId={state ? state.runId : null}
        onOpenResearch={(id) => void openResearch(id)}
        onDeleteResearch={(id) => void deleteResearch(id)}
        onOpenExternalLink={(url) => setPendingExternalUrl(url)}
      />

      {/* External Link Open Confirmation Dialog */}
      <Dialog
        isOpen={Boolean(pendingExternalUrl)}
        onClose={() => setPendingExternalUrl(null)}
        title={idID.research.report.openExternalConfirmation}
      >
        <div className="external-link-dialog-body">
          <div className="dialog-warning-icon">
            <ShieldAlert size={24} color="var(--accent-amber)" />
          </div>
          <p className="dialog-warning-text">{idID.research.report.openExternalWarning}</p>
          <code className="dialog-url-preview">{pendingExternalUrl}</code>
          <div className="dialog-actions-row">
            <Button variant="ghost" onClick={() => setPendingExternalUrl(null)}>
              {idID.research.report.cancelOpen}
            </Button>
            <Button variant="primary" onClick={() => void handleConfirmOpenUrl()}>
              <ExternalLink size={14} />
              <span>{idID.research.report.confirmOpen}</span>
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
