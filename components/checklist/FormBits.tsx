'use client';
// Small form pieces shared by the Checklist, Budget, Library and Journal sheets.
import { useEffect, useState, type ReactNode } from 'react';
import { Button, ConflictNotice } from '@/components/ui';
import type { Member } from '@/lib/types';
import { S } from '@/lib/strings';
import { conflictSource } from './useSaveFlow';
import styles from './Form.module.css';

/** Checkbox with its label inside one 44px target. */
export function CheckField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.checkField}>
      <label className={styles.checkLabel}>
        <input type="checkbox" className={styles.box} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

/** Two-step delete: the first press asks, the second deletes (soft delete). */
export function ConfirmDelete({ onConfirm, busy }: { onConfirm: () => void; busy?: boolean }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 6000);
    return () => window.clearTimeout(t);
  }, [asking]);
  if (!asking)
    return (
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)} className={styles.deleteButton}>
        {S.actions.delete}
      </Button>
    );
  return (
    <span className={styles.confirm} role="group" aria-label={S.checklist.deleteConfirm}>
      <span className={styles.confirmText}>{S.checklist.deleteConfirm}</span>
      <Button variant="danger" size="sm" busy={busy} onClick={onConfirm}>
        {S.actions.delete}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        {S.actions.cancel}
      </Button>
    </span>
  );
}

/**
 * Version conflict: names who saved first, keeps the draft. "Review latest"
 * shows the saved version next to the draft and rebases, so the next save
 * applies the draft on top of it.
 */
export function ConflictBlock<T extends { updatedBy: string | null; version: number }>({
  latest,
  me,
  partner,
  onRebase,
  renderLatest,
  onUseLatest,
}: {
  latest: T | null;
  me: Member | null;
  partner: Member | null;
  onRebase: (latest: T) => void;
  renderLatest?: (latest: T) => ReactNode;
  onUseLatest?: (latest: T) => void;
}) {
  const [reviewed, setReviewed] = useState<T | null>(null);
  if (reviewed) {
    return (
      <div className={styles.latest} role="region" aria-label={S.journal.latestVersion}>
        <p className={styles.latestLabel}>{S.journal.latestVersion}</p>
        {renderLatest?.(reviewed)}
        {onUseLatest && (
          <Button variant="secondary" size="sm" onClick={() => onUseLatest(reviewed)}>
            {S.journal.useLatest}
          </Button>
        )}
      </div>
    );
  }
  return (
    <ConflictNotice
      source={conflictSource(latest?.updatedBy, me?.id)}
      partnerName={partner?.displayName}
      onReview={() => {
        if (!latest) return;
        onRebase(latest);
        setReviewed(latest);
      }}
    />
  );
}
