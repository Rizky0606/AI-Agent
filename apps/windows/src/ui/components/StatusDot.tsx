import React from 'react';
import './Components.css';

export type StatusDotKind = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export interface StatusDotProps {
  status: StatusDotKind;
  pulse?: boolean;
  label?: React.ReactNode;
  className?: string;
}

const statusDescriptions: Record<StatusDotKind, string> = {
  connected: 'Terhubung',
  connecting: 'Menghubungkan',
  disconnected: 'Terputus',
  reconnecting: 'Menghubungkan ulang',
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  pulse = false,
  label,
  className = '',
}) => {
  const dotClasses = [
    'ui-status-dot',
    `ui-status-dot-${status}`,
    pulse ? 'ui-status-dot-pulse' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const title = statusDescriptions[status] ?? status;

  return (
    <span className="ui-status-wrapper" title={title}>
      <span className={dotClasses} role="status" aria-label={title} />
      {label && <span className="ui-status-label">{label}</span>}
    </span>
  );
};
