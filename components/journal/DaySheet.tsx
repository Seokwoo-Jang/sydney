'use client';
// One day of Nine Notes (plan §7.6): the day's photos, each with our comments
// (one each, marked E / A). Either of us adds photos, sets the cover, reorders
// and deletes; each comment is its writer's to edit.
// Mobile full screen, PC wide panel (Sheet size "full"). Edit on a photo opens
// PhotoSheet on top (text, day cover, delete).
import { useEffect, useRef, useState } from 'react';
import { Button, Sheet, useToast } from '@/components/ui';
import { useAssets } from '@/lib/data';
import type { FileAsset, JournalEntry, Member, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { defaultDayPhoto } from '@/lib/url';
import { AddPhotos } from './AddPhotos';
import { Photo } from './Photo';
import { PhotoPages } from './PhotoPages';
import { PhotoSheet } from './PhotoSheet';
import { moveWrites, withWrites, type OrderWrite } from './photoOrder';
import styles from './Journal.module.css';

export function DaySheet({
  open,
  day,
  photos,
  comments,
  me,
  partner,
  members,
  startAdding = false,
  onClose,
}: {
  open: boolean;
  day: TripDay | null;
  photos: FileAsset[];
  /** Live comments by photo id, oldest first. */
  comments: Map<string, JournalEntry[]>;
  me: Member | null;
  partner: Member | null;
  members: Member[];
  /** Opened from the empty state's Add a photo: focus starts on Add photos. */
  startAdding?: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const assets = useAssets();
  const [editId, setEditId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  if (!open && editId) setEditId(null); // a closed day never reopens on a photo
  if ((!open || photos.length < 2) && reordering) setReordering(false);
  const cover = day ? (photos.find((p) => p.id === day.coverAssetId) ?? photos[0] ?? null) : null;
  const editing = photos.find((p) => p.id === editId) ?? null;

  // Toasts live in the page this sheet makes inert, so screen readers would
  // miss them: results are said again in here, a moment later, once a sheet
  // on top has closed and this one is live again.
  const [said, setSaid] = useState('');
  const say = (message: string) => {
    setSaid('');
    window.setTimeout(() => setSaid(message), 150);
  };
  const notify = (message: string, tone?: 'error') => {
    toast.show(message, tone ? { tone } : undefined);
    say(message);
  };

  // A deleted photo takes its Edit button with it: focus goes to the next
  // photo's Edit ('' = Add photos) once the photo sheet has closed.
  const photoBox = useRef<HTMLElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (target === null || editing) return;
    refocus.current = null;
    (target ? photoBox.current?.querySelector<HTMLElement>(`[data-edit="${target}"]`) : actions.current?.querySelector<HTMLElement>('[data-add-photos]'))?.focus();
  });

  // A moved photo's list item changes place, which can drop focus: it goes
  // back to the same arrow, or the other one once the photo reached an end.
  const moved = useRef<{ id: string; dir: -1 | 1 } | null>(null);
  useEffect(() => {
    const m = moved.current;
    const box = photoBox.current;
    if (!m || !box) return;
    moved.current = null;
    const same = box.querySelector<HTMLButtonElement>(`[data-move="${m.id}:${m.dir}"]`);
    (same && !same.disabled ? same : box.querySelector<HTMLButtonElement>(`[data-move="${m.id}:${-m.dir}"]`))?.focus();
  });

  // One move at a time: each write needs the version the list showed. While
  // the writes go out the list shows where they lead; if one fails, it shows
  // whatever order the server now has.
  const [pending, setPending] = useState<OrderWrite[] | null>(null);
  const shown = pending ? withWrites(photos, pending) : photos;
  const moving = useRef(false);
  const move = async (index: number, dir: -1 | 1) => {
    const writes = moveWrites(photos, index, dir);
    if (moving.current || !writes.length) return;
    moving.current = true;
    const id = photos[index].id;
    const versions = new Map(photos.map((p) => [p.id, p.version]));
    moved.current = { id, dir };
    setPending(writes);
    let failed: string | null = null;
    for (const w of writes) {
      const r = await assets.update(w.id, { sortOrder: w.sortOrder }, versions.get(w.id)!);
      if (!r.ok) {
        failed = r.reason === 'conflict' ? S.sync.conflict : S.sync.failed;
        break;
      }
      versions.set(w.id, r.row.version); // a renumbered pair is written again
    }
    moving.current = false;
    setPending(null);
    if (failed) {
      moved.current = { id, dir }; // the photo may jump back: its arrow keeps focus
      notify(failed, 'error');
    } else say(S.journal.moved(index + dir + 1, photos.length));
  };

  const fallback = day ? defaultDayPhoto(day.dayNumber) : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title={day ? S.journal.dayTitle(day.dayNumber, day.title) : ''}
      description={day ? formatDayLabel(day.date) : undefined}
      footer={
        day ? (
          <div ref={actions} className={styles.dayActions}>
            <div className={styles.photoActions}>
              <AddPhotos day={day} photos={photos} me={me} notify={notify} autoFocus={startAdding} />
            </div>
            {photos.length > 1 && (
              <Button variant={reordering ? 'primary' : 'secondary'} size="sm" onClick={() => setReordering((r) => !r)}>
                {reordering ? S.journal.reorderDone : S.journal.reorder}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {day && (
        <section ref={photoBox} className={styles.photos} aria-label={S.journal.photos}>
          {reordering && <p className={styles.hint}>{S.journal.reorderHint}</p>}
          {photos.length ? (
            <PhotoPages
              photos={shown}
              comments={comments}
              dayNumber={day.dayNumber}
              coverId={cover?.id ?? null}
              members={members}
              reordering={reordering}
              onEdit={(a) => setEditId(a.id)}
              onMove={(i, dir) => void move(i, dir)}
            />
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
          <p className="sr-only" role="status">
            {said}
          </p>
        </section>
      )}
      {day && editing && (
        <PhotoSheet
          key={editing.id}
          asset={editing}
          index={photos.indexOf(editing) + 1}
          day={day}
          coverId={cover?.id ?? null}
          comments={comments.get(editing.id) ?? []}
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
