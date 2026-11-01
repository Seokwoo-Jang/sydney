// "Now" / "Up Next" for the itinerary (plan §7.2.3).
import type { ItineraryItem } from '../types';
import { SYDNEY_TZ, addDays, zonedDate, zonedToInstant } from './zone';

const NOT_NOW = new Set(['idea', 'cancelled', 'completed']);
const NOT_BOUNDARY = new Set(['idea', 'cancelled']);

/** Explicit start/end instants. `end` is null when the item has no end time. */
export function itemInstantRange(item: ItineraryItem): { start: Date; end: Date | null } | null {
  if (item.timeKind !== 'timed' || !item.startTime) return null;
  const start = zonedToInstant(item.date, item.startTime, item.timezone);
  if (!item.endTime) return { start, end: null };
  const endDate = item.endDate ?? (item.endTime <= item.startTime ? addDays(item.date, 1) : item.date);
  return { start, end: zonedToInstant(endDate, item.endTime, item.timezone) };
}

export function computeNow(
  items: ItineraryItem[],
  now: Date,
  viewedDate: string,
  tz: string = SYDNEY_TZ,
): { nowIds: string[]; upNextIds: string[] } {
  const today = zonedDate(now, tz);
  if (viewedDate !== today) return { nowIds: [], upNextIds: [] };
  const t = now.getTime();

  const timed = items
    .filter((i) => !i.deletedAt)
    .map((item) => ({ item, range: itemInstantRange(item) }))
    .filter((x): x is { item: ItineraryItem; range: { start: Date; end: Date | null } } => !!x.range);
  const boundaries = timed.filter((x) => !NOT_BOUNDARY.has(x.item.status));
  const eligible = timed.filter((x) => !NOT_NOW.has(x.item.status));

  const effectiveEnd = (x: (typeof timed)[number]): number => {
    if (x.range.end) return x.range.end.getTime();
    const s = x.range.start.getTime();
    const next = boundaries
      .filter((b) => b.item.date === x.item.date && b.range.start.getTime() > s)
      .map((b) => b.range.start.getTime());
    if (next.length) return Math.min(...next);
    return zonedToInstant(addDays(zonedDate(x.range.start, tz), 1), '00:00', tz).getTime();
  };

  const nowIds = eligible
    .filter((x) => x.range.start.getTime() <= t && t < effectiveEnd(x))
    .map((x) => x.item.id);
  if (nowIds.length) return { nowIds, upNextIds: [] };

  const future = eligible.filter((x) => x.range.start.getTime() > t && zonedDate(x.range.start, tz) === today);
  if (!future.length) return { nowIds, upNextIds: [] };
  const first = Math.min(...future.map((x) => x.range.start.getTime()));
  return { nowIds, upNextIds: future.filter((x) => x.range.start.getTime() === first).map((x) => x.item.id) };
}
