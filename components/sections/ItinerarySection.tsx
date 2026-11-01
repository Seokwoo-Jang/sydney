'use client';
import { useMemo, useState } from 'react';
import { ItineraryBody, type ItineraryData, type ItineraryMode } from '@/components/itinerary/ItineraryBody';
import styles from '@/components/itinerary/itinerary.module.css';
import { WhereWeAre } from '@/components/location/WhereWeAre';
import { ErrorState, LoadingState, SectionHeading, SegmentedControl } from '@/components/ui';
import { useBookings, useBudget, useDays, useItinerary, useLibrary, usePrelude, useTrip } from '@/lib/data';
import { S } from '@/lib/strings';
import type { SectionProps } from './types';

/** Itinerary · Nine Days in Sydney (plan §7.2). Root id stays "section-days". */
export default function ItinerarySection({ layout }: SectionProps) {
  const trip = useTrip();
  const days = useDays();
  const itinerary = useItinerary();
  const prelude = usePrelude();
  const bookings = useBookings();
  const library = useLibrary();
  const budget = useBudget();
  const [mode, setMode] = useState<ItineraryMode>('day');

  const required = [trip, days, itinerary, prelude, bookings, library, budget] as const;
  const failed = required.find((r) => r.status === 'error');
  const data = useMemo<ItineraryData | null>(() => {
    if (
      trip.status !== 'ready' ||
      days.status !== 'ready' ||
      itinerary.status !== 'ready' ||
      prelude.status !== 'ready' ||
      bookings.status !== 'ready' ||
      library.status !== 'ready' ||
      budget.status !== 'ready'
    )
      return null;
    return {
      trip: trip.data.trip,
      me: trip.data.me,
      partner: trip.data.partner,
      days: days.data,
      items: itinerary.data,
      activities: prelude.data.activities,
      bookings: bookings.data,
      resources: library.data.resources,
      resourceLinks: library.data.links,
      expenses: budget.data.expenses,
    };
  }, [trip, days, itinerary, prelude, bookings, library, budget]);

  const views =
    layout === 'board' && data ? (
      <SegmentedControl
        label={S.itinerary.viewsLabel}
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'day', label: S.itinerary.tripOverview },
          { value: 'full', label: S.itinerary.fullItinerary },
        ]}
      />
    ) : undefined;

  return (
    <section id="section-days" aria-labelledby="section-days-title" className={styles.section}>
      <SectionHeading
        id="section-days-title"
        eyebrow={S.sections.days.menu}
        title={S.sections.days.title}
        intro={S.sections.days.intro}
        layout={layout}
        actions={views}
      />
      {data && trip.status === 'ready' && (
        <WhereWeAre me={trip.data.me} members={trip.data.members} tz={trip.data.trip.timezone} />
      )}
      {data ? (
        data.days.length ? (
          <ItineraryBody layout={layout} data={data} mode={mode} setMode={setMode} />
        ) : (
          <p className={styles.footnote}>{S.empty.generic}</p>
        )
      ) : failed ? (
        <ErrorState onRetry={failed.retry} />
      ) : (
        <div className={styles.loading}>
          {layout === 'board' ? <LoadingState variant="cards" rows={9} /> : <LoadingState variant="cards" rows={3} />}
          <LoadingState variant="list" rows={4} />
        </div>
      )}
    </section>
  );
}
