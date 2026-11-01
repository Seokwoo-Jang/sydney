'use client';
// Small form pieces shared by the Checklist, Budget, Library and Journal sheets.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ConflictNotice, IconButton } from '@/components/ui';
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

/**
 * Two-step delete: the first press asks, the second deletes (soft delete).
 * Focus moves into the question (so it is read out) and back to the trigger
 * on Cancel; the question gives up after 6 s, but not while focus is on it.
 */
export function ConfirmDelete({
  onConfirm,
  busy,
  label = S.actions.delete,
  question = S.checklist.deleteConfirm,
}: {
  onConfirm: () => void;
  busy?: boolean;
  label?: string;
  question?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [back, setBack] = useState(false);
  const group = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!asking) return;
    const t = window.setInterval(() => {
      if (!group.current?.contains(document.activeElement)) setAsking(false);
    }, 6000);
    return () => window.clearInterval(t);
  }, [asking]);
  if (!asking)
    return (
      <Button
        variant="ghost"
        size="sm"
        autoFocus={back}
        onClick={() => {
          setBack(false);
          setAsking(true);
        }}
        className={styles.deleteButton}
      >
        {label}
      </Button>
    );
  return (
    <span ref={group} className={styles.confirm} role="group" aria-label={question}>
      <span className={styles.confirmText}>{question}</span>
      <Button variant="danger" size="sm" busy={busy} autoFocus onClick={onConfirm}>
        {label}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setBack(true);
          setAsking(false);
        }}
      >
        {S.actions.cancel}
      </Button>
    </span>
  );
}

/** Close guard for unsaved input: stands in for the sheet footer until the user chooses. */
export function ConfirmDiscard({
  question = S.itinerary.discardConfirm,
  onKeep,
  onDiscard,
}: {
  question?: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className={styles.footer} role="group" aria-label={question}>
      <span className={styles.confirmText}>{question}</span>
      <div className={styles.footerEnd}>
        <Button variant="ghost" autoFocus onClick={onKeep}>
          {S.actions.keepEditing}
        </Button>
        <Button variant="danger" onClick={onDiscard}>
          {S.itinerary.discard}
        </Button>
      </div>
    </div>
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

/** Chosen links (bookings, plans, Library entries), each with a remove button; gone records are skipped. */
export function PickedList({
  ids,
  label,
  removeLabel,
  onRemove,
}: {
  ids: string[];
  label: (id: string) => string | null;
  removeLabel: (text: string) => string;
  onRemove: (id: string) => void;
}) {
  const shown = ids.map((id) => ({ id, text: label(id) })).filter((x): x is { id: string; text: string } => !!x.text);
  if (!shown.length) return null;
  return (
    <ul className={styles.pickList}>
      {shown.map((x) => (
        <li key={x.id} className={styles.pickItem}>
          <span className={styles.pickTitle}>{x.text}</span>
          <IconButton icon="close" label={removeLabel(x.text)} onClick={() => onRemove(x.id)} />
        </li>
      ))}
    </ul>
  );
}
