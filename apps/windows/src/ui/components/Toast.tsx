import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import './Components.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  durationMs?: number;
}

interface ToastContextValue {
  show: (type: ToastType, message: string, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  warning: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type: ToastType, message: string, durationMs = 4000) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ToastItem = { id, type, message, durationMs };
      setToasts((prev) => [...prev, item]);

      if (durationMs > 0) {
        setTimeout(() => {
          dismiss(id);
        }, durationMs);
      }
    },
    [dismiss],
  );

  const success = useCallback((msg: string, d?: number) => show('success', msg, d), [show]);
  const error = useCallback((msg: string, d?: number) => show('error', msg, d), [show]);
  const warning = useCallback((msg: string, d?: number) => show('warning', msg, d), [show]);
  const info = useCallback((msg: string, d?: number) => show('info', msg, d), [show]);

  const renderIcon = (type: ToastType) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={18} aria-hidden="true" />;
      case 'error':
        return <AlertCircle size={18} aria-hidden="true" />;
      case 'warning':
        return <AlertTriangle size={18} aria-hidden="true" />;
      case 'info':
      default:
        return <Info size={18} aria-hidden="true" />;
    }
  };

  return (
    <ToastContext.Provider value={{ show, success, error, warning, info, dismiss }}>
      {children}
      <div className="ui-toast-container" role="region" aria-label="Notifikasi">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`ui-toast-item ui-toast-${toast.type}`}
            role="status"
          >
            {renderIcon(toast.type)}
            <span className="ui-toast-text">{toast.message}</span>
            <button
              type="button"
              className="ui-chip-remove"
              onClick={() => dismiss(toast.id)}
              aria-label="Tutup notifikasi"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback if rendered outside provider
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
      dismiss: () => {},
    };
  }
  return ctx;
};
