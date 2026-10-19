import React from 'react';
import {
  Clock,
  Search,
  BookOpen,
  Sparkles,
  CheckCircle2,
  Square,
  Globe,
  Flame,
} from 'lucide-react';
import type {
  ResearchBudgetConfig,
  ResearchBudgetUsed,
  ResearchSourceItem,
  ResearchSubQuestionState,
  SubQuestionStatus,
} from '@personal-ai-os/shared';
import { idID } from '../locales/id-ID.ts';

interface ProgressTimelineProps {
  subQuestions: ResearchSubQuestionState[];
  budgetConfig: ResearchBudgetConfig;
  budgetUsed: ResearchBudgetUsed;
  sources: ResearchSourceItem[];
  onCancel: () => void;
  isStopping?: boolean;
}

const getStatusBadge = (status: SubQuestionStatus) => {
  switch (status) {
    case 'waiting':
      return {
        label: idID.research.timeline.waiting,
        icon: <Clock size={13} />,
        className: 'status-waiting',
      };
    case 'searching':
      return {
        label: idID.research.timeline.searching,
        icon: <Search size={13} className="spin-slow" />,
        className: 'status-searching',
      };
    case 'reading':
      return {
        label: idID.research.timeline.reading,
        icon: <BookOpen size={13} />,
        className: 'status-reading',
      };
    case 'extracting':
      return {
        label: idID.research.timeline.extracting,
        icon: <Sparkles size={13} />,
        className: 'status-extracting',
      };
    case 'completed':
      return {
        label: idID.research.timeline.completed,
        icon: <CheckCircle2 size={13} />,
        className: 'status-completed',
      };
  }
};

export const ProgressTimeline: React.FC<ProgressTimelineProps> = ({
  subQuestions,
  budgetConfig,
  budgetUsed,
  sources,
  onCancel,
  isStopping = false,
}) => {
  const searchPercent = Math.min(
    100,
    Math.round((budgetUsed.searchesCount / (budgetConfig.maxSearches || 1)) * 100),
  );
  const pagePercent = Math.min(
    100,
    Math.round((budgetUsed.pagesReadCount / (budgetConfig.maxPagesRead || 1)) * 100),
  );

  return (
    <div className="research-timeline-wrapper" role="region" aria-label={idID.research.timeline.title}>
      {/* Budget Counters Bar */}
      <div className="research-budget-counters-card">
        <div className="budget-counter-item">
          <div className="budget-counter-header">
            <span className="budget-counter-label">{idID.research.budgetCounters.searches}</span>
            <span className="budget-counter-value">
              {budgetUsed.searchesCount} / {budgetConfig.maxSearches}
            </span>
          </div>
          <div className="budget-progress-bar">
            <div className="budget-progress-fill cyan" style={{ width: `${searchPercent}%` }} />
          </div>
        </div>

        <div className="budget-counter-item">
          <div className="budget-counter-header">
            <span className="budget-counter-label">{idID.research.budgetCounters.pages}</span>
            <span className="budget-counter-value">
              {budgetUsed.pagesReadCount} / {budgetConfig.maxPagesRead}
            </span>
          </div>
          <div className="budget-progress-bar">
            <div className="budget-progress-fill blue" style={{ width: `${pagePercent}%` }} />
          </div>
        </div>

        <div className="budget-counter-item">
          <div className="budget-counter-header">
            <span className="budget-counter-label">{idID.research.budgetCounters.duration}</span>
            <span className="budget-counter-value">
              {Math.round(budgetUsed.durationMs / 1000)} dtk
            </span>
          </div>
          <div className="budget-counter-meta">
            Maks: {Math.round(budgetConfig.maxDurationMs / 1000)} dtk
          </div>
        </div>

        <div className="budget-counter-action">
          <button
            type="button"
            className="ui-btn ui-btn-danger ui-btn-sm research-stop-btn"
            onClick={onCancel}
            disabled={isStopping}
          >
            <Square size={13} fill="currentColor" />
            <span>{isStopping ? idID.research.timeline.stopping : idID.research.timeline.stop}</span>
          </button>
        </div>
      </div>

      {/* Sub-Questions Timeline */}
      <div className="research-timeline-card">
        <h3 className="research-timeline-title">
          <Flame size={16} color="var(--accent-amber)" />
          <span>{idID.research.timeline.title}</span>
        </h3>

        <div className="research-timeline-list">
          {subQuestions.length === 0 ? (
            <div className="research-timeline-empty">
              <Clock size={16} className="spin-slow" />
              <span>Menyiapkan rencana investigasi...</span>
            </div>
          ) : (
            subQuestions.map((sq, index) => {
              const badge = getStatusBadge(sq.status);
              return (
                <div key={sq.id} className={`timeline-item ${badge.className}`}>
                  <div className="timeline-item-indicator">
                    <div className="timeline-node">{badge.icon}</div>
                    {index < subQuestions.length - 1 && <div className="timeline-line" />}
                  </div>
                  <div className="timeline-item-content">
                    <div className="timeline-item-top">
                      <span className="timeline-sq-title">{sq.question}</span>
                      <span className={`timeline-badge ${badge.className}`}>{badge.label}</span>
                    </div>
                    {sq.searchQueries && sq.searchQueries.length > 0 && (
                      <div className="timeline-sq-queries">
                        <span className="queries-label">Kueri:</span>
                        {sq.searchQueries.map((q, i) => (
                          <span key={i} className="query-chip">
                            {q}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Live Discovered Sources Strip */}
      {sources.length > 0 && (
        <div className="research-sources-strip">
          <div className="sources-strip-header">
            <Globe size={14} color="var(--accent-cyan)" />
            <span>
              {idID.research.report.sourcesTitle} Terkumpul ({sources.length})
            </span>
          </div>
          <div className="sources-badges-row">
            {sources.map((s) => (
              <div key={s.id} className="source-domain-badge" title={`${s.title} (${s.url})`}>
                <span className="domain-initials">{s.initials}</span>
                <span className="domain-name">{s.domain}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
