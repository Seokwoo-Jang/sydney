'use client';
// Journal · Nine Notes (plan §7.6). Root id stays "section-journal".
import { useMemo, useState } from 'react';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSectionNav } from '@/components/checklist/useSectionNav';
import { DaySheet } from '@/components/journal/DaySheet';
import { Photo } from '@/components/journal/Photo';
import { EmptyState, ErrorState, LoadingState, MemberMarks, SectionHeading } from '@/components/ui';
import { useAssets, useDays, useTrip } from '@/lib/data';
import type { FileAsset, Member, Participants, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { defaultDayPhoto } from '@/lib/url';
import type { SectionProps } from './types';
import styles from '@/components/journal/Journal.module.css';

const VIEWS = ['days'] as const;

/** Day card photo: the chosen cover while it exists, else the first photo, else the sample. */
function coverFor(day: TripDay, photos: FileAsset[]) {
  const asset = photos.find((p) => p.id === day.coverAssetId) ?? photos[0] ?? null;
  const fallback = defaultDayPhoto(day.dayNumber);
  if (asset?.url) {
    return {
      isDefault: asset.url === fallback.src,
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

  const openDay = nav.item ? (dayRows.find((d) => d.id === nav.item) ?? null) : null;
  // Set by the empty state's Add a photo; a card click or close clears it.
  const [startAdding, setStartAdding] = useState(false);
  const status = [days, assets].find((r) => r.status === 'error') ?? [days, assets].find((r) => r.status === 'loading');
  const daysWithPhotos = dayRows.filter((d) => photosByDay.has(d.id)).length;

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
