'use client';
// A day's theme title ("A New Chapter") with Rename (owner, 2026-11-01). One
// field of the day row, so a rename in the Itinerary shows in the Journal and
// the other way round. A rename made elsewhere meanwhile is never overwritten.
import { useState, type ElementType } from 'react';
import { Button, IconButton, TextInput, useToast } from '@/components/ui';
import { useDays } from '@/lib/data';
import { S } from '@/lib/strings';
import type { TripDay } from '@/lib/types';
import styles from './DayTitle.module.css';

export function DayTitle({ day, as: Tag = 'p', className }: { day: TripDay; as?: ElementType; className?: string }) {
  const days = useDays();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const title = (draft ?? '').trim();
    if (!title || title === day.title) return setDraft(null);
    setBusy(true);
    let r = await days.update(day.id, { title }, day.version);
    // The day row also holds its cover: retry on the latest one while its title is still ours to change.
    if (!r.ok && r.reason === 'conflict' && r.latest && r.latest.title === day.title) r = await days.update(day.id, { title }, r.latest.version);
    setBusy(false);
    if (r.ok) {
      setDraft(null);
      toast.show(S.sync.saved);
    } else toast.show(r.reason === 'conflict' ? S.sync.conflict : S.sync.failed, { tone: 'error' });
  };

  if (draft === null) {
    return (
      <span className={styles.row}>
        <Tag className={className}>{day.title}</Tag>
        <IconButton icon="edit" label={S.itinerary.renameDay(day.dayNumber)} className={styles.edit} onClick={() => setDraft(day.title)} />
      </span>
    );
  }
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TextInput
        aria-label={S.itinerary.dayTitleLabel(day.dayNumber)}
        value={draft}
        autoFocus
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      <Button type="submit" variant="primary" size="sm" busy={busy} disabled={!draft.trim()}>
        {S.actions.save}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
        {S.actions.cancel}
      </Button>
    </form>
  );
}
