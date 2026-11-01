'use client';
// Transient messages in one polite live region. The shell mounts the provider;
// sections call useToast().show(...).
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { S } from '@/lib/strings';
import { IconButton } from './Button';
import styles from './Toast.module.css';

export interface ToastOptions {
  tone?: 'default' | 'error';
  action?: { label: string; onClick: () => void };
  /** ms; default 4000. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

interface ToastApi {
  show(message: string, options?: ToastOptions): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider is missing.');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-2), { id, message, ...options }]);
      window.setTimeout(() => dismiss(id), options.duration ?? 4000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite" aria-label={S.ui.notifications}>
        {items.map((t) => (
          <div key={t.id} className={[styles.toast, t.tone === 'error' ? styles.error : ''].join(' ')}>
            <span className={styles.message}>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <IconButton icon="close" label={S.actions.dismiss} variant="onDark" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
