'use client';
import { useMemo } from 'react';
import { PreludeBody, type PreludeViewData } from '@/components/prelude/PreludeBody';
import styles from '@/components/prelude/prelude.module.css';
import { ErrorState, LoadingState } from '@/components/ui';
import { useDays, useItinerary, useLibrary, usePrelude, useTrip } from '@/lib/data';
import { S } from '@/lib/strings';
import type { SectionProps } from './types';

/** Amy's Prelude (plan §7.3). Root id stays "section-prelude". */
export default function PreludeSection({ layout }: SectionProps) {
  const trip = useTrip();
  const prelude = usePrelude();
  const itinerary = useItinerary();
  const days = useDays();
  const library = useLibrary();

  const failed = [trip, prelude, itinerary, days, library].find((r) => r.status === 'error');
  const data = useMemo<PreludeViewData | null>(() => {
    if (trip.status !== 'ready' || prelude.status !== 'ready' || itinerary.status !== 'ready' || days.status !== 'ready' || library.status !== 'ready')
      return null;
    return {
      trip: trip.data.trip,
      me: trip.data.me,
      partner: trip.data.partner,
      goal: prelude.data.goal,
      activities: prelude.data.activities,
      items: itinerary.data,
      days: days.data,
      resources: library.data.resources,
      links: library.data.links,
    };
  }, [trip, prelude, itinerary, days, library]);

  return (
    <section id="section-prelude" aria-labelledby="section-prelude-title" className={styles.section} data-layout={layout}>
      {data ? (
        <PreludeBody layout={layout} data={data} />
      ) : (
        <div className={styles.root} data-layout={layout}>
          <div className={styles.hero}>
            <span className={styles.heroShade} aria-hidden="true" />
            <div className={styles.heroText}>
              <p className={`eyebrow ${styles.eyebrow}`}>{S.sections.prelude.title}</p>
              <h2 id="section-prelude-title" className={styles.title}>
                {S.sections.prelude.tagline}
              </h2>
              <p className={styles.intro}>{S.sections.prelude.intro}</p>
            </div>
          </div>
          <div className={styles.body}>
            {failed ? <ErrorState onRetry={failed.retry} className={styles.state} /> : <LoadingState variant="list" rows={2} className={styles.state} />}
          </div>
        </div>
      )}
    </section>
  );
}
