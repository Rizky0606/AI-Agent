import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, CheckCircle2, AlertCircle, Clock, XCircle, ListTodo, GitFork } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

export interface ToolStepData {
  id: string;
  stepNumber: number;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  diff?: string | undefined;
  path?: string | undefined;
  details?: unknown | undefined;
  runtime?: string | undefined;
  timestamp?: string | undefined;
  isPlan?: boolean | undefined;
  planItems?: string[] | undefined;
  isSubagent?: boolean | undefined;
  subagentTask?: string | undefined;
}

interface ToolStepCardProps {
  step: ToolStepData;
  onStop?: (() => void) | undefined;
}

export const ToolStepCard: React.FC<ToolStepCardProps> = ({ step, onStop }) => {
  const [expanded, setExpanded] = useState(false);

  const getStatusIcon = () => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle2 size={14} color="var(--accent-emerald)" />;
      case 'failed':
        return <AlertCircle size={14} color="var(--accent-rose)" />;
      case 'running':
      default:
        return <Clock size={14} color="var(--accent-cyan)" className="animate-spin" />;
    }
  };

  const getStatusLabel = () => {
    switch (step.status) {
      case 'completed':
        return idID.chat.toolStep.completed;
      case 'failed':
        return idID.chat.toolStep.failed;
      case 'running':
      default:
        return idID.chat.toolStep.running;
    }
  };

  const getStepIcon = () => {
    if (step.isPlan) {
      return <ListTodo size={14} color="var(--accent-mint)" />;
    }
    if (step.isSubagent) {
      return <GitFork size={14} color="var(--accent-teal)" />;
    }
    return <Terminal size={14} color="var(--accent-cyan)" />;
  };

  const formattedDetails =
    typeof step.details === 'object' && step.details !== null
      ? JSON.stringify(step.details, null, 2)
      : String(step.details ?? '');

  const isOneShotRuntime = step.runtime === 'omp' || step.runtime === 'hermes';

  return (
    <div
      className={`tool-step-card ${step.isPlan ? 'tool-step-card-plan' : ''} ${step.isSubagent ? 'tool-step-card-subagent' : ''}`}
      aria-label={`Langkah ${step.stepNumber}: ${step.toolName}`}
    >
      <div
        className="tool-step-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="tool-step-header-left">
          {getStepIcon()}
          <span className="tool-step-title">
            {step.isPlan ? idID.chat.toolStep.planTitle : `${idID.chat.toolStep.title} #${step.stepNumber}: ${step.toolName}`}
          </span>
          {step.isSubagent && (
            <span className="task-subagent-pill">
              {idID.chat.toolStep.subagentBadge}
            </span>
          )}
          {step.runtime && (
            <span className="task-runtime-pill">
              {step.runtime}
            </span>
          )}
          <span className="tool-step-summary">
            — {step.summary}
          </span>
        </div>

        <div className="tool-step-header-right">
          {onStop && step.status === 'running' && (
            <button
              type="button"
              className="ui-btn ui-btn-danger ui-btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              title="Hentikan Langkah Ini"
            >
              <XCircle size={12} />
              <span>Stop</span>
            </button>
          )}
          {getStatusIcon()}
          <span className="tool-step-status-text">{getStatusLabel()}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {expanded && (
        <div className="tool-step-content">
          {step.isPlan && step.planItems && step.planItems.length > 0 && (
            <div className="tool-step-plan-box">
              <div className="tool-step-plan-title">{idID.chat.toolStep.planSteps}</div>
              <ol className="tool-step-plan-list">
                {step.planItems.map((item, idx) => (
                  <li key={idx} className="tool-step-plan-item">{item}</li>
                ))}
              </ol>
            </div>
          )}

          {step.diff && (
            <div className="tool-step-diff-box">
              {step.path && <div className="tool-step-diff-path">File: {step.path}</div>}
              <pre className="tool-step-pre">
                {step.diff.split('\n').map((line, idx) => {
                  let lineClass = '';
                  if (line.startsWith('+')) lineClass = 'diff-line-add';
                  else if (line.startsWith('-')) lineClass = 'diff-line-del';
                  else if (line.startsWith('@@')) lineClass = 'diff-line-hunk';
                  return <div key={idx} className={lineClass}>{line}</div>;
                })}
              </pre>
            </div>
          )}

          {formattedDetails && !step.planItems ? (
            <pre className="tool-step-pre-wrap">
              {formattedDetails}
            </pre>
          ) : null}

          {isOneShotRuntime && (
            <div className="tool-step-oneshot-note">
              {idID.chat.toolStep.oneShotNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
