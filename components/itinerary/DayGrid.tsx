'use client';
// PC 3×3 Day cards (plan §5.3, pc.png). Selection = outline, real today = badge.
import { Badge, Icon } from '@/components/ui';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import type { TripDay } from '@/lib/types';
import styles from './itinerary.module.css';

export interface DayCardInfo {
  count: number;
  flight: boolean;
  route: string | null;
  prelude: boolean;
}

export function DayGrid({
  days,
  info,
  selected,
  today,
  onSelect,
}: {
  days: TripDay[];
  info: Map<string, DayCardInfo>;
  /** null in Full Itinerary mode. */
  selected: string | null;
  today: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <ul role="list" className={styles.dayGrid} aria-label={S.itinerary.daysLabel}>
      {days.map((d) => {
        const i = info.get(d.date) ?? { count: 0, flight: false, route: null, prelude: false };
        const meta = i.count ? [S.itinerary.activities(i.count), i.route].filter(Boolean).join(' · ') : S.empty.day.replace(/\.$/, '');
        return (
          <li key={d.id}>
            <button
              type="button"
              className={styles.dayCard}
              aria-pressed={d.date === selected}
              data-today={d.date === today || undefined}
              onClick={() => onSelect(d.date)}
            >
              <span className={styles.dayTop}>
                <span className={styles.dayNum}>{d.dayNumber}</span>
                <span className={styles.dayDate}>{formatDayLabel(d.date)}</span>
                {d.date === today && <Badge tone="today">{S.time.today}</Badge>}
                {i.flight && <Icon name="plane" size={16} className={styles.dayFlight} label={S.itinerary.flightDay} />}
              </span>
              <span className={styles.dayTheme}>{d.title}</span>
              <span className={styles.dayMeta}>
                {i.prelude && (
                  <Icon name="note" size={14} className={styles.preludeNote} label={S.itinerary.preludeDay} />
                )}
                <span className={styles.dayMetaText}>{meta}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
