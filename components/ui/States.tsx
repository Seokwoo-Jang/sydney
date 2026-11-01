import type { ReactNode } from 'react';
import { S } from '@/lib/strings';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import styles from './States.module.css';

export interface EmptyStateProps {
  /** Short line, e.g. S.empty.day */
  title: ReactNode;
  /** One action, e.g. S.empty.dayAction */
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
  compact?: boolean;
  className?: string;
}

/** Plan §5.4: every empty view has a short line and one action. */
export function EmptyState({ title, actionLabel, onAction, icon, compact, className }: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.compact : '', className ?? ''].join(' ')}>
      {icon && (
        <span className={styles.emptyIcon}>
          <Icon name={icon} size={22} />
        </span>
      )}
      <p className={styles.emptyTitle}>{title}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" iconStart="plus" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export interface LoadingStateProps {
  /** list: rows; cards: 3-up tiles; block: one tall card */
  variant?: 'list' | 'cards' | 'block';
  rows?: number;
  className?: string;
}

/** Skeleton placeholder. Announces "Loading…" once to screen readers. */
export function LoadingState({ variant = 'list', rows = 3, className }: LoadingStateProps) {
  return (
    <div className={[styles.loading, styles[variant], className ?? ''].join(' ')} role="status" aria-busy="true">
      <span className="sr-only">{S.data.loading}</span>
      {Array.from({ length: variant === 'block' ? 1 : rows }, (_, i) => (
        <span key={i} className={styles.bone} aria-hidden="true" />
      ))}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra actions (e.g. Leave). */
  children?: ReactNode;
  className?: string;
}

export function ErrorState({ title, message = S.data.loadFailed, onRetry, retryLabel = S.actions.retry, children, className }: ErrorStateProps) {
  return (
    <div className={[styles.error, className ?? ''].join(' ')} role="alert">
      {title && <p className={styles.errorTitle}>{title}</p>}
      <p className={styles.errorMessage}>{message}</p>
      {(onRetry || children) && (
        <div className={styles.errorActions}>
          {onRetry && (
            <Button variant="secondary" size="sm" iconStart="refresh" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
