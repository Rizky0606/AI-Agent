import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { TaskCard } from './TaskCard.tsx';
import { ApprovalCard } from './ApprovalCard.tsx';
import { ArtifactCard } from './ArtifactCard.tsx';
import { idID } from '../locales/id-ID.ts';

export type ActivitySubTab = 'tasks' | 'approvals' | 'artifacts';

interface ActivityPanelProps {
  onNewApprovalDetected?: (action: string) => void;
}

export const ActivityPanel: React.FC<ActivityPanelProps> = ({
  onNewApprovalDetected,
}) => {
  const {
    serverTasks,
    refreshServerTasks,
    selectedTaskId,
    selectServerTask,
    pauseServerTask,
    resumeServerTask,
    cancelServerTask,
    taskEvents,
    approvals,
    refreshApprovals,
    decideApproval,
    artifacts,
    refreshArtifacts,
    openArtifact,
    closeArtifactPreview,
    artifactPreview,
  } = useAgentStore();

  const [activeTab, setActiveTab] = useState<ActivitySubTab>('approvals');
  const [previousPendingCount, setPreviousPendingCount] = useState(0);

  const pendingApprovals = approvals.filter((item) => item.status === 'pending');
  const pendingCount = pendingApprovals.length;

  // Detect new pending approvals and trigger callback
  useEffect(() => {
    if (pendingCount > previousPendingCount && onNewApprovalDetected) {
      const latest = pendingApprovals[pendingApprovals.length - 1];
      if (latest) {
        onNewApprovalDetected(latest.action);
      }
    }
    setPreviousPendingCount(pendingCount);
  }, [pendingCount, previousPendingCount, pendingApprovals, onNewApprovalDetected]);

  return (
    <div className="activity-container">
      {/* Sub-tab navigation */}
      <nav className="activity-subtabs-nav" role="tablist" aria-label="Kategori Aktivitas">
        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'approvals' ? 'active' : ''}`}
          onClick={() => setActiveTab('approvals')}
          role="tab"
          aria-selected={activeTab === 'approvals'}
        >
          <span>{idID.activity.tabs.approvals}</span>
          {pendingCount > 0 && (
            <span className="activity-badge">{pendingCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
          role="tab"
          aria-selected={activeTab === 'tasks'}
        >
          <span>{idID.activity.tabs.tasks}</span>
          <span className="conversation-item-meta">({serverTasks.length})</span>
        </button>

        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'artifacts' ? 'active' : ''}`}
          onClick={() => setActiveTab('artifacts')}
          role="tab"
          aria-selected={activeTab === 'artifacts'}
        >
          <span>{idID.activity.tabs.artifacts}</span>
          <span className="conversation-item-meta">({artifacts.length})</span>
        </button>
      </nav>

      {/* Tab 1: Approvals */}
      {activeTab === 'approvals' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {pendingCount > 0
                ? `${pendingCount} persetujuan menunggu keputusan Anda.`
                : 'Semua persetujuan telah diselesaikan.'}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void refreshApprovals()}
              title={idID.activity.tasks.refresh}
            >
              <RefreshCw size={12} />
              <span>{idID.activity.tasks.refresh}</span>
            </button>
          </div>

          {approvals.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.approvals.empty}
            </div>
          ) : (
            approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onDecide={async (id, decision, reason) => {
                  await decideApproval(id, decision, reason);
                }}
              />
            ))
          )}
        </div>
      )}

      {/* Tab 2: Tasks */}
      {activeTab === 'tasks' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {serverTasks.length} tugas terdaftar.
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void refreshServerTasks()}
              title={idID.activity.tasks.refresh}
            >
              <RefreshCw size={12} />
              <span>{idID.activity.tasks.refresh}</span>
            </button>
          </div>

          {serverTasks.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.tasks.empty}
            </div>
          ) : (
            serverTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isSelected={task.id === selectedTaskId}
                events={task.id === selectedTaskId ? taskEvents : undefined}
                onSelect={(id) => void selectServerTask(id)}
                onPause={pauseServerTask}
                onResume={resumeServerTask}
                onCancel={cancelServerTask}
              />
            ))
          )}
        </div>
      )}

      {/* Tab 3: Artifacts */}
      {activeTab === 'artifacts' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {artifacts.length} berkas artefak tersimpan.
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void refreshArtifacts()}
              title={idID.activity.tasks.refresh}
            >
              <RefreshCw size={12} />
              <span>{idID.activity.tasks.refresh}</span>
            </button>
          </div>

          {/* Artifact Preview Card */}
          {artifactPreview ? (
            <div className="activity-card">
              <div className="card-header-row">
                <strong className="card-title-text">{idID.activity.artifacts.preview}</strong>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-btn-sm"
                  onClick={closeArtifactPreview}
                >
                  {idID.activity.artifacts.closePreview}
                </button>
              </div>

              {artifactPreview.truncated && (
                <span className="settings-hint text-amber">
                  {idID.activity.artifacts.truncatedNotice}
                </span>
              )}

              <pre className="task-events-box">
                {artifactPreview.content}
              </pre>
            </div>
          ) : null}

          {artifacts.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.artifacts.empty}
            </div>
          ) : (
            artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onPreview={(id) => void openArtifact(id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
