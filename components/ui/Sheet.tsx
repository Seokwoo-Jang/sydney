'use client';
// One detail/edit surface: bottom sheet below 1024px, right panel from 1024px
// (CSS only, so the same instance survives a resize).
//
// A plain overlay rendered into <body>, not a native <dialog>: iPhone Safari left
// the page unresponsive after showModal() (owner report, 2026-11-01). The modal
// behaviour is done here instead: role="dialog" + aria-modal, the rest of the
// page made inert while open, Esc and backdrop close, focus moved in and back to
// the opener, and the page behind kept from scrolling.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { S } from '@/lib/strings';
import { IconButton } from './Button';
import styles from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Optional line under the title. */
  description?: ReactNode;
  /** `wide`: large PC panel (journal). `full`: full-screen on mobile, wide panel on PC.
   *  `center`: bottom sheet on mobile, a centred card on PC (How to Use). */
  size?: 'default' | 'wide' | 'full' | 'center';
  /** Sticky footer (save/cancel) that stays reachable above the keyboard. */
  footer?: ReactNode;
  /** Header slot next to the close button (e.g. SaveStatus). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

// Open sheets, newest last: only the top one reacts to Esc, and the page stays
// locked until the last one closes.
const stack: HTMLElement[] = [];

function lockPage(layer: HTMLElement): () => void {
  stack.push(layer);
  document.documentElement.classList.add('sheet-open');
  // Everything else in <body> (the app and any sheet underneath) becomes inert.
  const others = Array.from(document.body.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== layer && !el.hasAttribute('inert'),
  );
  others.forEach((el) => el.setAttribute('inert', ''));
  return () => {
    others.forEach((el) => el.removeAttribute('inert'));
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) document.documentElement.classList.remove('sheet-open');
  };
}

export function Sheet({ open, onClose, title, description, size = 'default', footer, headerExtra, children }: SheetProps) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const descId = useId();

  // One container per open sheet, appended to <body> so no page layout can clip it.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = document.createElement('div');
    el.className = styles.host;
    document.body.appendChild(el);
    setLayer(el);
    const unlock = lockPage(el);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === el) {
        e.preventDefault();
        closeRef.current(); // the parent decides (it may guard unsaved changes)
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
      el.remove();
      setLayer(null);
      const back = opener.current;
      opener.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [open]);

  // Move focus into the sheet once it is on screen (the close button, like a native modal).
  useEffect(() => {
    if (!layer) return;
    const panel = panelRef.current;
    if (panel?.contains(document.activeElement)) return; // a field with autoFocus already has it
    const first = panel?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea');
    (first ?? panel)?.focus({ preventScroll: true });
  }, [layer]);

  if (!open || !layer) return null;

  return createPortal(
    <div className={[styles.layer, size === 'center' ? styles.layerCenter : ''].join(' ')}>
      <div className={styles.backdrop} aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={[styles.dialog, styles[size]].join(' ')}
      >
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
            <IconButton icon="close" label={S.actions.close} onClick={() => closeRef.current()} />
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      </div>
    </div>,
    layer,
  );
}
