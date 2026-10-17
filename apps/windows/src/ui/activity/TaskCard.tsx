import React from 'react';
import { aggregateRuntimeSteps, type TaskRecord } from '@personal-ai-os/shared';
import type { TaskEventEntry } from '../../state/agent-store.ts';
import { Play, Pause, XCircle } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';
import { ToolStepCard } from '../chat/ToolStepCard.tsx';

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
          <span className="task-runtime-pill">
            Runtime: {String(task.payload?.runtime || task.payload?.selectedRuntimeId)}
          </span>
        )}
      </div>

      {task.payload?.runtimeFallback === true && (
        <div className="task-fallback-banner">
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
        <div className="task-error-banner">
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
        <div className="settings-form-group task-events-group">
          <span className="settings-label">{idID.activity.tasks.eventStreamLabel}</span>
          <div className="task-timeline-container">
            {(() => {
              const formattedEvents = events.map((ev, idx) => ({
                id: ev.id || `ev-${idx}`,
                taskId: task.id,
                eventType: ev.eventType,
                payload: (ev.payload ?? {}) as Record<string, unknown>,
                createdAt: ev.createdAt ?? new Date().toISOString(),
              }));
              const steps = aggregateRuntimeSteps(formattedEvents);
              if (steps.length > 0) {
                return steps.map((step) => (
                  <ToolStepCard
                    key={step.id}
                    step={step}
                    onStop={task.status === 'running' && onCancel ? () => void onCancel(task.id) : undefined}
                  />
                ));
              }
              return events.map((ev, i) => {
                const payload = (ev.payload ?? {}) as Record<string, unknown>;
                const isDiff = Boolean(payload.diff);
                return (
                  <div key={ev.id || i} className="task-event-card">
                    <div className="task-event-header-row">
                      <span>
                        #{i + 1} {ev.eventType}
                        {payload.action ? ` (${String(payload.action)})` : ''}
                      </span>
                      <span className="task-event-time">
                        {ev.createdAt ? new Date(ev.createdAt).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    {payload.text ? (
                      <div className="task-event-text">
                        {String(payload.text)}
                      </div>
                    ) : null}
                    {isDiff ? (
                      <div className="task-event-diff-box">
                        {payload.path ? <div className="task-event-diff-path">{String(payload.path)}</div> : null}
                        <pre className="tool-step-pre">
                          {String(payload.diff).split('\n').map((line, lIdx) => {
                            let lineClass = '';
                            if (line.startsWith('+')) lineClass = 'diff-line-add';
                            else if (line.startsWith('-')) lineClass = 'diff-line-del';
                            else if (line.startsWith('@@')) lineClass = 'diff-line-hunk';
                            return <div key={lIdx} className={lineClass}>{line}</div>;
                          })}
                        </pre>
                      </div>
                    ) : null}
                    {!payload.text && !isDiff ? (
                      <pre className="task-event-raw-json">
                        {JSON.stringify(payload)}
                      </pre>
                    ) : null}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
