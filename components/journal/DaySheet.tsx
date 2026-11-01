'use client';
// One day of Nine Notes (plan §7.6): photos with their notes + two day notes.
// Mobile full screen, PC wide panel (Sheet size "full"). Edit on a photo opens
// PhotoSheet on top (note, day cover, delete).
import { useEffect, useRef, useState } from 'react';
import { Sheet, useToast } from '@/components/ui';
import type { FileAsset, JournalEntry, Member, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { defaultDayPhoto } from '@/lib/url';
import { AddPhotos } from './AddPhotos';
import { NoteEditor, type NoteDraft } from './NoteEditor';
import { Photo } from './Photo';
import { PhotoPages } from './PhotoPages';
import { PhotoSheet } from './PhotoSheet';
import styles from './Journal.module.css';

export function DaySheet({
  open,
  day,
  photos,
  entries,
  me,
  partner,
  members,
  drafts,
  focusMine,
  onDraft,
  onClose,
}: {
  open: boolean;
  day: TripDay | null;
  photos: FileAsset[];
  entries: JournalEntry[];
  me: Member | null;
  partner: Member | null;
  members: Member[];
  drafts: Record<string, NoteDraft>;
  focusMine: boolean;
  onDraft: (key: string, d: NoteDraft | null) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [editId, setEditId] = useState<string | null>(null);
  if (!open && editId) setEditId(null); // a closed day never reopens on a photo
  const cover = day ? (photos.find((p) => p.id === day.coverAssetId) ?? photos[0] ?? null) : null;
  const editing = photos.find((p) => p.id === editId) ?? null;

  // Toasts live in the page this sheet makes inert, so screen readers would
  // miss them: results are said again in here, a moment later, once a sheet
  // on top has closed and this one is live again.
  const [said, setSaid] = useState('');
  const notify = (message: string) => {
    toast.show(message);
    setSaid('');
    window.setTimeout(() => setSaid(message), 150);
  };

  // A deleted photo takes its Edit button with it: focus goes to the next
  // photo's Edit ('' = Add photos) once the photo sheet has closed.
  const photoBox = useRef<HTMLElement>(null);
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (target === null || editing) return;
    refocus.current = null;
    photoBox.current?.querySelector<HTMLElement>(target ? `[data-edit="${target}"]` : '[data-add-photos]')?.focus();
  });

  const editor = (author: Member | null, heading: string, prompt: string, autoFocus: boolean) => {
    if (!day || !author) return null;
    const key = `${day.id}:${author.id}`;
    const entry = entries.find((e) => e.dayId === day.id && e.authorId === author.id) ?? null;
    return (
      <NoteEditor
        key={key}
        dayId={day.id}
        author={author}
        entry={entry}
        heading={heading}
        prompt={prompt}
        draft={drafts[key]}
        me={me}
        partner={partner}
        members={members}
        autoFocus={autoFocus}
        onDraft={(d) => onDraft(key, d)}
      />
    );
  };

  const fallback = day ? defaultDayPhoto(day.dayNumber) : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title={day ? S.journal.dayTitle(day.dayNumber, day.title) : ''}
      description={day ? formatDayLabel(day.date) : undefined}
    >
      {day && (
        <div className={styles.spread}>
          <section ref={photoBox} className={styles.photos} aria-label={S.journal.photos}>
            {photos.length ? (
              <PhotoPages photos={photos} dayNumber={day.dayNumber} coverId={cover?.id ?? null} onEdit={(a) => setEditId(a.id)} />
            ) : (
              fallback && (
                <div className={styles.fallback}>
                  <span className={styles.fallbackFrame}>
                    <Photo photo={fallback} alt="" sizes="240px" className={styles.fallbackImg} />
                  </span>
                  <p className={styles.sampleNote}>{S.journal.noPhotos}</p>
                </div>
              )
            )}
            <div className={styles.photoActions}>
              <AddPhotos day={day} photos={photos} notify={notify} />
            </div>
            <p className="sr-only" role="status">
              {said}
            </p>
          </section>
          <div className={styles.notes}>
            {editor(me, S.people.myNotes, S.journal.promptMine, focusMine)}
            {partner && editor(partner, S.people.notesOf(partner.displayName), S.journal.promptPartner, false)}
          </div>
        </div>
      )}
      {day && editing && (
        <PhotoSheet
          key={editing.id}
          asset={editing}
          index={photos.indexOf(editing) + 1}
          day={day}
          coverId={cover?.id ?? null}
          me={me}
          partner={partner}
          onDeleted={() => {
            const rest = photos.filter((p) => p.id !== editing.id);
            refocus.current = rest[Math.min(photos.indexOf(editing), rest.length - 1)]?.id ?? '';
            notify(S.journal.photoDeleted);
          }}
          onClose={() => setEditId(null)}
        />
      )}
    </Sheet>
  );
}
