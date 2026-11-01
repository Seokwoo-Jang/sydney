// Pure itinerary derivations (plan §7.2). No React, no storage: unit-tested.
import { formatWallTime, S } from '@/lib/strings';
import { itemInstantRange } from '@/lib/time/now';
import { SEOUL_TZ, SYDNEY_TZ, addDays, diffDays, zonedParts, zonedTime, zonedToInstant } from '@/lib/time/zone';
import type {
  ItineraryItem,
  ItineraryStatus,
  Participants,
  PreludeActivity,
  PreludeStatus,
  ResourceLink,
  TripDay,
} from '@/lib/types';

export type PeopleFilter = Participants;

/** Together = everything; Eren/Amy = together + their own. The Route builds everyone's map with it. */
export const matchesFilter = (item: Pick<ItineraryItem, 'participants'>, filter: PeopleFilter): boolean =>
  filter === 'together' || item.participants === 'together' || item.participants === filter;

/**
 * The List shows one lane, as the Route does (owner, 2026-11-02): Together = the plans
 * we do together; Eren / Amy = that person's own plans, plus the Together plans where
 * their own line starts (we split up) or ends (we meet again). Walked per day over timed,
 * live, not-cancelled plans, the way the Route walks them.
 */
export function laneItems(items: ItineraryItem[], filter: PeopleFilter): ItineraryItem[] {
  if (filter === 'together') return items.filter((i) => i.participants === 'together');
  const ends = new Set<string>();
  const byDay = new Map<string, ItineraryItem[]>();
  for (const i of items) {
    if (i.deletedAt || i.status === 'cancelled' || i.timeKind !== 'timed' || !i.startTime) continue;
    byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  }
  for (const day of byDay.values()) {
    let mine: ItineraryItem | null = null; // where this person last was
    let theirs: ItineraryItem | null = null; // and the other person
    for (const it of day.sort((a, b) => startMs(a) - startMs(b) || a.sortOrder - b.sortOrder)) {
      if (it.participants === 'together') {
        // Arriving here on their own line (we were apart): both ends are on it.
        if (mine && mine !== theirs) ends.add(mine.id).add(it.id);
        mine = theirs = it;
      } else if (it.participants === filter) {
        if (mine) ends.add(mine.id);
        mine = it;
      } else theirs = it;
    }
  }
  return items.filter((i) => i.participants === filter || ends.has(i.id));
}

export interface DayRow {
  item: ItineraryItem;
  /** Same record shown again on a later day (overnight flight). */
  continuation: boolean;
}

export interface DayRows {
  /** Continuations first, then timed rows by start instant. */
  timed: DayRow[];
  /** All-day, then time-to-be-decided. */
  untimed: DayRow[];
}

const startMs = (i: ItineraryItem) => itemInstantRange(i)?.start.getTime() ?? Number.MAX_SAFE_INTEGER;

/** Rows for one Sydney calendar day. Items from earlier days whose explicit range runs past this day's midnight continue here. */
export function buildDayRows(items: ItineraryItem[], date: string, tz: string = SYDNEY_TZ): DayRows {
  const live = items.filter((i) => !i.deletedAt);
  const dayStart = zonedToInstant(date, '00:00', tz).getTime();
  const continuations = live
    .filter((i) => {
      if (i.date >= date || i.timeKind !== 'timed' || diffDays(date, i.date) > 7) return false;
      const r = itemInstantRange(i);
      return !!r?.end && r.start.getTime() < dayStart && r.end.getTime() > dayStart;
    })
    .sort((a, b) => (itemInstantRange(a)!.end!.getTime() - itemInstantRange(b)!.end!.getTime()) || a.sortOrder - b.sortOrder)
    .map((item) => ({ item, continuation: true }));
  const own = live.filter((i) => i.date === date);
  const timed = own
    .filter((i) => i.timeKind === 'timed' && i.startTime)
    .sort((a, b) => startMs(a) - startMs(b) || a.sortOrder - b.sortOrder)
    .map((item) => ({ item, continuation: false }));
  const untimed = own
    .filter((i) => !(i.timeKind === 'timed' && i.startTime))
    .sort((a, b) => Number(a.timeKind !== 'all_day') - Number(b.timeKind !== 'all_day') || a.sortOrder - b.sortOrder)
    .map((item) => ({ item, continuation: false }));
  return { timed: [...continuations, ...timed], untimed };
}

/** 'KST', 'AEDT', 'AEST' — only shown when an item's zone differs from the trip's. */
export function zoneAbbr(tz: string, at: Date): string {
  if (tz === SEOUL_TZ) return 'KST';
  if (tz === SYDNEY_TZ) {
    const p = zonedParts(at, tz);
    const offset = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at.getTime() / 60000) * 60000) / 60000);
    return offset >= 660 ? 'AEDT' : 'AEST';
  }
  const name = new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return name?.value ?? tz;
}

export interface TimeLabel {
  /** Board: one line ('1:00 – 3:00 pm'). Tabs: start and end on their own lines. */
  lines: string[];
  /** Zone and next-day note, e.g. 'KST · next day'. */
  note: string | null;
  /** Accessible full text. */
  full: string;
}

const meridiem = (hhmm: string) => (Number(hhmm.slice(0, 2)) < 12 ? 'am' : 'pm');

export function timeLabel(row: DayRow, tripTz: string, layout: 'board' | 'tabs'): TimeLabel {
  const { item } = row;
  if (row.continuation) {
    const end = itemInstantRange(item)?.end;
    const text = end ? S.time.until(formatWallTime(zonedTime(end, tripTz))) : S.time.continuesFromPreviousDay;
    return { lines: [text], note: null, full: text };
  }
  if (item.timeKind === 'all_day') return { lines: [S.time.allDay], note: null, full: S.time.allDay };
  if (item.timeKind === 'unscheduled' || !item.startTime) return { lines: [S.time.unscheduled], note: null, full: S.time.unscheduled };
  const start = formatWallTime(item.startTime);
  const range = itemInstantRange(item);
  const notes: string[] = [];
  // Every timed row names its zone (AEDT in Sydney, KST at home), so the two are never mixed up.
  if (range) notes.push(zoneAbbr(item.timezone, range.start));
  if (!item.endTime) return { lines: [start], note: notes.join(' · ') || null, full: [start, ...notes].join(' ') };
  const end = formatWallTime(item.endTime);
  const endDate = item.endDate ?? (item.endTime <= item.startTime ? addDays(item.date, 1) : item.date);
  if (endDate > item.date) notes.push(S.itinerary.nextDay);
  const sameHalf = endDate === item.date && meridiem(item.startTime) === meridiem(item.endTime);
  // Board: '1:00 – 3:00 pm' fits one line; mixed halves break after the dash.
  const lines =
    layout === 'tabs' ? [start, end] : sameHalf ? [`${start.replace(/ (am|pm)$/, '')} – ${end}`] : [`${start} –`, end];
  const note = notes.join(' · ') || null;
  return { lines, note, full: `${start} – ${end}${note ? ` ${note}` : ''}` };
}

/** Finished by `now` (and not the current one). Untimed rows pass with their day. */
export function isPassed(item: ItineraryItem, now: Date, today: string): boolean {
  const r = itemInstantRange(item);
  if (!r) return item.date < today;
  return (r.end ?? r.start).getTime() <= now.getTime();
}

/**
 * Status as shown: a Planned or Fixed item whose time has passed reads as
 * Completed (nobody ticks it off by hand). Ideas stay ideas. Display only:
 * the stored status is not changed.
 */
export function shownStatus(status: ItineraryStatus, passed: boolean): ItineraryStatus {
  return passed && (status === 'planned' || status === 'confirmed') ? 'completed' : status;
}

/** First four rows, or a window that keeps Now / Up Next in view (plan §7.2.3). */
export function overviewWindow<T>(rows: T[], focus: (row: T) => boolean, limit = 4): T[] {
  if (rows.length <= limit) return rows;
  const first = rows.findIndex(focus);
  const start = first < 0 ? 0 : Math.max(0, Math.min(first - 1, rows.length - limit));
  return rows.slice(start, start + limit);
}

/** Selected day when the URL has none: Sydney today in the trip, Day 1 before, Day 9 after (plan §7.2.2). */
export function defaultDay(days: Pick<TripDay, 'date'>[], today: string | null): string | null {
  if (!days.length) return null;
  const first = days[0].date;
  const last = days[days.length - 1].date;
  if (!today || today < first) return first;
  if (today > last) return last;
  return days.some((d) => d.date === today) ? today : first;
}

/** 'Together', 'Together & on our own', 'On our own' — for the day sub-heading. */
export function mixLabel(items: Pick<ItineraryItem, 'participants'>[]): string | null {
  if (!items.length) return null;
  const together = items.some((i) => i.participants === 'together');
  const solo = items.some((i) => i.participants !== 'together');
  if (together && solo) return S.itinerary.mix.mixed;
  return together ? S.itinerary.mix.together : S.itinerary.mix.solo;
}

// ── Prelude link rules (plan §7.3) ────────────────────────────────
/** Status an activity takes when linked to an item with `itemStatus`. Done is never overwritten. */
export function linkedActivityStatus(itemStatus: ItineraryStatus, current: PreludeStatus): PreludeStatus {
  if (current === 'done') return 'done';
  if (itemStatus === 'planned' || itemStatus === 'confirmed') return 'planned';
  if (itemStatus === 'idea') return 'idea';
  return current;
}

/** Status after the item is deleted or unlinked: back to Idea unless Done. */
export const unlinkedActivityStatus = (current: PreludeStatus): PreludeStatus => (current === 'done' ? 'done' : 'idea');

export interface ActivityPatch {
  activity: PreludeActivity;
  patch: { itineraryItemId?: string | null; status?: PreludeStatus };
}

/**
 * Activity writes after saving an item: unlink the previous activity (→ Idea),
 * link the chosen one and align its status with the item's.
 */
export function activityPatchesForItem(
  itemId: string,
  itemStatus: ItineraryStatus | null, // null = item deleted
  activities: PreludeActivity[],
  selectedId: string | null,
  /** The database derives status and unlinks on delete: send link changes only. */
  serverManaged = false,
): ActivityPatch[] {
  if (serverManaged) {
    if (itemStatus === null) return [];
    return activityPatchesForItem(itemId, itemStatus, activities, selectedId)
      .filter((p) => 'itineraryItemId' in p.patch)
      .map((p) => ({ activity: p.activity, patch: { itineraryItemId: p.patch.itineraryItemId } }));
  }
  const out: ActivityPatch[] = [];
  for (const a of activities) {
    if (a.deletedAt) continue;
    const linkedHere = a.itineraryItemId === itemId;
    const chosen = itemStatus !== null && a.id === selectedId;
    if (linkedHere && !chosen) {
      out.push({ activity: a, patch: { itineraryItemId: null, status: unlinkedActivityStatus(a.status) } });
    } else if (chosen) {
      const status = linkedActivityStatus(itemStatus, a.status);
      const patch: ActivityPatch['patch'] = {};
      if (!linkedHere) patch.itineraryItemId = itemId;
      if (status !== a.status) patch.status = status;
      if (Object.keys(patch).length) out.push({ activity: a, patch });
    }
  }
  return out;
}

// ── Library links (owner, 2026-11-01: links are made on the itinerary plan) ──

/**
 * Saved Library links of an itinerary item: its own, plus the single link its Prelude
 * plan carried before links moved onto the itinerary (it moves over on the item's next save).
 */
/** A Prelude plan's own Library links (its resource_links rows), in saved order. */
export function planResourceIds(planId: string | null | undefined, links: ResourceLink[]): string[] {
  return planId ? [...new Set(links.filter((l) => l.preludeActivityId === planId).map((l) => l.resourceId))] : [];
}

/** An item's Library links, plus any its Prelude plan still holds itself (they move here on save). */
export function itemResourceIds(itemId: string, links: ResourceLink[], activities: PreludeActivity[]): string[] {
  const ids = links.filter((l) => l.itineraryItemId === itemId).map((l) => l.resourceId);
  const plan = activities.find((a) => !a.deletedAt && a.itineraryItemId === itemId);
  return [...new Set([...ids, ...planResourceIds(plan?.id, links)])];
}

/**
 * What to write for the links the form changed, against the links stored now: resources
 * to link and link rows to remove. `opened` = the item's own links when the form opened,
 * so a link the other person added or removed meanwhile is left as they made it.
 */
export function libraryLinkChanges(
  itemId: string,
  opened: string[],
  wanted: string[],
  links: ResourceLink[],
): { add: string[]; remove: string[] } {
  const current = links.filter((l) => l.itineraryItemId === itemId);
  return {
    add: [...new Set(wanted)].filter((id) => !opened.includes(id) && !current.some((l) => l.resourceId === id)),
    remove: current.filter((l) => opened.includes(l.resourceId) && !wanted.includes(l.resourceId)).map((l) => l.id),
  };
}
