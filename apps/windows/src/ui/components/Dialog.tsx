import React, { createContext, useContext, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';
import './Components.css';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
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
      className="ui-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`ui-dialog-card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Kotak dialog'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-dialog-header">
          <div className="ui-dialog-title">{title}</div>
          <IconButton
            aria-label="Tutup dialog"
            icon={<X size={18} />}
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="ui-dialog-body">
          {children}
        </div>
        {footer && (
          <div className="ui-dialog-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/* Confirmation Dialog Hook as replacement for window.confirm */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
}

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = (options: ConfirmOptions | string): Promise<boolean> => {
    const normalized: ConfirmOptions =
      typeof options === 'string'
        ? { message: options, title: 'Konfirmasi Tindakan' }
        : { title: 'Konfirmasi Tindakan', ...options };

    return new Promise<boolean>((resolve) => {
      setState({
        ...normalized,
        isOpen: true,
        resolve,
      });
    });
  };

  const handleClose = (value: boolean) => {
    if (state) {
      state.resolve(value);
      setState(null);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <Dialog
          isOpen={state.isOpen}
          onClose={() => handleClose(false)}
          title={state.title}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => handleClose(false)}
              >
                {state.cancelLabel ?? 'Batal'}
              </Button>
              <Button
                variant={state.variant === 'danger' ? 'danger' : 'primary'}
                onClick={() => handleClose(true)}
              >
                {state.confirmLabel ?? 'Konfirmasi'}
              </Button>
            </>
          }
        >
          <p>{state.message}</p>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ((options: ConfirmOptions | string) => Promise<boolean>) => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Graceful fallback for tests or environments without provider
    return (options) => {
      const msg = typeof options === 'string' ? options : `${options.title ? options.title + '\n\n' : ''}${options.message}`;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return Promise.resolve(window.confirm(msg));
      }
      return Promise.resolve(true);
    };
  }
  return ctx.confirm;
};
