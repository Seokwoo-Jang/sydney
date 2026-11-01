'use client';
// Journal · Nine Notes (plan §7.6). Root id stays "section-journal".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSectionNav } from '@/components/checklist/useSectionNav';
import { DaySheet } from '@/components/journal/DaySheet';
import { Photo } from '@/components/journal/Photo';
import { commentsByPhoto, defaultPhotoId, storePhoto } from '@/components/journal/photoKit';
import { EmptyState, ErrorState, LoadingState, MemberMarks, SectionHeading } from '@/components/ui';
import { useAssets, useDays, useFiles, useJournal, useTrip } from '@/lib/data';
import type { FileAsset, Member, Participants, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { defaultDayPhoto } from '@/lib/url';
import type { SectionProps } from './types';
import styles from '@/components/journal/Journal.module.css';

const VIEWS = ['days'] as const;

/** Day card photo: the chosen cover while it exists, else the first photo, else the day's own photo. */
function coverFor(day: TripDay, photos: FileAsset[]) {
  const asset = photos.find((p) => p.id === day.coverAssetId) ?? photos[0] ?? null;
  const fallback = defaultDayPhoto(day.dayNumber);
  if (asset?.url) {
    return {
      isDefault: asset.isDefault,
      photo: { src: asset.url, thumb: asset.thumbUrl, width: asset.width, height: asset.height },
    };
  }
  return { isDefault: true, photo: fallback };
}

/** Who added the day's photos: one mark, both together, or none when unknown. */
function addedBy(photos: FileAsset[], members: Member[]): Participants | null {
  const keys = new Set(photos.map((p) => members.find((m) => m.id === p.createdBy)?.profileKey));
  if (keys.has('eren') && keys.has('amy')) return 'together';
  return keys.has('eren') ? 'eren' : keys.has('amy') ? 'amy' : null;
}

export default function JournalSection({ layout }: SectionProps) {
  const days = useDays();
  const assets = useAssets();
  const journal = useJournal();
  const files = useFiles();
  const trip = useTrip();
  const due = useDueContext();
  const nav = useSectionNav('journal', VIEWS, 'days');

  const me = trip.status === 'ready' ? trip.data.me : null;
  const partner = trip.status === 'ready' ? trip.data.partner : null;
  const members = trip.status === 'ready' ? trip.data.members : [];
  const dayRows = days.status === 'ready' ? days.data : [];
  const photosByDay = useMemo(() => {
    const map = new Map<string, FileAsset[]>();
    for (const a of assets.status === 'ready' ? assets.data : []) {
      if (a.kind !== 'photo' || !a.dayId) continue;
      map.set(a.dayId, [...(map.get(a.dayId) ?? []), a]);
    }
    return map;
  }, [assets]);

  const comments = useMemo(
    () => commentsByPhoto(journal.status === 'ready' ? journal.data : [], [...photosByDay.values()].flat()),
    [journal, photosByDay],
  );

  // Each day's own Nine Notes photo is filed once, by whoever opens the Journal first,
  // as if added, chosen as the day cover and noted "No photos yet." (owner, 2026-11-01;
  // the server sets the cover and the note). Once deleted it is not filed again.
  const filing = useRef(new Set<string>());
  useEffect(() => {
    if (!files.available || !me || days.status !== 'ready' || assets.status !== 'ready') return;
    const todo = days.data.filter(
      (d) => !d.defaultPhotoRemoved && !filing.current.has(d.id) && !(photosByDay.get(d.id) ?? []).some((p) => p.isDefault),
    );
    if (!todo.length) return;
    for (const d of todo) filing.current.add(d.id); // once per visit, even if it fails
    void (async () => {
      for (const d of todo) {
        try {
          const sample = defaultDayPhoto(d.dayNumber);
          const res = await fetch(sample.src);
          if (!res.ok) continue;
          const blob = await res.blob();
          const file = new File([blob], `day-${d.dayNumber}.webp`, { type: blob.type || 'image/webp' });
          const { paths, width, height } = await storePhoto(files, file);
          const others = photosByDay.get(d.id) ?? [];
          const row = await assets.create({
            id: defaultPhotoId(d.id),
            storagePath: paths[0],
            displayPath: paths[1],
            thumbPath: paths[2],
            width,
            height,
            focalX: 0.5,
            focalY: 0.4,
            zoom: 1,
            mime: file.type,
            bytes: file.size,
            kind: 'photo',
            isDefault: true,
            dayId: d.id,
            bookingId: null,
            documentId: null,
            caption: '',
            sortOrder: Math.min(10, ...others.map((p) => p.sortOrder)) - 10, // first on the day
          });
          // Filed meanwhile on the other device (or deleted before): this copy of the files goes.
          if (!row.ok || row.row.storagePath !== paths[0]) await files.remove(paths).catch(() => undefined);
        } catch {
          // Tried again the next time the Journal opens.
        }
      }
    })();
  }, [files, me, days, assets, photosByDay]);

  const openDay = nav.item ? (dayRows.find((d) => d.id === nav.item) ?? null) : null;
  // Set by the empty state's Add a photo; a card click or close clears it.
  const [startAdding, setStartAdding] = useState(false);
  const status = [days, assets].find((r) => r.status === 'error') ?? [days, assets].find((r) => r.status === 'loading');
  // Our own photos: the day's own photo does not count.
  const daysWithPhotos = dayRows.filter((d) => (photosByDay.get(d.id) ?? []).some((p) => !p.isDefault)).length;

  /** Empty state: today's page while the trip is under way, else Day 1. */
  const startFirst = () => {
    const today = due?.underway ? dayRows.find((d) => d.date === due.today) : undefined;
    const target = today ?? dayRows[0];
    if (!target) return;
    setStartAdding(true);
    nav.openItem(target.id);
  };

  let body;
  if (status?.status === 'error') body = <ErrorState onRetry={status.retry} />;
  else if (status?.status === 'loading') body = <LoadingState variant="cards" rows={9} className={styles.loading} />;
  else {
    const covers = dayRows.map((d) => ({ day: d, ...coverFor(d, photosByDay.get(d.id) ?? []) }));
    body = (
      <>
        <ol className={styles.gallery}>
          {covers.map(({ day, photo }) => {
            const photos = photosByDay.get(day.id) ?? [];
            const who = addedBy(photos, members);
            return (
              <li key={day.id}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => {
                    setStartAdding(false);
                    nav.openItem(day.id);
                  }}
                >
                  <Photo photo={photo} alt="" sizes="(min-width: 1024px) 260px, 32vw" className={styles.cardImg} />
                  <span className={styles.cardShade} aria-hidden="true" />
                  {who && (
                    <span className={styles.cardMarks} aria-hidden="true">
                      <MemberMarks who={who} size="sm" />
                    </span>
                  )}
                  <span className={styles.cardText}>
                    <b className={styles.cardNumber} aria-hidden="true">
                      {day.dayNumber}
                    </b>
                    <span className="sr-only">{S.time.day(day.dayNumber)}</span>
                    <span className={styles.cardTitle}>{day.title}</span>
                    <span className="sr-only">{photos.length ? S.journal.photoCount(photos.length) : S.journal.noPhotos}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {!daysWithPhotos && (
          <EmptyState compact icon="journal" title={S.empty.journal} actionLabel={S.empty.journalAction} onAction={startFirst} className={styles.empty} />
        )}
      </>
    );
  }

  const anyDefault = dayRows.some((d) => coverFor(d, photosByDay.get(d.id) ?? []).isDefault);

  return (
    <section id="section-journal" aria-labelledby="section-journal-title" className={styles.root} data-layout={layout}>
      <SectionHeading
        id="section-journal-title"
        eyebrow={S.sections.journal.menu}
        title={S.sections.journal.title}
        intro={S.sections.journal.intro}
        layout={layout}
        actions={anyDefault ? <span className={styles.sampleNote}>{S.journal.sampleNote}</span> : undefined}
      />
      {body}

      <DaySheet
        open={!!openDay}
        day={openDay}
        photos={openDay ? (photosByDay.get(openDay.id) ?? []) : []}
        comments={comments}
        me={me}
        partner={partner}
        members={members}
        startAdding={startAdding}
        onClose={() => {
          setStartAdding(false);
          nav.closeItem();
        }}
      />
    </section>
  );
}
