'use client';
import { useMemo } from 'react';
import { useTrip } from '@/lib/data';
import { useCountdown } from '@/lib/hooks/useCountdown';
import { zonedDate } from '@/lib/time/zone';
import type { DueContext } from './due';

/** "Today" for due dates: home calendar before departure, trip calendar once under way. */
export function useDueContext(): DueContext | null {
  const trip = useTrip();
  const countdown = useCountdown();
  const t = trip.status === 'ready' ? trip.data.trip : null;
  return useMemo(() => {
    if (!t || !countdown) return null;
    const underway = countdown.state.kind === 'during' || countdown.state.kind === 'after';
    return {
      today: zonedDate(countdown.now, underway ? t.timezone : t.homeTimezone),
      tripStart: t.startDate,
      underway,
    };
  }, [t, countdown]);
}
