import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

export interface ToolStepData {
  id: string;
  stepNumber: number;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  diff?: string | undefined;
  path?: string | undefined;
  details?: string | Record<string, unknown> | undefined;
}

interface ToolStepCardProps {
  step: ToolStepData;
}

export const ToolStepCard: React.FC<ToolStepCardProps> = ({ step }) => {
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

  const formattedDetails =
    typeof step.details === 'object' && step.details !== null
      ? JSON.stringify(step.details, null, 2)
      : String(step.details ?? '');

  return (
    <div className="tool-step-card" aria-label={`Langkah ${step.stepNumber}: ${step.toolName}`}>
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
          <Terminal size={14} color="var(--accent-cyan)" />
          <span className="tool-step-title">
            {idID.chat.toolStep.title} #{step.stepNumber}: {step.toolName}
          </span>
          <span className="tool-step-summary">
            — {step.summary}
          </span>
        </div>

        <div className="tool-step-header-right">
          {getStatusIcon()}
          <span className="tool-step-status-text">{getStatusLabel()}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {expanded && (
        <div className="tool-step-content">
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
          {formattedDetails ? (
            <pre className="tool-step-pre-wrap">
              {formattedDetails}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
};
