'use client';
// Journal · Nine Notes (plan §7.6). Root id stays "section-journal".
import { useCallback, useMemo, useState } from 'react';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSectionNav } from '@/components/checklist/useSectionNav';
import { AdjustPhotoSheet } from '@/components/journal/AdjustPhotoSheet';
import { DaySheet } from '@/components/journal/DaySheet';
import type { NoteDraft } from '@/components/journal/NoteEditor';
import { Photo } from '@/components/journal/Photo';
import { EmptyState, ErrorState, LoadingState, MemberMarks, SectionHeading } from '@/components/ui';
import { useAssets, useDays, useJournal, useTrip } from '@/lib/data';
import type { FileAsset, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { defaultDayPhoto } from '@/lib/url';
import type { SectionProps } from './types';
import styles from '@/components/journal/Journal.module.css';

const VIEWS = ['days'] as const;

function coverFor(day: TripDay, photos: FileAsset[]) {
  const asset = photos.find((p) => p.id === day.coverAssetId) ?? photos[0] ?? null;
  const fallback = defaultDayPhoto(day.dayNumber);
  if (asset?.url) {
    return {
      isDefault: asset.url === fallback.src,
      photo: { src: asset.url, thumb: asset.thumbUrl, width: asset.width, height: asset.height, focalX: asset.focalX, focalY: asset.focalY, zoom: asset.zoom },
    };
  }
  return { isDefault: true, photo: { src: fallback.src, thumb: fallback.thumb, width: fallback.width, height: fallback.height, focalX: 0.5, focalY: 0.4, zoom: 1 } };
}

export default function JournalSection({ layout }: SectionProps) {
  const days = useDays();
  const journal = useJournal();
  const assets = useAssets();
  const trip = useTrip();
  const due = useDueContext();
  const nav = useSectionNav('journal', VIEWS, 'days');
  const [drafts, setDrafts] = useState<Record<string, NoteDraft>>({});
  const [adjust, setAdjust] = useState<FileAsset | null>(null);
  const [focusMine, setFocusMine] = useState(false);

  const me = trip.status === 'ready' ? trip.data.me : null;
  const partner = trip.status === 'ready' ? trip.data.partner : null;
  const members = trip.status === 'ready' ? trip.data.members : [];
  const dayRows = days.status === 'ready' ? days.data : [];
  const entries = useMemo(() => (journal.status === 'ready' ? journal.data.filter((e) => e.body.trim()) : []), [journal]);
  const photosByDay = useMemo(() => {
    const map = new Map<string, FileAsset[]>();
    for (const a of assets.status === 'ready' ? assets.data : []) {
      if (a.kind !== 'photo' || !a.dayId) continue;
      map.set(a.dayId, [...(map.get(a.dayId) ?? []), a]);
    }
    return map;
  }, [assets]);

  const onDraft = useCallback((key: string, d: NoteDraft | null) => {
    setDrafts((all) => {
      const next = { ...all };
      if (d) next[key] = d;
      else delete next[key];
      return next;
    });
  }, []);

  const openDay = nav.item ? (dayRows.find((d) => d.id === nav.item) ?? null) : null;
  const status = [days, journal, assets].find((r) => r.status === 'error') ?? [days, journal, assets].find((r) => r.status === 'loading');

  const writeFirst = () => {
    const today = due?.underway ? dayRows.find((d) => d.date === due.today) : undefined;
    const target = today ?? dayRows[0];
    if (!target) return;
    setFocusMine(true);
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
            const authors = new Set(entries.filter((e) => e.dayId === day.id).map((e) => members.find((m) => m.id === e.authorId)?.profileKey));
            const who = authors.has('eren') && authors.has('amy') ? 'together' : authors.has('eren') ? 'eren' : authors.has('amy') ? 'amy' : null;
            const count = entries.filter((e) => e.dayId === day.id).length;
            return (
              <li key={day.id}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => {
                    setFocusMine(false);
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
                    <span className="sr-only">{count ? S.journal.written(count) : S.journal.notWritten}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {!entries.length && (
          <EmptyState compact icon="journal" title={S.empty.journal} actionLabel={S.empty.journalAction} onAction={writeFirst} className={styles.empty} />
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
        entries={journal.status === 'ready' ? journal.data : []}
        me={me}
        partner={partner}
        members={members}
        drafts={drafts}
        focusMine={focusMine}
        onDraft={onDraft}
        onAdjust={setAdjust}
        onClose={() => {
          setFocusMine(false);
          nav.closeItem();
        }}
      />
      <AdjustPhotoSheet
        open={!!adjust}
        asset={adjust ? ((assets.status === 'ready' ? assets.data.find((a) => a.id === adjust.id) : null) ?? adjust) : null}
        day={adjust ? (dayRows.find((d) => d.id === adjust.dayId) ?? null) : null}
        me={me}
        partner={partner}
        members={members}
        onClose={() => setAdjust(null)}
      />
    </section>
  );
}
