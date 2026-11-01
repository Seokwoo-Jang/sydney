// Cover backdrop phase from Sydney local time (plan §6.1).
// day 06:00–17:59, evening 18:00–20:59, night 21:00–05:59.
import { SYDNEY_TZ, addDays, zonedDate, zonedParts, zonedToInstant } from './zone';

export type CoverPhase = 'day' | 'evening' | 'night';

const BOUNDARIES: Array<[string, CoverPhase]> = [
  ['06:00', 'day'],
  ['18:00', 'evening'],
  ['21:00', 'night'],
];

export function coverPhase(instant: Date): CoverPhase {
  const { hour } = zonedParts(instant, SYDNEY_TZ);
  if (hour >= 6 && hour < 18) return 'day';
  if (hour >= 18 && hour < 21) return 'evening';
  return 'night';
}

/** First boundary strictly after `instant`. */
export function nextCoverBoundary(instant: Date): Date {
  const today = zonedDate(instant, SYDNEY_TZ);
  for (const date of [today, addDays(today, 1)]) {
    for (const [time] of BOUNDARIES) {
      const at = zonedToInstant(date, time, SYDNEY_TZ);
      if (at.getTime() > instant.getTime()) return at;
    }
  }
  throw new Error('unreachable');
}

/** Phase that starts at the next boundary. */
export function nextCoverPhase(instant: Date): CoverPhase {
  return coverPhase(nextCoverBoundary(instant));
}

/** '7:42 pm' */
export function formatSydneyClock(instant: Date): string {
  const { hour, minute } = zonedParts(instant, SYDNEY_TZ);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}
