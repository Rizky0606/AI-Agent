import React, { useState } from 'react';
import {
  Globe,
  History,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import type {
  ResearchRunSummary,
  ResearchSourceItem,
} from '@personal-ai-os/shared';
import { idID } from '../locales/id-ID.ts';

interface ResearchSidebarProps {
  sources: ResearchSourceItem[];
  history: ResearchRunSummary[];
  activeRunId: string | null;
  onOpenResearch: (id: string) => void;
  onDeleteResearch: (id: string) => void;
  onOpenExternalLink: (url: string) => void;
}

export const ResearchSidebar: React.FC<ResearchSidebarProps> = ({
  sources,
  history,
  activeRunId,
  onOpenResearch,
  onDeleteResearch,
  onOpenExternalLink,
}) => {
  const [activeTab, setActiveTab] = useState<'sources' | 'history'>('sources');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="history-status-pill completed">{idID.research.status.completed}</span>;
      case 'running':
        return <span className="history-status-pill running">{idID.research.status.running}</span>;
      case 'waiting_plan_approval':
        return <span className="history-status-pill waiting">{idID.research.status.waiting_plan_approval}</span>;
      case 'cancelled':
        return <span className="history-status-pill cancelled">{idID.research.status.cancelled}</span>;
      default:
        return <span className="history-status-pill failed">{idID.research.status.failed}</span>;
    }
  };

  const getDepthLabel = (depth: string) => {
    switch (depth) {
      case 'quick':
        return idID.research.depth.quick;
      case 'deep':
        return idID.research.depth.deep;
      default:
        return idID.research.depth.standard;
    }
  };

  return (
    <aside className="research-sidebar" role="complementary" aria-label="Panel Samping Riset">
      {/* Sidebar Tabs */}
      <div className="research-sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'sources' ? 'active' : ''}`}
          onClick={() => setActiveTab('sources')}
          aria-selected={activeTab === 'sources'}
        >
          <Globe size={14} />
          <span>{idID.research.report.sourcesTitle} ({sources.length})</span>
        </button>

        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
          aria-selected={activeTab === 'history'}
        >
          <History size={14} />
          <span>{idID.research.history.title} ({history.length})</span>
        </button>
      </div>

      <div className="research-sidebar-body">
        {activeTab === 'sources' && (
          <div className="sources-list-container">
            {sources.length === 0 ? (
              <div className="sidebar-empty-state">
                <Globe size={24} color="var(--text-muted)" />
                <p>Belum ada sumber rujukan yang dikumpulkan.</p>
              </div>
            ) : (
              sources.map((s, index) => (
                <div key={s.id || index} className="source-item-card">
                  <div className="source-item-top">
                    <span className="source-item-badge">[src-{index + 1}]</span>
                    <span className="source-domain-initials">{s.initials}</span>
                    <span className="source-domain-text">{s.domain}</span>
                  </div>

                  <h4 className="source-item-title">{s.title}</h4>

                  {s.snippet && <p className="source-item-snippet">{s.snippet}</p>}

                  <div className="source-item-footer">
                    <div className="source-credibility">
                      <ShieldCheck size={12} color="var(--accent-emerald)" />
                      <span>{Math.round(s.credibilityScore * 100)}%</span>
                    </div>

                    <button
                      type="button"
                      className="source-open-link-btn"
                      onClick={() => onOpenExternalLink(s.url)}
                      title="Buka sumber asli di peramban"
                      aria-label={`Buka sumber ${s.title}`}
                    >
                      <span>Buka</span>
                      <ExternalLink size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="history-list-container">
            {history.length === 0 ? (
              <div className="sidebar-empty-state">
                <History size={24} color="var(--text-muted)" />
                <p>{idID.research.history.empty}</p>
              </div>
            ) : (
              history.map((h) => {
                const isActive = h.id === activeRunId;
                const dateStr = new Date(h.createdAt).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={h.id}
                    className={`history-item-card ${isActive ? 'active' : ''}`}
                    onClick={() => onOpenResearch(h.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Buka riset: ${h.query}`}
                  >
                    <div className="history-item-header">
                      <span className="history-depth-badge">{getDepthLabel(h.depth)}</span>
                      {getStatusBadge(h.status)}
                    </div>

                    <div className="history-item-query">{h.query}</div>

                    <div className="history-item-footer">
                      <div className="history-date">
                        <Calendar size={11} />
                        <span>{dateStr}</span>
                      </div>

                      <button
                        type="button"
                        className="history-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(idID.research.history.deleteConfirm)) {
                            onDeleteResearch(h.id);
                          }
                        }}
                        title={idID.research.history.deleteAction}
                        aria-label={`Hapus riset ${h.query}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
