import React from 'react';
import type { TaskRecord } from '@personal-ai-os/shared';
import type { TaskEventEntry } from '../../state/agent-store.ts';
import { Play, Pause, XCircle } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

interface TaskCardProps {
  task: TaskRecord;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
  events?: TaskEventEntry[] | undefined;
  onPause?: ((taskId: string) => Promise<void>) | undefined;
  onResume?: ((taskId: string) => Promise<void>) | undefined;
  onCancel?: ((taskId: string) => Promise<void>) | undefined;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  isSelected,
  onSelect,
  events,
  onPause,
  onResume,
  onCancel,
}) => {
  return (
    <div
      onClick={() => onSelect(task.id)}
      className={`activity-card clickable ${isSelected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
    >
      <div className="card-header-row">
        <strong className="card-title-text">{task.kind}</strong>
        <span className={`status-pill ${task.status}`}>{task.status}</span>
      </div>

      <div className="card-meta-row">
        <span>ID: <code>{task.id.slice(0, 8)}</code></span>
        {task.progress != null && <span>{task.progress}%</span>}
        {Boolean(task.payload?.runtime || task.payload?.selectedRuntimeId) && (
          <span style={{ fontSize: 11, color: 'var(--accent-cyan, #06b6d4)', fontWeight: 500 }}>
            Runtime: {String(task.payload?.runtime || task.payload?.selectedRuntimeId)}
          </span>
        )}
      </div>

      {task.payload?.runtimeFallback === true && (
        <div
          className="task-fallback-banner"
          style={{
            marginTop: '8px',
            marginBottom: '8px',
            padding: '6px 10px',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '6px',
            color: '#f59e0b',
            fontSize: '12px',
            lineHeight: 1.4,
          }}
        >
          <strong>Pengalihan Runtime:</strong> {String(task.payload.fallbackReason || `Dialihkan dari ${task.payload.originalRuntimeId}`)}
        </div>
      )}

      {task.checkpoint && (
        <div className="card-meta-row">
          <span>{idID.activity.tasks.checkpointLabel}</span>
          <span className="card-title-text">
            {task.checkpoint.lastExecutedAction} ({task.checkpoint.stepIndex}/{task.checkpoint.totalSteps})
          </span>
        </div>
      )}

      {task.status === 'failed' && task.error && (
        <div
          className="task-error-banner"
          style={{
            marginTop: '8px',
            marginBottom: '8px',
            padding: '6px 10px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            color: '#f87171',
            fontSize: '12px',
            lineHeight: 1.4,
          }}
        >
          <strong>Keterangan Masalah:</strong> {task.error}
        </div>
      )}

      {/* Task Controls */}
      <div className="card-header-row" onClick={(e) => e.stopPropagation()}>
        <div className="chat-error-actions">
          {task.status === 'running' && onPause && task.payload?.supportsPause === true && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={() => void onPause(task.id)}
              title="Jeda"
            >
              <Pause size={12} />
              <span>Jeda</span>
            </button>
          )}

          {task.status === 'paused' && onResume && task.payload?.supportsPause === true && (
            <button
              type="button"
              className="ui-btn ui-btn-primary ui-btn-sm"
              onClick={() => void onResume(task.id)}
              title="Lanjutkan"
            >
              <Play size={12} />
              <span>Lanjutkan</span>
            </button>
          )}

          {(task.status === 'running' || task.status === 'paused' || task.status === 'waiting_approval') && onCancel && (
            <button
              type="button"
              className="ui-btn ui-btn-danger ui-btn-sm"
              onClick={() => void onCancel(task.id)}
              title="Hentikan / Batalkan"
            >
              <XCircle size={12} />
              <span>Hentikan</span>
            </button>
          )}
        </div>
      </div>

      {/* Event Stream (Expanded when selected) */}
      {isSelected && events && events.length > 0 && (
        <div className="settings-form-group" style={{ marginTop: 12 }}>
          <span className="settings-label">{idID.activity.tasks.eventStreamLabel}</span>
          <div className="task-timeline-container" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {events.map((ev, i) => {
              const payload = (ev.payload ?? {}) as Record<string, unknown>;
              const isDiff = Boolean(payload.diff);
              return (
                <div
                  key={ev.id || i}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-sub, rgba(255,255,255,0.08))',
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontWeight: 600 }}>
                    <span>
                      #{i + 1} {ev.eventType}
                      {payload.action ? ` (${String(payload.action)})` : ''}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-sub)' }}>
                      {ev.createdAt ? new Date(ev.createdAt).toLocaleTimeString() : ''}
                    </span>
                  </div>
                  {payload.text ? (
                    <div style={{ color: 'var(--text-main)', whiteSpace: 'pre-wrap', marginBottom: 4 }}>
                      {String(payload.text)}
                    </div>
                  ) : null}
                  {isDiff ? (
                    <div style={{ marginTop: 4, padding: 6, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, overflowX: 'auto' }}>
                      {payload.path ? <div style={{ color: 'var(--accent-cyan)', marginBottom: 2 }}>{String(payload.path)}</div> : null}
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {String(payload.diff).split('\n').map((line, lIdx) => {
                          let color = 'inherit';
                          if (line.startsWith('+')) color = 'var(--accent-emerald, #10b981)';
                          else if (line.startsWith('-')) color = 'var(--accent-rose, #ef4444)';
                          else if (line.startsWith('@@')) color = 'var(--accent-cyan, #06b6d4)';
                          return <div key={lIdx} style={{ color }}>{line}</div>;
                        })}
                      </pre>
                    </div>
                  ) : null}
                  {!payload.text && !isDiff ? (
                    <pre style={{ margin: 0, fontSize: 11, color: 'var(--text-sub)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(payload)}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
