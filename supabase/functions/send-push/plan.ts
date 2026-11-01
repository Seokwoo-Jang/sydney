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
  /** itinerary | day | booking | checklist | document | prelude | goal | journal | photo | library | expense | settlement | budget */
  entity: string;
  entity_id: string;
  day_date: string | null;
  changed_at: string;
  notified_at?: string | null;
  action?: string; // added | edited | deleted | checked | unchecked
  label?: string | null; // the record's title then (photo: 'cover' | 'layout' | 'order'; budget: its scope)
}

export interface Snapshot {
  trip: TripRow;
  members: MemberRow[];
  items: ItemRow[];
  bookings: BookingRow[];
  tasks: TaskRow[];
  changes: ChangeRow[]; // pending (notified_at is null), claimed by this run
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
  changeIds?: string[]; // partner_update: the partner_changes rows it reports
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

  // ── partner updates: each save of the other person, at once, any hour ──
  out.push(...partnerUpdates(s));

  return out.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.targetId.localeCompare(b.targetId));
}

// ── partner updates (owner, 2026-11-01: every section, at once, any hour) ──
// "Amy · Itinerary" / "Day 3 · Edited “Blue Mountains train”". One notification
// per section and day; a record saved several times counts once.

/** The section each kind of record lives in, as the contents name it. */
const AREA: Record<string, string> = {
  itinerary: 'Itinerary',
  day: 'Itinerary',
  booking: 'Checklist',
  checklist: 'Checklist',
  document: 'Checklist',
  prelude: 'Amy’s Prelude',
  goal: 'Amy’s Prelude',
  journal: 'Journal',
  photo: 'Journal',
  library: 'Library',
  expense: 'Budget',
  settlement: 'Budget',
  budget: 'Budget',
};

const AREA_SECTION: Record<string, string> = {
  Itinerary: 'days',
  Checklist: 'ready',
  'Amy’s Prelude': 'prelude',
  Journal: 'journal',
  Library: 'links',
  Budget: 'wallet',
};

/** More sections than this in one run become a single summary. */
const MAX_PARTNER_NOTES = 4;

const VERB: Record<string, string> = {
  added: 'Added',
  edited: 'Edited',
  deleted: 'Deleted',
  checked: 'Checked off',
  unchecked: 'Unchecked',
};

const quoted = (s: string) => `“${s}”`;

/** One record's saves in this run as one: added + edited is added; added then deleted is nothing. */
function settle(list: ChangeRow[]): ChangeRow | null {
  const first = list[0];
  const last = list[list.length - 1];
  if (first.action === 'added' && last.action === 'deleted') return null;
  const action = last.action === 'deleted' ? 'deleted' : list.some((c) => c.action === 'added') ? 'added' : (last.action ?? 'edited');
  const label = [...list].reverse().find((c) => c.label)?.label ?? null;
  return { ...last, action, label };
}

/** What happened, in words. Titles only: never journal text, notes or amounts. */
export function partnerPhrase(c: Pick<ChangeRow, 'entity' | 'action' | 'label'>, names: Record<string, string> = {}): string {
  const verb = VERB[c.action ?? 'edited'] ?? 'Edited';
  const title = clean(c.label, 48);
  switch (c.entity) {
    case 'journal':
      return `${verb} a comment`;
    case 'photo':
      if (c.label === 'cover') return 'Changed the cover photo';
      if (c.label === 'layout') return 'Shuffled the photo layout';
      if (c.label === 'order') return 'Rearranged the photos';
      return `${verb} a photo`;
    case 'settlement':
      return `${verb} a settlement`;
    case 'goal':
      return 'Edited the goal for this trip';
    case 'budget':
      return c.label === 'eren' || c.label === 'amy' ? `Changed ${names[c.label] ?? c.label}’s budget` : 'Changed the shared budget';
    case 'day':
      return title ? `Renamed the day ${quoted(title)}` : 'Edited the day';
    case 'booking':
      return title ? `${verb} the booking ${quoted(title)}` : `${verb} a booking`;
    default:
      return title ? `${verb} ${quoted(title)}` : `${verb} an item`;
  }
}

function partnerUpdates(s: Snapshot): DueNotification[] {
  const out: DueNotification[] = [];
  const memberIds = new Set(s.members.map((m) => m.id));
  const nameOf = (id: string) => s.members.find((m) => m.id === id)?.display_name ?? 'Your partner';
  const names = Object.fromEntries(s.members.map((m) => [m.profile_key, m.display_name]));
  const lastDay = diffDays(s.trip.end_date, s.trip.start_date) + 1;
  const dayNo = (date: string | null) => {
    if (!date) return 0;
    const n = diffDays(date, s.trip.start_date) + 1;
    return n >= 1 && n <= lastDay ? n : 0;
  };
  const byTime = (a: ChangeRow, b: ChangeRow) => Date.parse(a.changed_at) - Date.parse(b.changed_at) || a.id.localeCompare(b.id);
  const pending = s.changes.filter((c) => !c.notified_at && memberIds.has(c.actor_member_id) && AREA[c.entity]).sort(byTime);

  for (const r of s.members) {
    const theirs = pending.filter((c) => c.actor_member_id !== r.id);
    if (!theirs.length) continue;

    // Each record once, then one note per section and day, in the order they happened.
    const perRecord = new Map<string, ChangeRow[]>();
    for (const c of theirs) {
      const key = `${c.entity}:${c.entity_id}`;
      perRecord.set(key, [...(perRecord.get(key) ?? []), c]);
    }
    const notes = new Map<string, { area: string; day: string | null; settled: ChangeRow[]; raw: ChangeRow[] }>();
    for (const list of perRecord.values()) {
      const one = settle(list);
      const head = list[0];
      const area = AREA[head.entity];
      const day = dayNo(head.day_date) ? head.day_date : null;
      const key = `${area}|${day ?? ''}`;
      const note = notes.get(key) ?? { area, day, settled: [], raw: [] };
      if (one) note.settled.push(one);
      note.raw.push(...list);
      notes.set(key, note);
    }
    const live = [...notes.values()].filter((n) => n.settled.length);
    if (!live.length) continue;

    const make = (raw: ChangeRow[], title: string, body: string, url: string): DueNotification => {
      const ids = [...raw].sort(byTime).map((c) => c.id);
      const last = [...raw].sort(byTime)[raw.length - 1];
      return {
        memberIds: [r.id],
        kind: 'partner_update',
        targetId: `${ids[0]}:${ids[ids.length - 1]}:${ids.length}`,
        scheduledFor: new Date(Date.parse(last.changed_at)).toISOString(),
        title,
        body,
        url,
        tag: `partner-${ids[0]}`,
        changeIds: ids,
      };
    };

    if (live.length > MAX_PARTNER_NOTES) {
      const actor = nameOf(live[0].settled[0].actor_member_id);
      const areas = [...new Set(live.map((n) => n.area))];
      const count = live.reduce((t, n) => t + n.settled.length, 0);
      out.push(make(live.flatMap((n) => n.raw), `${actor} · ${count} updates`, areas.join(' · '), `?section=${AREA_SECTION[areas[0]]}`));
      continue;
    }
    for (const n of live) {
      const settled = n.settled.sort(byTime);
      const actor = nameOf(settled[0].actor_member_id);
      const phrases = settled.map((c) => partnerPhrase(c, names));
      const shown = phrases.slice(0, 2).join(' · ') + (phrases.length > 2 ? ` · +${phrases.length - 2} more` : '');
      const body = n.day ? `Day ${dayNo(n.day)} · ${shown}` : shown;
      const section = AREA_SECTION[n.area];
      const onlyBookings = settled.every((c) => c.entity === 'booking');
      const url =
        section === 'days' && n.day
          ? dayUrl(n.day)
          : onlyBookings
            ? '?section=ready&view=bookings'
            : `?section=${section}${n.day && section === 'journal' ? `&day=${n.day}` : ''}`;
      out.push(make(n.raw, `${actor} · ${n.area}`, body, url));
    }
  }
  return out;
}
