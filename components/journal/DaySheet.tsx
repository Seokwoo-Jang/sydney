'use client';
// One day of Nine Notes (plan §7.6): collage + two notes. Mobile full screen,
// PC wide panel (Sheet size "full").
import { Button, Sheet, useToast } from '@/components/ui';
import { useDays } from '@/lib/data';
import type { FileAsset, JournalEntry, Member, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { defaultDayPhoto } from '@/lib/url';
import { AddPhotos } from './AddPhotos';
import { Collage } from './Collage';
import { NoteEditor, type NoteDraft } from './NoteEditor';
import { Photo } from './Photo';
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
  onAdjust,
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
  onAdjust: (asset: FileAsset) => void;
  onClose: () => void;
}) {
  const days = useDays();
  const toast = useToast();
  const cover = day ? (photos.find((p) => p.id === day.coverAssetId) ?? photos[0] ?? null) : null;

  const shuffle = async () => {
    if (!day) return;
    const r = await days.update(day.id, { collageVariant: day.collageVariant + 1 }, day.version);
    if (!r.ok) toast.show(r.reason === 'conflict' ? S.sync.conflict : S.sync.failed, { tone: 'error' });
  };

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
          <section className={styles.photos} aria-label={S.journal.photos}>
            {photos.length ? (
              <Collage photos={photos} variant={day.collageVariant} dayNumber={day.dayNumber} />
            ) : (
              fallback && (
                <div className={styles.fallback}>
                  <span className={styles.fallbackFrame}>
                    <Photo
                      photo={{ src: fallback.src, thumb: fallback.thumb, width: fallback.width, height: fallback.height, focalX: 0.5, focalY: 0.4, zoom: 1 }}
                      alt=""
                      sizes="240px"
                      className={styles.shotImg}
                    />
                  </span>
                  <p className={styles.sampleNote}>{S.journal.noPhotos}</p>
                </div>
              )
            )}
            <div className={styles.photoActions}>
              {photos.length > 1 && (
                <Button variant="secondary" size="sm" iconStart="refresh" onClick={shuffle}>
                  {S.journal.shuffle}
                </Button>
              )}
              {cover && (
                <Button variant="secondary" size="sm" iconStart="image" onClick={() => onAdjust(cover)}>
                  {S.journal.adjust}
                </Button>
              )}
            </div>
            <AddPhotos day={day} photos={photos} />
          </section>
          <div className={styles.notes}>
            {editor(me, S.people.myNotes, S.journal.promptMine, focusMine)}
            {partner && editor(partner, S.people.notesOf(partner.displayName), S.journal.promptPartner, false)}
          </div>
        </div>
      )}
    </Sheet>
  );
}
