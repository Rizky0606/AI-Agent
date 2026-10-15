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
      </div>

      {task.checkpoint && (
        <div className="card-meta-row">
          <span>{idID.activity.tasks.checkpointLabel}</span>
          <span className="card-title-text">
            {task.checkpoint.lastExecutedAction} ({task.checkpoint.stepIndex}/{task.checkpoint.totalSteps})
          </span>
        </div>
      )}

      {/* Task Controls */}
      <div className="card-header-row" onClick={(e) => e.stopPropagation()}>
        <div className="chat-error-actions">
          {task.status === 'running' && onPause && (
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

          {task.status === 'paused' && onResume && (
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

          {(task.status === 'running' || task.status === 'paused') && onCancel && (
            <button
              type="button"
              className="ui-btn ui-btn-danger ui-btn-sm"
              onClick={() => void onCancel(task.id)}
              title="Batalkan"
            >
              <XCircle size={12} />
              <span>Batal</span>
            </button>
          )}
        </div>
      </div>

      {/* Event Stream (Expanded when selected) */}
      {isSelected && events && events.length > 0 && (
        <div className="settings-form-group">
          <span className="settings-label">{idID.activity.tasks.eventStreamLabel}</span>
          <pre className="task-events-box">
            {events.map((ev, i) => `[${i + 1}] ${JSON.stringify(ev)}`).join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
};
