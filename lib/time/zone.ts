// Calendar and wall-clock helpers built on Intl only. Results never depend on
// the device timezone: every conversion names an IANA zone explicitly.

export const SYDNEY_TZ = 'Australia/Sydney';
export const SEOUL_TZ = 'Asia/Seoul';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
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
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function zonedParts(instant: Date, tz: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS.indexOf(out.weekday),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function zonedDate(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Offset of `tz` from UTC at `instant`, in minutes. */
function offsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * Wall clock in `tz` → instant. In a DST gap (e.g. 02:30 on spring-forward day)
 * the time is pushed forward by the gap; in an overlap the earlier instant wins.
 */
export function zonedToInstant(date: string, time: string, tz: string): Date {
  const [y, mo, d] = parseDate(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!tm) throw new Error(`Invalid time: ${time}`);
  const wall = Date.UTC(y, mo - 1, d, Number(tm[1]), Number(tm[2]));
  const candidates = new Set<number>();
  for (const probe of [wall - 864e5, wall, wall + 864e5]) {
    candidates.add(wall - offsetMinutes(new Date(probe), tz) * 60000);
  }
  const exact = [...candidates]
    .filter((t) => {
      const p = zonedParts(new Date(t), tz);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
    })
    .sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]);
  // Gap: use the offset in force before the transition, which lands after it.
  return new Date(wall - offsetMinutes(new Date(wall - 864e5), tz) * 60000);
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

/** 'Sat, 26 Dec' */
export function formatDayLabel(date: string): string {
  const [y, m, d] = parseDate(date);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${d} ${MONTHS[m - 1]}`;
}

/** 'HH:mm' of an instant in `tz`. */
export function zonedTime(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
