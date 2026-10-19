import React from 'react';
import { Columns2, Trash2, Trophy } from 'lucide-react';
import type { CompareRunSummary } from '@personal-ai-os/shared';
import { idID } from '../locales/id-ID.ts';

interface CompareSidebarProps {
  history: CompareRunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onDeleteRun: (id: string, e: React.MouseEvent) => void;
}

export const CompareSidebar: React.FC<CompareSidebarProps> = ({
  history,
  activeRunId,
  onSelectRun,
  onDeleteRun,
}) => {
  return (
    <aside className="compare-sidebar" aria-label={idID.compare.historyTitle}>
      <div className="compare-sidebar-header">
        <span>{idID.compare.historyTitle}</span>
      </div>

      <div className="compare-history-list" role="list">
        {history.length === 0 ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {idID.compare.historyEmpty}
          </div>
        ) : (
          history.map((item) => {
            const isActive = item.id === activeRunId;
            return (
              <button
                key={item.id}
                type="button"
                className={`compare-history-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectRun(item.id)}
                role="listitem"
              >
                <div className="compare-history-prompt">{item.prompt}</div>
                <div className="compare-history-meta">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Columns2 size={11} />
                    {item.modelIds.length} model
                    {item.winnerModelId && (
                      <Trophy size={11} color="#f59e0b" style={{ marginLeft: 2 }} />
                    )}
                  </span>

                  <button
                    type="button"
                    className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-xs"
                    onClick={(e) => onDeleteRun(item.id, e)}
                    title="Hapus dari riwayat"
                    aria-label="Hapus dari riwayat"
                    style={{ opacity: 0.6 }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
