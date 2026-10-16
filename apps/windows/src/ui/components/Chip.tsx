import React from 'react';
import { X } from 'lucide-react';
import './Components.css';

export interface ChipProps {
  label: React.ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  variant = 'default',
  icon,
  onRemove,
  className = '',
}) => {
  const classes = [
    'ui-chip',
    variant !== 'default' ? `ui-chip-${variant}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {icon}
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          className="ui-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Hapus chip"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
};
