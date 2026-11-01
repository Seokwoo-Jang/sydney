import { describe, expect, it } from 'vitest';
import { zonedToInstant } from '@/lib/time/zone';
import {
  partnerPhrase,
  planNotifications,
  wallToUtc,
  type BookingRow,
  type ChangeRow,
  type DueNotification,
  type ItemRow,
  type MemberRow,
  type Snapshot,
  type TaskRow,
  type TripRow,
} from '@/supabase/functions/send-push/plan';
import {
  b64urlDecode,
  b64urlEncode,
  buildPushRequest,
  concat,
  isPushService,
  vapidAuthorization,
  type VapidKeys,
} from '@/supabase/functions/send-push/webpush';

// Server side of Web Push (plan §8.5). Fictional trip in 2030–31; every key is
// generated for the test run.
const SYD = 'Australia/Sydney';
const SEL = 'Asia/Seoul';
const EREN = 'm-eren';
const AMY = 'm-amy';
const enc = (s: string) => new TextEncoder().encode(s);

// ── webpush ─────────────────────────────────────────────────────

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', concat(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(salt), info: concat(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** The browser's side of RFC 8291: header, key derivation, AES-GCM, delimiter. */
async function decrypt(body: Uint8Array, uaPublic: Uint8Array, uaKey: CryptoKey, auth: Uint8Array): Promise<string> {
  const salt = body.subarray(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', concat(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKey, 256));
  const ikm = await hkdf(auth, ecdh, concat(enc('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(body.subarray(21 + idlen))),
  );
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);
  expect(plain[plain.length - 1]).toBe(0x02);
  return new TextDecoder().decode(plain.subarray(0, -1));
}

async function newBrowser() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { key: pair.privateKey, publicRaw, auth: crypto.getRandomValues(new Uint8Array(16)) };
}

async function newVapid(): Promise<{ vapid: VapidKeys; verifyKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = concat(Uint8Array.of(0x04), b64urlDecode(jwk.x!), b64urlDecode(jwk.y!));
  return {
    vapid: { publicKey: b64urlEncode(publicRaw), privateKey: jwk.d!, subject: 'mailto:push@example.invalid' },
    verifyKey: pair.publicKey,
  };
}

describe('webpush', () => {
  it('builds a request the browser can decrypt', async () => {
    const ua = await newBrowser();
    const { vapid } = await newVapid();
    const payload = JSON.stringify({ title: 'Coming up', body: 'In 30 min · Dinner', url: '?section=days&day=2030-12-28', tag: 'item-x' });
    const endpoint = 'https://fcm.googleapis.com/fcm/send/example-token';
    const req = await buildPushRequest(
      { endpoint, p256dh: b64urlEncode(ua.publicRaw), auth: b64urlEncode(ua.auth) },
      payload,
      vapid,
      { ttl: 3600, urgency: 'high', topic: 'partner-updates' },
    );
    expect(req.url).toBe(endpoint);
    expect(req.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
      Topic: 'partner-updates',
    });
    expect(await decrypt(req.body, ua.publicRaw, ua.key, ua.auth)).toBe(payload);
  });

  it('only posts to known push services', async () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isPushService(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.example.invalid/abc',
      'https://example.invalid/fcm.googleapis.com/abc',
      'https://user@fcm.googleapis.com/abc',
      'https://fcm.googleapis.com:8443/abc',
      'https://push.example.invalid/abc',
      'not a url',
    ]) {
      expect(isPushService(bad), bad).toBe(false);
    }
    const ua = await newBrowser();
    const { vapid } = await newVapid();
    const sub = { endpoint: 'https://push.example.invalid/abc', p256dh: b64urlEncode(ua.publicRaw), auth: b64urlEncode(ua.auth) };
    await expect(buildPushRequest(sub, '{}', vapid, { ttl: 60 })).rejects.toThrow();
  });

  it('signs a VAPID ES256 token for the endpoint origin', async () => {
    const { vapid, verifyKey } = await newVapid();
    const now = Date.UTC(2030, 11, 27, 9, 0);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/example-token', vapid, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, p, sig, k] = m!;
    const text = (s: string) => new TextDecoder().decode(b64urlDecode(s));
    expect(JSON.parse(text(h))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(text(p))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'mailto:push@example.invalid',
    });
    expect(k).toBe(vapid.publicKey);
    const signature = b64urlDecode(sig);
    expect(signature.length).toBe(64);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, signature, enc(`${h}.${p}`))).toBe(true);
  });
});

// ── time ────────────────────────────────────────────────────────

describe('wallToUtc', () => {
  it('matches lib/time/zone across DST gaps and overlaps', () => {
    // Sydney springs forward 2030-10-06 02:00 and falls back 2031-04-06 03:00.
    for (const date of ['2030-10-05', '2030-10-06', '2030-10-07', '2031-04-05', '2031-04-06', '2031-04-07']) {
      for (let h = 0; h < 24; h++) {
        for (const mm of ['00', '30']) {
          const time = `${String(h).padStart(2, '0')}:${mm}`;
          for (const tz of [SYD, SEL]) {
            expect(wallToUtc(date, time, tz).toISOString(), `${date} ${time} ${tz}`).toBe(
              zonedToInstant(date, time, tz).toISOString(),
            );
          }
        }
      }
    }
    expect(wallToUtc('2030-10-06', '02:30', SYD).toISOString()).toBe('2030-10-05T16:30:00.000Z'); // gap: moved forward
    expect(wallToUtc('2031-04-06', '02:30', SYD).toISOString()).toBe('2031-04-05T15:30:00.000Z'); // overlap: earlier
  });
});

// ── plan ────────────────────────────────────────────────────────

const TRIP: TripRow = { id: 'trip-x', start_date: '2030-12-26', end_date: '2031-01-03', timezone: SYD, home_timezone: SEL };
const MEMBERS: MemberRow[] = [
  { id: EREN, profile_key: 'eren', display_name: 'Eren' },
  { id: AMY, profile_key: 'amy', display_name: 'Amy' },
];

const item = (id: string, date: string, time: string, extra: Partial<ItemRow> = {}): ItemRow => ({
  id,
  date,
  time_kind: 'timed',
  start_time: time,
  timezone: SYD,
  status: 'planned',
  participants: 'together',
  title: id,
  place: null,
  sort_order: 0,
  is_example: false,
  deleted_at: null,
  // Columns send-push never selects; the planner must not need them either.
  ...({ notes: 'Private note text' } as object),
  ...extra,
});

const task = (id: string, title: string, extra: Partial<TaskRow> = {}): TaskRow => ({
  id,
  kind: 'task',
  title,
  assignee: null,
  due_date: null,
  checked: false,
  is_applicable: true,
  booking_id: null,
  deleted_at: null,
  ...extra,
});

const flight = (id: string, detail: Record<string, unknown>): BookingRow => ({
  id,
  kind: 'flight',
  status: 'booked',
  deleted_at: null,
  detail: {
    kind: 'flight',
    passengers: [
      { memberId: EREN, reference: 'PAXREF-EREN' },
      { memberId: AMY, reference: 'PAXREF-AMY' },
    ],
    ...detail,
  },
  ...({ reference: 'BOOKREF-X' } as object),
});

const OUT = flight('bk-out', {
  flightNumber: 'SB101',
  from: 'ICN',
  to: 'SYD',
  departDate: '2030-12-26',
  departTime: '21:50',
  departTimezone: SEL,
  departTerminal: '1',
  checkInBy: { date: '2030-12-26', time: '18:50', timezone: SEL },
});
const BACK = flight('bk-back', {
  flightNumber: 'SB202',
  from: 'SYD',
  to: 'ICN',
  departDate: '2031-01-03',
  departTime: '12:15',
  departTimezone: SYD,
  checkInBy: { date: '2031-01-03', time: '09:15', timezone: SYD },
});
const CAR: BookingRow = {
  id: 'bk-car',
  kind: 'car',
  status: 'booked',
  deleted_at: null,
  detail: {
    kind: 'car',
    company: 'Example Cars',
    pickUp: { date: '2030-12-31', time: '10:00', place: 'City' },
    dropOff: { date: '2031-01-03', time: '08:00', place: 'Airport' },
  },
};

const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  trip: TRIP,
  members: MEMBERS,
  items: [],
  bookings: [],
  tasks: [],
  changes: [],
  ...extra,
});

/** Every minute-step of the cron in [from, to], deduplicated like notification_log. */
function simulate(s: Snapshot, from: string, to: string, stepMin = 5): Array<{ member: string; n: DueNotification }> {
  const seen = new Map<string, { member: string; n: DueNotification }>();
  for (let t = Date.parse(from); t <= Date.parse(to); t += stepMin * 60_000) {
    for (const n of planNotifications(s, new Date(t))) {
      for (const member of n.memberIds) {
        const key = `${member}|${n.kind}|${n.targetId}|${n.scheduledFor}`;
        if (!seen.has(key)) seen.set(key, { member, n });
      }
    }
  }
  return [...seen.values()];
}

const lines = (sent: Array<{ member: string; n: DueNotification }>) =>
  sent.map(({ member, n }) => `${n.kind} ${member} ${n.title} | ${n.body}`).sort();

// Day 3 (2030-12-28, AEDT = UTC+11).
const DAY3 = [
  item('it-done', '2030-12-28', '07:30', { status: 'completed' }),
  item('it-breakfast', '2030-12-28', '09:00', { title: 'Breakfast' }),
  item('it-idea', '2030-12-28', '11:00', { status: 'idea', title: 'Maybe a museum' }),
  item('it-cancelled', '2030-12-28', '12:00', { status: 'cancelled', title: 'Cancelled lunch' }),
  item('it-allday', '2030-12-28', '12:00', { time_kind: 'all_day', title: 'All day' }),
  item('it-example', '2030-12-28', '13:00', { is_example: true, title: 'Example row' }),
  item('it-recital', '2030-12-28', '14:30', { participants: 'amy', title: 'Recital visit', place: 'Example Hall' }),
  item('it-lookout', '2030-12-28', '16:00', { participants: 'eren', title: 'Lookout', place: `33°51'24.5"S 151°12'55.1"E` }),
  item('it-ferry', '2030-12-28', '17:00', { participants: 'eren', title: 'Ferry', place: 'Pier 2 · -33.856812, 151.215297' }),
  item('it-dinner', '2030-12-28', '18:30', { status: 'confirmed', title: 'Dinner', place: 'Harbour Example' }),
];

describe('planNotifications', () => {
  it('reminds participants 30 min before planned and confirmed items, as Meet up after solo time', () => {
    const sent = simulate(snap({ items: DAY3 }), '2030-12-27T20:00:00Z', '2030-12-28T10:00:00Z');
    expect(lines(sent)).toEqual(
      [
        `schedule ${EREN} Coming up | In 30 min · Breakfast`,
        `schedule ${AMY} Coming up | In 30 min · Breakfast`,
        `schedule ${AMY} Coming up | In 30 min · Recital visit · Example Hall`,
        `schedule ${EREN} Coming up | In 30 min · Lookout`,
        `schedule ${EREN} Coming up | In 30 min · Ferry · Pier 2`,
        `meet_up ${EREN} Meet up | Meeting up in 30 min · Harbour Example`,
        `meet_up ${AMY} Meet up | Meeting up in 30 min · Harbour Example`,
      ].sort(),
    );
    const recital = sent.find((x) => x.n.targetId === 'it-recital')!.n;
    expect(recital).toMatchObject({
      scheduledFor: '2030-12-28T03:00:00.000Z',
      url: '?section=days&day=2030-12-28&item=it-recital',
      tag: 'item-it-recital',
    });
  });

  it('looks back 15 minutes and no further', () => {
    const s = snap({ items: DAY3 });
    const at = (iso: string) => planNotifications(s, new Date(iso)).filter((n) => n.targetId === 'it-recital');
    expect(at('2030-12-28T02:59:00Z')).toHaveLength(0);
    expect(at('2030-12-28T03:14:00Z').map((n) => n.body)).toEqual(['In 16 min · Recital visit · Example Hall']);
    expect(at('2030-12-28T03:15:00Z')).toHaveLength(0);
  });

  it('strips coordinates and Plus Codes from names', () => {
    const items = [
      item('a', '2030-12-28', '10:00', { title: 'Lookout 46J2+XV Sydney', place: '33.8568° S, 151.2153° E' }),
      item('b', '2030-12-28', '10:00', { title: 'Cove', place: '-33.8568 151.2153' }),
    ];
    const bodies = planNotifications(snap({ items }), new Date('2030-12-27T22:30:00Z')).map((n) => n.body);
    expect(bodies.sort()).toEqual(['In 30 min · Cove', 'In 30 min · Lookout Sydney']);
  });

  it('flights: check-in, airport time, and passenger details for the outbound flight only', () => {
    const tasks = [
      task('td-pax', 'Add passenger details for SB101', { assignee: 'eren', due_date: '2030-12-25', booking_id: 'bk-out' }),
      task('td-pax-done', 'Add passenger details for SB101', { assignee: 'amy', due_date: '2030-12-25', booking_id: 'bk-out', checked: true }),
      task('td-terminal', 'Confirm terminals', { due_date: '2030-12-19', booking_id: 'bk-out' }),
      task('td-checkin', 'Check in for SB202', { due_date: '2031-01-02', booking_id: 'bk-back' }),
    ];
    const s = snap({ bookings: [OUT, BACK], tasks });
    const out = simulate(s, '2030-12-23T00:00:00Z', '2030-12-26T14:00:00Z').filter((x) => x.n.kind === 'flight');
    expect(lines(out)).toEqual(
      [
        `flight ${EREN} To-do | Add passenger details for SB101 · due in 2 days`,
        `flight ${EREN} To-do | Add passenger details for SB101 · due in 25 hours`,
        `flight ${EREN} Flight | Check-in for SB101 · departs 9:50 pm`,
        `flight ${AMY} Flight | Check-in for SB101 · departs 9:50 pm`,
        `flight ${EREN} Flight | Be at ICN T1 by 6:50 pm`,
        `flight ${AMY} Flight | Be at ICN T1 by 6:50 pm`,
      ].sort(),
    );
    const due = out.filter((x) => x.n.targetId.startsWith('td-pax')).map((x) => x.n.scheduledFor).sort();
    expect(due).toEqual(['2030-12-23T12:50:00.000Z', '2030-12-24T11:50:00.000Z']);

    const back = simulate(s, '2031-01-01T12:00:00Z', '2031-01-03T02:00:00Z').filter((x) => x.n.kind === 'flight');
    expect(lines(back)).toEqual(
      [
        `flight ${EREN} Flight | Check-in for SB202 · departs 12:15 pm`,
        `flight ${AMY} Flight | Check-in for SB202 · departs 12:15 pm`,
        `flight ${EREN} Flight | Be at SYD by 9:15 am`,
        `flight ${AMY} Flight | Be at SYD by 9:15 am`,
      ].sort(),
    );
  });

  it('a bad check-in time zone falls back to three hours before departure', () => {
    const bad = flight('bk-bad', {
      flightNumber: 'SB202',
      from: 'SYD',
      departDate: '2031-01-03',
      departTime: '12:15',
      departTimezone: SYD,
      checkInBy: { date: '2031-01-03', time: '09:45', timezone: 'Not/AZone' },
    });
    const s = snap({ bookings: [bad] });
    expect(() => planNotifications(s, new Date('2030-12-28T00:00:00Z'))).not.toThrow();
    const airport = planNotifications(s, new Date('2031-01-02T21:15:00Z')).find((n) => n.targetId === 'bk-bad:airport');
    expect(airport?.body).toBe('Be at SYD by 9:15 am');
  });

  it('rental car return: the evening before at 20:00 and two hours before', () => {
    const sent = simulate(snap({ bookings: [CAR] }), '2031-01-02T00:00:00Z', '2031-01-02T22:00:00Z');
    expect(sent.map(({ member, n }) => `${member} ${n.scheduledFor} ${n.body}`).sort()).toEqual(
      [
        `${AMY} 2031-01-02T09:00:00.000Z Car return tomorrow · 8:00 am`,
        `${AMY} 2031-01-02T19:00:00.000Z Car return in 2 hours · 8:00 am`,
        `${EREN} 2031-01-02T09:00:00.000Z Car return tomorrow · 8:00 am`,
        `${EREN} 2031-01-02T19:00:00.000Z Car return in 2 hours · 8:00 am`,
      ].sort(),
    );
  });

  it('countdown at 09:00 Korean time', () => {
    const s = snap({ bookings: [OUT] });
    const at = (iso: string) => planNotifications(s, new Date(iso)).filter((n) => n.kind === 'countdown').map((n) => n.body);
    expect(at('2030-11-26T00:00:00Z')).toEqual(['D-30 · A month until Sydney']);
    expect(at('2030-12-19T00:00:00Z')).toEqual(['D-7 · One week until Sydney']);
    expect(at('2030-12-25T00:00:00Z')).toEqual(['D-1 · Tomorrow we fly']);
    expect(at('2030-12-26T00:00:00Z')).toEqual(['Today’s the day · SB101 departs 9:50 pm']);
    expect(at('2030-12-25T23:59:00Z')).toEqual([]);
  });
});

describe('partner updates', () => {
  const T0 = '2030-12-29T12:00:00Z'; // 11 pm in Sydney: sent all the same
  const T1 = '2030-12-29T12:00:02Z';
  const change = (id: string, at: string, extra: Partial<ChangeRow> = {}): ChangeRow => ({
    id,
    actor_member_id: AMY,
    entity: 'itinerary',
    entity_id: `it-${id}`,
    day_date: '2030-12-29',
    changed_at: at,
    notified_at: null,
    action: 'edited',
    label: `Plan ${id}`,
    ...extra,
  });
  const partner = (s: Snapshot, iso: string) => planNotifications(s, new Date(iso)).filter((n) => n.kind === 'partner_update');
  const lines = (ns: DueNotification[]) => ns.map((n) => [n.title, n.body, n.url]).sort();

  it('tells only the other profile at once, any hour: who, which section, which day, what', () => {
    const s = snap({ changes: [change('c1', T0, { label: 'Harbour walk' })] });
    expect(partner(s, T0)).toEqual([
      expect.objectContaining({
        memberIds: [EREN],
        targetId: 'c1:c1:1',
        scheduledFor: '2030-12-29T12:00:00.000Z',
        title: 'Amy · Itinerary',
        body: 'Day 4 · Edited “Harbour walk”',
        url: '?section=days&day=2030-12-29',
        tag: 'partner-c1',
        changeIds: ['c1'],
      }),
    ]);
  });

  it('a record saved twice counts once: added + edited is added, added then deleted is nothing', () => {
    const s = snap({
      changes: [
        change('a1', T0, { entity_id: 'x', action: 'added', label: 'Lunch' }),
        change('a2', T1, { entity_id: 'x', action: 'edited', label: 'Lunch at the pier' }),
        change('b1', T0, { entity_id: 'y', action: 'added', label: 'Ferry' }),
        change('b2', T1, { entity_id: 'y', action: 'deleted', label: 'Ferry' }),
      ],
    });
    const [n, ...rest] = partner(s, T1);
    expect(rest).toEqual([]);
    expect(n.body).toBe('Day 4 · Added “Lunch at the pier”');
    expect(n.changeIds).toEqual(['a1', 'b1', 'a2', 'b2']); // every row is reported
  });

  it('one note per section and day; journal text, notes and amounts never show', () => {
    const s = snap({
      changes: [
        change('e1', T0, { entity: 'expense', entity_id: 'e', day_date: null, action: 'added', label: 'Dinner' }),
        change('j1', T0, { entity: 'journal', entity_id: 'j', action: 'added', label: null }),
        change('k1', T0, { entity: 'checklist', entity_id: 'k', day_date: null, action: 'checked', label: 'Passport' }),
        change('l1', T0, { entity: 'library', entity_id: 'l', day_date: null, action: 'added', label: 'Opal guide' }),
        change('p1', T1, { entity: 'photo', entity_id: 'p', action: 'added', label: null }),
      ],
    });
    expect(lines(partner(s, T1))).toEqual([
      ['Amy · Budget', 'Added “Dinner”', '?section=wallet'],
      ['Amy · Checklist', 'Checked off “Passport”', '?section=ready'],
      ['Amy · Journal', 'Day 4 · Added a comment · Added a photo', '?section=journal&day=2030-12-29'],
      ['Amy · Library', 'Added “Opal guide”', '?section=links'],
    ]);
  });

  it('more than four sections at once become one summary', () => {
    const areas: Array<Partial<ChangeRow>> = [
      { entity: 'expense' },
      { entity: 'journal' },
      { entity: 'checklist' },
      { entity: 'library' },
      { entity: 'prelude' },
    ];
    const s = snap({ changes: areas.map((x, k) => change(`s${k}`, T0, { ...x, entity_id: `r${k}`, day_date: null })) });
    const ns = partner(s, T0);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ title: 'Amy · 5 updates', body: 'Budget · Journal · Checklist · Library · Amy’s Prelude' });
    expect(ns[0].changeIds).toHaveLength(5);
  });

  it('bookings link to Bookings; phrases for every kind of record', () => {
    const s = snap({ changes: [change('b1', T0, { entity: 'booking', entity_id: 'bk', day_date: null, label: 'Harbour Hotel' })] });
    expect(partner(s, T0)[0]).toMatchObject({ title: 'Amy · Checklist', body: 'Edited the booking “Harbour Hotel”', url: '?section=ready&view=bookings' });
    expect(partnerPhrase({ entity: 'budget', action: 'edited', label: 'shared' })).toBe('Changed the shared budget');
    expect(partnerPhrase({ entity: 'budget', action: 'edited', label: 'amy' }, { amy: 'Amy' })).toBe('Changed Amy’s budget');
    expect(partnerPhrase({ entity: 'goal', action: 'edited', label: null })).toBe('Edited the goal for this trip');
    expect(partnerPhrase({ entity: 'photo', action: 'edited', label: 'cover' })).toBe('Changed the cover photo');
    expect(partnerPhrase({ entity: 'photo', action: 'edited', label: 'order' })).toBe('Rearranged the photos');
    expect(partnerPhrase({ entity: 'day', action: 'edited', label: 'Into the Hills' })).toBe('Renamed the day “Into the Hills”');
    expect(partnerPhrase({ entity: 'settlement', action: 'added', label: null })).toBe('Added a settlement');
    expect(partnerPhrase({ entity: 'checklist', action: 'unchecked', label: 'Charger' })).toBe('Unchecked “Charger”');
    expect(partnerPhrase({ entity: 'itinerary', action: 'edited', label: 'Lookout -33.8568, 151.2153' })).toBe('Edited “Lookout”');
  });

  it('a notified change is not sent again; my own changes never reach me', () => {
    const s = snap({
      changes: [change('n1', T0, { notified_at: T1 }), change('m1', T0, { actor_member_id: EREN, label: 'Mine' })],
    });
    expect(partner(s, T1).map((n) => [n.memberIds, n.body])).toEqual([[[AMY], 'Day 4 · Edited “Mine”']]);
  });
});

describe('notification text', () => {
  it('never carries booking references, notes or coordinates', () => {
    const s = snap({
      items: DAY3,
      bookings: [OUT, BACK, CAR],
      tasks: [task('td-pax', 'Add passenger details for SB101', { due_date: '2030-12-25', booking_id: 'bk-out' })],
    });
    const all = [
      ...simulate(s, '2030-12-23T00:00:00Z', '2030-12-26T14:00:00Z', 10),
      ...simulate(s, '2030-12-27T20:00:00Z', '2030-12-28T10:00:00Z', 10),
      ...simulate(s, '2031-01-01T12:00:00Z', '2031-01-03T02:00:00Z', 10),
    ];
    expect(all.length).toBeGreaterThan(10);
    const text = JSON.stringify(all.map(({ n }) => [n.title, n.body, n.url, n.tag]));
    for (const secret of ['PAXREF', 'BOOKREF', 'Private note', '°', '151.2', '33.85']) {
      expect(text).not.toContain(secret);
    }
  });
});
