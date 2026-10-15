import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

export interface ToolStepData {
  id: string;
  stepNumber: number;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  details?: string | Record<string, unknown>;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={14} color="var(--accent-cyan)" />
          <span style={{ fontWeight: 600 }}>
            {idID.chat.toolStep.title} #{step.stepNumber}: {step.toolName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-sub)', fontWeight: 400 }}>
            — {step.summary}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {getStatusIcon()}
          <span style={{ fontSize: 11 }}>{getStatusLabel()}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {expanded && formattedDetails && (
        <div className="tool-step-content">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {formattedDetails}
          </pre>
        </div>
      )}
    </div>
  );
};
