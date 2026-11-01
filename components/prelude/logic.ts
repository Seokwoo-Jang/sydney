// Pure Prelude derivations (plan §7.3).
import { timeLabel } from '@/components/itinerary/logic';
import { S } from '@/lib/strings';
import { itemInstantRange } from '@/lib/time/now';
import { formatDayLabel } from '@/lib/time/zone';
import type { ItineraryItem, PreludeActivity, TripDay } from '@/lib/types';

const itemKey = (item: ItineraryItem | undefined) =>
  item ? (itemInstantRange(item)?.start.getTime() ?? Date.parse(`${item.date}T23:59:59Z`)) : Number.MAX_SAFE_INTEGER;

/** Planned (by itinerary date) → Idea (list order); Done separately. */
export function sortActivities(
  activities: PreludeActivity[],
  items: Map<string, ItineraryItem>,
): { open: PreludeActivity[]; done: PreludeActivity[] } {
  const live = activities.filter((a) => !a.deletedAt);
  const linked = (a: PreludeActivity) => (a.itineraryItemId ? items.get(a.itineraryItemId) : undefined);
  const planned = live
    .filter((a) => a.status === 'planned')
    .sort((a, b) => itemKey(linked(a)) - itemKey(linked(b)) || a.sortOrder - b.sortOrder);
  const ideas = live.filter((a) => a.status === 'idea').sort((a, b) => a.sortOrder - b.sortOrder);
  const done = live.filter((a) => a.status === 'done').sort((a, b) => a.sortOrder - b.sortOrder);
  return { open: [...planned, ...ideas], done };
}

/** 'Day 2 · Fri, 27 Dec · 2:30 – 3:00 pm' from the linked itinerary item. */
export function whenLine(item: ItineraryItem, days: TripDay[], tripTz: string): string {
  const day = days.find((d) => d.date === item.date);
  const time = timeLabel({ item, continuation: false }, tripTz, 'board');
  // The list names every zone; this one-line summary only names a zone other than the trip's.
  const note = item.timezone === tripTz ? '' : (time.note ?? '');
  return [day ? S.time.day(day.dayNumber) : '', formatDayLabel(item.date), time.lines.join(' '), note]
    .filter(Boolean)
    .join(' · ');
}
