// Which push notifications are due (plan §8.5). Pure: no database, no network,
// no Deno APIs, so tests/push.test.ts imports it directly. Input rows are the
// snake_case columns the Edge Function selects.
//
// The function runs every minute and asks for everything scheduled in
// (now − 15 min, now]. notification_log's unique (member, kind, target,
// scheduled_for) makes each one fire once; when a time changes the old
// scheduled_for simply never comes up again.
//
// Text is title, time and place name only: never booking references,
// coordinates, notes, journal text or amounts (they show on the lock screen).

export type NotificationKind = 'schedule' | 'meet_up' | 'flight' | 'car' | 'partner_update' | 'countdown';
export type KindGroup = 'schedule' | 'flights_car' | 'partner_updates' | 'countdown';

/** Per-device switches (push_subscriptions.enabled_kinds) by notification kind. */
export const KIND_GROUP: Record<NotificationKind, KindGroup> = {
  schedule: 'schedule',
  meet_up: 'schedule',
  flight: 'flights_car',
  car: 'flights_car',
  partner_update: 'partner_updates',
  countdown: 'countdown',
};

/** Kinds tied to a clock time: sent with high urgency and during quiet hours. */
export const TIMED_KINDS: ReadonlySet<NotificationKind> = new Set(['schedule', 'meet_up', 'flight', 'car']);

export const WINDOW_MS = 15 * 60_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const PARTNER_DELAY = 5 * MIN;
const QUIET_FROM = 22;
const QUIET_UNTIL = 8;

// ── input rows ─────────────────────────────────────────────────

export interface TripRow {
  id: string;
  start_date: string;
  end_date: string;
  timezone: string;
  home_timezone: string;
}

export interface MemberRow {
  id: string;
  profile_key: string; // 'eren' | 'amy'
  display_name: string;
}

export interface ItemRow {
  id: string;
  date: string;
  time_kind: string;
  start_time: string | null;
  timezone: string;
  status: string;
  participants: string;
  title: string;
  place: string | null;
  sort_order: number | null;
  is_example: boolean;
  deleted_at: string | null;
}

export interface BookingRow {
  id: string;
  kind: string;
  status: string;
  deleted_at: string | null;
  detail: unknown; // FlightDetail | CarDetail (lib/types.ts); only the fields below are read
}

export interface TaskRow {
  id: string;
  kind: string;
  title: string;
  assignee: string | null;
  due_date: string | null;
  checked: boolean;
  is_applicable?: boolean | null;
  booking_id: string | null;
  deleted_at: string | null;
}

export interface ChangeRow {
  id: string;
  actor_member_id: string;
  entity: string; // 'itinerary' | 'booking'
  entity_id: string;
  day_date: string | null;
  changed_at: string;
  notified_at?: string | null;
}

export interface Snapshot {
  trip: TripRow;
  members: MemberRow[];
  items: ItemRow[];
  bookings: BookingRow[];
  tasks: TaskRow[];
  changes: ChangeRow[]; // pending (notified_at is null)
}

export interface DueNotification {
  memberIds: string[];
  kind: NotificationKind;
  targetId: string;
  scheduledFor: string; // ISO instant; part of the dedupe key
  title: string;
  body: string;
  url: string; // relative query, resolved against the app scope by the service worker
  tag: string;
  changeIds?: string[]; // partner_update: partner_changes rows to mark notified once handled
}

// ── time (Intl only; never the runtime's own zone) ─────────────

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, tz: string): Parts {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(instant)) out[p.type] = p.value;
  return { year: +out.year, month: +out.month, day: +out.day, hour: +out.hour, minute: +out.minute };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function zonedDate(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return [+m[1], +m[2], +m[3]];
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** a − b in calendar days. */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = parseDate(a);
  const [by, bm, bd] = parseDate(b);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 864e5);
}

function offsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/**
 * Wall clock 'YYYY-MM-DD' + 'HH:mm' in `tz` → instant. Same rule as
 * lib/time/zone.ts: in a DST gap the time moves forward by the gap; in an
 * overlap the earlier instant wins.
 */
export function wallToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = parseDate(date);
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!tm) throw new Error(`Invalid time: ${time}`);
  const wall = Date.UTC(y, mo - 1, d, +tm[1], +tm[2]);
  const exact = [wall - 864e5, wall, wall + 864e5]
    .map((probe) => wall - offsetMinutes(new Date(probe), tz) * MIN)
    .filter((t) => {
      const p = zonedParts(new Date(t), tz);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
    })
    .sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]);
  return new Date(wall - offsetMinutes(new Date(wall - 864e5), tz) * MIN);
}

/** Like wallToUtc, but null for missing or malformed values (one bad row must not stop the run). */
function instantOf(date: unknown, time: unknown, tz: unknown): number | null {
  if (typeof date !== 'string' || typeof time !== 'string' || typeof tz !== 'string') return null;
  try {
    return wallToUtc(date, time, tz).getTime();
  } catch {
    return null;
  }
}

/** '21:50' → '9:50 pm' (en-AU). */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}

const clockAt = (instant: number, tz: string) => {
  const p = zonedParts(new Date(instant), tz);
  return formatClock(`${pad(p.hour)}:${pad(p.minute)}`);
};

/**
 * Where the recipient is: home until the outbound flight leaves (without one,
 * through the first day), the trip's zone during the trip, home after it.
 */
export function recipientZone(trip: TripRow, now: Date, departsAt: number | null = null): string {
  const before = departsAt != null ? now.getTime() < departsAt : zonedDate(now, trip.home_timezone) <= trip.start_date;
  if (before) return trip.home_timezone;
  if (zonedDate(now, trip.timezone) > trip.end_date) return trip.home_timezone;
  return trip.timezone;
}

/** 22:00–08:00 where the recipient is: partner updates wait until 08:00. */
export function isQuietHours(trip: TripRow, now: Date, departsAt: number | null = null): boolean {
  const h = zonedParts(now, recipientZone(trip, now, departsAt)).hour;
  return h >= QUIET_FROM || h < QUIET_UNTIL;
}

// ── text ───────────────────────────────────────────────────────

// Coordinates in any common spelling: decimal pairs ('-33.8568, 151.2153' or
// space-separated), degrees with hemispheres ('33.8568° S, 151.2153° E'), DMS
// ('33°51'24.5"S 151°12'55.1"E', the name of a dropped-pin Maps link) and Plus Codes.
const HEMI = String.raw`(?:\s*[NSEW](?![A-Za-z]))?`;
const DEG = String.raw`[-+]?\d{1,3}(?:\.\d+)?\s*°(?:\s*\d{1,2}(?:\.\d+)?\s*['′’])?(?:\s*\d{1,2}(?:\.\d+)?\s*(?:["″”]|''))?${HEMI}`;
const DEC = String.raw`[-+]?\d{1,3}\.\d{3,}${HEMI}`;
const PLUS_CODE = String.raw`\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b`;
const COORDS = new RegExp(`(?:${DEG}|${DEC})[\\s,;/]*(?:${DEG}|${DEC})|${PLUS_CODE}`, 'g');

/** One line, no coordinate pairs, at most `max` characters. */
function clean(s: unknown, max = 80): string {
  if (typeof s !== 'string') return '';
  const chars = Array.from(s.replace(COORDS, ' ').replace(/\s+/g, ' ').trim().replace(/^[·,\s]+|[·,\s]+$/g, ''));
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

const TITLES: Record<NotificationKind, string> = {
  schedule: 'Coming up',
  meet_up: 'Meet up',
  flight: 'Flight',
  car: 'Car return',
  partner_update: 'Partner updates',
  countdown: 'Side by Side',
};

const dayUrl = (date: string, itemId?: string) =>
  `?section=days&day=${date}${itemId ? `&item=${encodeURIComponent(itemId)}` : ''}`;
const bookingUrl = (id: string) => `?section=ready&view=bookings&item=${encodeURIComponent(id)}`;
const taskUrl = (id: string) => `?section=ready&view=task&item=${encodeURIComponent(id)}`;

// ── detail fields (jsonb, validated loosely) ───────────────────

interface Flight {
  flightNumber: string;
  from: string;
  departDate: string;
  departTime: string;
  departTimezone: string;
  departTerminal: string;
  checkInBy: { date: string; time: string; timezone: string } | null;
  passengerIds: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function flightOf(detail: unknown): Flight | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  const c = d.checkInBy as Record<string, unknown> | null | undefined;
  const pax = Array.isArray(d.passengers) ? d.passengers : [];
  return {
    flightNumber: clean(d.flightNumber, 12) || 'your flight',
    from: clean(d.from, 24),
    departDate: str(d.departDate),
    departTime: str(d.departTime),
    departTimezone: str(d.departTimezone),
    departTerminal: clean(d.departTerminal, 12),
    checkInBy: c && typeof c === 'object' ? { date: str(c.date), time: str(c.time), timezone: str(c.timezone) } : null,
    passengerIds: pax.map((p) => str((p as Record<string, unknown> | null)?.memberId)).filter(Boolean),
  };
}

/** 'ICN T1' from ('ICN', '1' | 'T1' | 'Terminal 1'). */
function airportText(from: string, terminal: string): string {
  const t = /^\d+$/.test(terminal) ? `T${terminal}` : terminal;
  return [from || 'the airport', t].filter(Boolean).join(' ');
}

// ── plan ───────────────────────────────────────────────────────

export function planNotifications(s: Snapshot, now: Date): DueNotification[] {
  const nowMs = now.getTime();
  const inWindow = (t: number | null): t is number => t != null && t > nowMs - WINDOW_MS && t <= nowMs;
  const out: DueNotification[] = [];
  const add = (n: Omit<DueNotification, 'scheduledFor' | 'title'> & { at: number | null; title?: string }) => {
    const { at, title, ...rest } = n;
    if (!inWindow(at) || !rest.memberIds.length) return;
    out.push({ ...rest, title: title ?? TITLES[rest.kind], scheduledFor: new Date(at).toISOString() });
  };

  const memberByKey = new Map(s.members.map((m) => [m.profile_key, m]));
  const memberIds = new Set(s.members.map((m) => m.id));
  const both = s.members.map((m) => m.id);
  const forPeople = (who: string | null): string[] => {
    if (who === 'eren' || who === 'amy') {
      const m = memberByKey.get(who);
      return m ? [m.id] : [];
    }
    return both;
  };

  // ── schedule / meet up ──
  const live = s.items
    .filter((i) => !i.deleted_at && !i.is_example && i.time_kind === 'timed' && i.start_time && i.status !== 'cancelled')
    .map((i) => ({ i, start: instantOf(i.date, i.start_time, i.timezone) }))
    .filter((x): x is { i: ItemRow; start: number } => x.start != null)
    .sort((a, b) => a.start - b.start || (a.i.sort_order ?? 0) - (b.i.sort_order ?? 0) || a.i.id.localeCompare(b.i.id));

  // Eren and Amy rejoin: the previous timed item that day, for at least one of
  // them, was their own solo item (same rule as the route map's Meet up).
  const isMeetUp = (item: ItemRow): boolean =>
    item.participants === 'together' &&
    (['eren', 'amy'] as const).some((p) => {
      const path = live.filter((x) => x.i.date === item.date && (x.i.participants === 'together' || x.i.participants === p));
      const k = path.findIndex((x) => x.i.id === item.id);
      return k > 0 && path[k - 1].i.participants === p;
    });

  for (const { i, start } of live) {
    if (i.status !== 'planned' && i.status !== 'confirmed') continue;
    const at = start - 30 * MIN;
    if (!inWindow(at)) continue; // before the meet-up scan, which is per item
    const mins = Math.max(1, Math.round((start - nowMs) / MIN));
    const title = clean(i.title);
    const place = clean(i.place);
    if (isMeetUp(i)) {
      add({
        kind: 'meet_up',
        targetId: i.id,
        at,
        memberIds: both,
        body: `Meeting up in ${mins} min · ${place || title}`,
        url: dayUrl(i.date, i.id),
        tag: `item-${i.id}`,
      });
    } else {
      add({
        kind: 'schedule',
        targetId: i.id,
        at,
        memberIds: forPeople(i.participants),
        body: `In ${mins} min · ${title}${place ? ` · ${place}` : ''}`,
        url: dayUrl(i.date, i.id),
        tag: `item-${i.id}`,
      });
    }
  }

  // ── flights ──
  const booked = s.bookings.filter((b) => !b.deleted_at && b.status === 'booked');
  const flights = booked
    .filter((b) => b.kind === 'flight')
    .map((b) => ({ b, f: flightOf(b.detail) }))
    .map(({ b, f }) => ({ b, f, dep: f ? instantOf(f.departDate, f.departTime, f.departTimezone) : null }))
    .filter((x): x is { b: BookingRow; f: Flight; dep: number } => x.f != null && x.dep != null)
    .sort((a, b) => a.dep - b.dep);

  for (const { b, f, dep } of flights) {
    const pax = f.passengerIds.filter((id) => memberIds.has(id));
    const to = pax.length ? pax : both;
    add({
      kind: 'flight',
      targetId: `${b.id}:checkin`,
      at: dep - 24 * HOUR,
      memberIds: to,
      body: `Check-in for ${f.flightNumber} · departs ${formatClock(f.departTime)}`,
      url: bookingUrl(b.id),
      tag: `flight-${b.id}`,
    });

    // The check-in zone is used only when it produced a valid time (a bad zone name would throw below).
    const checkIn = f.checkInBy ? instantOf(f.checkInBy.date, f.checkInBy.time, f.checkInBy.timezone) : null;
    const byTz = checkIn != null ? f.checkInBy!.timezone : f.departTimezone;
    const airportBy = checkIn ?? dep - 3 * HOUR;
    add({
      kind: 'flight',
      targetId: `${b.id}:airport`,
      at: airportBy - HOUR,
      memberIds: to,
      body: `Be at ${airportText(f.from, f.departTerminal)} by ${clockAt(airportBy, byTz)}`,
      url: bookingUrl(b.id),
      tag: `flight-${b.id}`,
    });

    // Passenger details for the outbound flight close 24 h before departure: the
    // open to-dos on that flight due that day get two reminders. Other flight
    // to-dos (check-in, terminals, e-tickets) have their own dates and none.
    if (f.departDate !== s.trip.start_date) continue;
    const deadline = dep - 24 * HOUR;
    const deadlineDate = zonedDate(new Date(deadline), f.departTimezone);
    for (const t of s.tasks) {
      if (t.booking_id !== b.id || t.kind !== 'task' || t.checked || t.deleted_at || t.is_applicable === false) continue;
      if (t.due_date !== deadlineDate) continue;
      const who = t.assignee === 'eren' || t.assignee === 'amy' ? forPeople(t.assignee) : to;
      for (const [lead, label] of [
        [48, 'due in 2 days'],
        [25, 'due in 25 hours'],
      ] as const) {
        add({
          kind: 'flight',
          targetId: `${t.id}:due-${lead}h`,
          at: deadline - lead * HOUR,
          memberIds: who,
          title: 'To-do',
          body: `${clean(t.title)} · ${label}`,
          url: taskUrl(t.id),
          tag: `task-${t.id}`,
        });
      }
    }
  }

  // ── rental car return (times in the trip's zone) ──
  for (const b of booked) {
    if (b.kind !== 'car' || !b.detail || typeof b.detail !== 'object') continue;
    const drop = (b.detail as Record<string, unknown>).dropOff as Record<string, unknown> | undefined;
    const date = str(drop?.date);
    const time = str(drop?.time);
    const ret = instantOf(date, time, s.trip.timezone);
    if (ret == null) continue;
    add({
      kind: 'car',
      targetId: `${b.id}:return-eve`,
      at: instantOf(addDays(date, -1), '20:00', s.trip.timezone) ?? ret - 24 * HOUR,
      memberIds: both,
      body: `Car return tomorrow · ${formatClock(time)}`,
      url: bookingUrl(b.id),
      tag: `car-${b.id}`,
    });
    add({
      kind: 'car',
      targetId: `${b.id}:return-2h`,
      at: ret - 2 * HOUR,
      memberIds: both,
      body: `Car return in 2 hours · ${formatClock(time)}`,
      url: bookingUrl(b.id),
      tag: `car-${b.id}`,
    });
  }

  // ── countdown: 09:00 home time on the home calendar ──
  const firstFlight = flights.find((x) => x.f.departDate === s.trip.start_date);
  for (const [n, text] of [
    [30, 'D-30 · A month until Sydney'],
    [7, 'D-7 · One week until Sydney'],
    [1, 'D-1 · Tomorrow we fly'],
    [0, firstFlight ? `Today’s the day · ${firstFlight.f.flightNumber} departs ${formatClock(firstFlight.f.departTime)}` : 'Today’s the day'],
  ] as const) {
    add({
      kind: 'countdown',
      targetId: n ? `d-${n}` : 'd-day',
      at: instantOf(addDays(s.trip.start_date, -n), '09:00', s.trip.home_timezone),
      memberIds: both,
      body: text,
      url: '?section=days',
      tag: 'countdown',
    });
  }

  // ── partner updates: batched for 5 min, held during quiet hours ──
  // The key names the batch's first and last change: a batch is sent once, and
  // changes that arrive later (or a batch whose marking failed) form a new one.
  const quiet = isQuietHours(s.trip, now, firstFlight?.dep ?? null);
  const pending = s.changes.filter((c) => !c.notified_at && memberIds.has(c.actor_member_id));
  for (const r of s.members) {
    const theirs = pending
      .filter((c) => c.actor_member_id !== r.id)
      .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at) || a.id.localeCompare(b.id));
    if (!theirs.length) continue;
    const oldest = theirs[0];
    const ready = Date.parse(oldest.changed_at) + PARTNER_DELAY;
    if (!(ready <= nowMs) || quiet) continue;

    const actor = s.members.find((m) => m.id === oldest.actor_member_id)?.display_name ?? 'Your partner';
    const count = new Set(theirs.map((c) => `${c.entity}:${c.entity_id}`)).size;
    const dates = new Set(theirs.map((c) => c.day_date));
    const date = dates.size === 1 ? [...dates][0] : null;
    const dayNo = date ? diffDays(date, s.trip.start_date) + 1 : 0;
    const inTrip = dayNo >= 1 && dayNo <= diffDays(s.trip.end_date, s.trip.start_date) + 1;
    out.push({
      memberIds: [r.id],
      kind: 'partner_update',
      targetId: `${oldest.id}:${theirs[theirs.length - 1].id}`,
      scheduledFor: new Date(ready).toISOString(),
      title: TITLES.partner_update,
      body: `${actor} updated ${count} ${count === 1 ? 'item' : 'items'}${inTrip ? ` on Day ${dayNo}` : ''}`,
      url: date ? dayUrl(date) : theirs.every((c) => c.entity === 'booking') ? '?section=ready&view=bookings' : '?section=days',
      tag: 'partner-updates',
      changeIds: theirs.map((c) => c.id),
    });
  }

  return out.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.targetId.localeCompare(b.targetId));
}
