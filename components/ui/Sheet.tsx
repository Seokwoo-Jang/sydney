'use client';
// One detail/edit surface: bottom sheet below 1024px, right panel from 1024px
// (CSS only, so the same instance survives a resize). Native modal <dialog>
// gives aria-modal, an inert background (focus trap) and Esc; focus returns to
// the opener on close.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { S } from '@/lib/strings';
import { IconButton } from './Button';
import styles from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Optional line under the title. */
  description?: ReactNode;
  /** `wide`: large PC panel (journal). `full`: full-screen on mobile, wide panel on PC. */
  size?: 'default' | 'wide' | 'full';
  /** Sticky footer (save/cancel) that stays reachable above the keyboard. */
  footer?: ReactNode;
  /** Header slot next to the close button (e.g. SaveStatus). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, description, size = 'default', footer, headerExtra, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    if (open) return;
    const el = opener.current;
    if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    opener.current = null;
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={[styles.dialog, styles[size]].join(' ')}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault(); // parent decides (it may guard unsaved changes)
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop
      }}
    >
      {open && (
        <div className={styles.panel}>
          <header className={styles.header}>
            <div className={styles.headings}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {description && (
                <p id={descId} className={styles.description}>
                  {description}
                </p>
              )}
            </div>
            {headerExtra}
            <IconButton icon="close" label={S.actions.close} onClick={onClose} />
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
