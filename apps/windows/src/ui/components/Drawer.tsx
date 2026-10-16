import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton.tsx';
import './Components.css';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className = '',
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="ui-drawer-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`ui-drawer-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Panel samping'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-drawer-header">
          {typeof title === 'string' ? <h3>{title}</h3> : (title || <div />)}
          <IconButton
            aria-label="Tutup panel"
            icon={<X size={18} />}
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="ui-drawer-body">
          {children}
        </div>
        {footer && (
          <div className="ui-drawer-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
