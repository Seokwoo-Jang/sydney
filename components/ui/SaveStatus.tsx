// Sync feedback with the same words and position everywhere (plan §5.4, §8.2).
import { S } from '@/lib/strings';
import { Button } from './Button';
import { Icon } from './Icon';
import styles from './SaveStatus.module.css';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'reconnecting' | 'error';

const TEXT: Record<Exclude<SaveState, 'idle'>, string> = {
  dirty: S.sync.unsaved,
  saving: S.sync.saving,
  saved: S.sync.saved,
  reconnecting: S.sync.reconnecting,
  error: S.sync.failed,
};

/** Show `saved` only after the repository returned ok. */
export function SaveStatus({ state, className }: { state: SaveState; className?: string }) {
  return (
    <span className={[styles.status, styles[state], className ?? ''].join(' ')} role="status" aria-live="polite">
      {state !== 'idle' && (
        <>
          {state === 'saved' && <Icon name="check" size={14} />}
          {state === 'reconnecting' && <Icon name="refresh" size={14} />}
          {TEXT[state]}
        </>
      )}
    </span>
  );
}

export interface ConflictNoticeProps {
  /** `ownDevice`: the same profile saved first on another device. */
  source: 'partner' | 'ownDevice';
  /** Partner display name, e.g. 'Amy'. */
  partnerName?: string;
  /** Load the latest version into view (the form keeps the user's draft). */
  onReview: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ConflictNotice({ source, partnerName, onReview, onDismiss, className }: ConflictNoticeProps) {
  const text =
    source === 'ownDevice'
      ? S.sync.conflictOwnDevice
      : [partnerName ? S.sync.conflictBy(partnerName) : '', S.sync.conflict].filter(Boolean).join(' ');
  return (
    <div className={[styles.conflict, className ?? ''].join(' ')} role="alert">
      <p className={styles.conflictText}>{text}</p>
      <div className={styles.conflictActions}>
        <Button variant="primary" size="sm" onClick={onReview}>
          {S.actions.reviewLatest}
        </Button>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {S.actions.keepEditing}
          </Button>
        )}
      </div>
    </div>
  );
}
