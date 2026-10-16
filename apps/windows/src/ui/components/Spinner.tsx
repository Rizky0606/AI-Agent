import React from 'react';
import './Components.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label = 'Memuat...',
  className = '',
}) => {
  return (
    <span
      role="status"
      className={`ui-spinner ui-spinner-${size} ${className}`.trim()}
    >
      <span className="ui-sr-only">{label}</span>
    </span>
  );
};
