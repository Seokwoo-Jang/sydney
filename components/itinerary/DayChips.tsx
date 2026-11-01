'use client';
// Mobile Day 1–9 strip (plan §7.2.2): a sticky tablist that scrolls sideways.
// Arrow keys move and select; the chosen chip is kept in view inside the strip.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import type { TripDay } from '@/lib/types';
import styles from './itinerary.module.css';

export const chipId = (date: string) => `itin-day-tab-${date}`;

export function DayChips({
  days,
  selected,
  today,
  panelId,
  reduced,
  onSelect,
}: {
  days: TripDay[];
  /** null in Full Itinerary mode. */
  selected: string | null;
  today: string | null;
  panelId: string;
  reduced: boolean;
  onSelect: (date: string, via: 'click' | 'key') => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const focusable = selected ?? (days.some((d) => d.date === today) ? today : days[0]?.date);

  useEffect(() => {
    const el = strip.current;
    const chip = selected ? refs.current.get(selected) : null;
    if (!el || !chip) return;
    const left = chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' });
  }, [selected, reduced]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const jump = e.key === 'Home' ? 0 : e.key === 'End' ? days.length - 1 : null;
    if (!delta && jump === null) return;
    e.preventDefault();
    const next = jump ?? (i + delta + days.length) % days.length;
    const date = days[next].date;
    onSelect(date, 'key');
    refs.current.get(date)?.focus();
  };

  return (
    <div className={styles.chipBar}>
      <div ref={strip} role="tablist" aria-label={S.itinerary.daysLabel} className={styles.chipStrip}>
        {days.map((d, i) => {
          const on = d.date === selected;
          return (
            <button
              key={d.id}
              ref={(el) => {
                if (el) refs.current.set(d.date, el);
                else refs.current.delete(d.date);
              }}
              id={chipId(d.date)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={on ? panelId : undefined}
              tabIndex={d.date === focusable ? 0 : -1}
              className={styles.chip}
              data-today={d.date === today || undefined}
              onClick={() => onSelect(d.date, 'click')}
              onKeyDown={(e) => onKey(e, i)}
            >
              {d.date === today && <span className={styles.chipToday}>{S.time.today}</span>}
              <span className={styles.chipDay}>{S.time.day(d.dayNumber)}</span>
              <span className={styles.chipDate}>{formatDayLabel(d.date)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
