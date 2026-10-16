import React, { useEffect, useRef, useState } from 'react';
import './Components.css';

export interface PopoverProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  placement?: 'bottom' | 'top';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export const Popover: React.FC<PopoverProps> = ({
  trigger,
  content,
  placement = 'bottom',
  open: controlledOpen,
  onOpenChange,
  className = '',
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const wrapperRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  const close = () => {
    if (!isControlled) {
      setInternalOpen(false);
    }
    onOpenChange?.(false);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const contentClasses = [
    'ui-popover-content',
    `ui-popover-${placement}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="ui-popover-wrapper" ref={wrapperRef}>
      <div onClick={toggle} role="button" tabIndex={0} onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }} aria-haspopup="dialog" aria-expanded={isOpen}>
        {trigger}
      </div>
      {isOpen && (
        <div className={contentClasses} role="dialog" aria-modal="false">
          {content}
        </div>
      )}
    </div>
  );
};
