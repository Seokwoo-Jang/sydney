'use client';
// Overview = top of the board (PC) or the mobile landing hero. Built from
// shell pieces so the cover, countdown and summaries stay in one place.
import { MobileHero, PreludeCard, PreludeMini, SummaryStrip, TripCover } from '@/components/shell/Overview';
import { S } from '@/lib/strings';
import type { SectionProps } from './types';
import styles from './OverviewSection.module.css';

export default function OverviewSection({ layout }: SectionProps) {
  if (layout === 'board') {
    return (
      <section id="section-overview" aria-label={S.sections.overview.menu} className={styles.board}>
        <div className={styles.coverRow}>
          <TripCover />
          <PreludeMini />
        </div>
        <SummaryStrip />
      </section>
    );
  }
  return (
    <section id="section-overview" aria-label={S.sections.overview.menu} className={styles.tabs}>
      <MobileHero />
      <PreludeCard />
    </section>
  );
}
