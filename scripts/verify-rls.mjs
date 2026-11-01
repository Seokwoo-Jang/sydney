// Verifies RLS, RPCs, Storage and Realtime policies against the linked Supabase project.
//
//   node --env-file=.env.local scripts/verify-rls.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (publishable key only)
// and a logged-in, linked Supabase CLI, which creates and removes a throwaway fixture trip
// (dated 2000-01-01). Every write check runs inside that fixture trip; the real trip is only
// read, entered and left. Anonymous auth users created here are not deleted.

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (node --env-file=.env.local ...).');
  process.exit(2);
}

const TABLES = [
  'trips', 'trip_members', 'trip_sessions', 'trip_budgets', 'fx_rates', 'trip_days', 'bookings',
  'itinerary_items', 'resources', 'prelude_activities', 'documents', 'checklist_items', 'expenses',
  'settlements', 'journal_entries', 'file_assets', 'resource_links', 'live_locations',
  'push_subscriptions', 'notification_log',
];
const BUCKET = 'trip-files';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// ── helpers ──────────────────────────────────────────────────────────────

const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
function skip(name, info) {
  console.log(`SKIP  ${name}  (${info})`);
}

/** Runs SQL on the linked project through the Supabase CLI; returns the last statement's rows. */
function sql(text) {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-rls-'));
  const file = path.join(dir, 'query.sql');
  writeFileSync(file, text);
  try {
    const out = execFileSync(process.execPath, [CLI, 'db', 'query', '--linked', '-f', file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out.slice(out.indexOf('{'))).rows ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const newClient = () =>
  createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const users = []; // anonymous auth user ids created by this run
async function signIn(label) {
  const c = newClient();
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`${label}: signInAnonymously failed: ${error.message}`);
  users.push(data.user.id);
  return { c, uid: data.user.id, label };
}

async function rowCount(c, table, filter = (q) => q) {
  const { data, error } = await filter(c.from(table).select('*').limit(1000));
  return { error, n: data?.length ?? 0 };
}

/** Tables from which `c` gets at least one row. */
async function leakingTables(c) {
  const leaks = [];
  for (const t of TABLES) {
    const r = await rowCount(c, t);
    if (!r.error && r.n > 0) leaks.push(t);
  }
  return leaks;
}

/** Subscribes to changes of one row; resolves `got` true when an event arrives. */
async function watchRow(c, table, id, ms = 8000) {
  if (typeof WebSocket === 'undefined') return null;
  let resolveGot;
  const got = new Promise((r) => (resolveGot = r));
  const channel = c.channel(`verify-${randomUUID()}`);
  channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `id=eq.${id}` }, () => resolveGot(true));
  const ready = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        resolve(true);
      }
    });
  });
  if (!ready) {
    await c.removeChannel(channel);
    return null;
  }
  await new Promise((r) => setTimeout(r, 1500)); // the server starts matching shortly after SUBSCRIBED
  return {
    got: (wait) => Promise.race([got, new Promise((r) => setTimeout(() => r(false), wait))]),
    close: () => c.removeChannel(channel),
  };
}

const realTripState = () =>
  sql(`
    select json_build_object(
      'trips', (select sum(version) from public.trips t where t.id = c.active_trip_id),
      'days', (select count(*) || ':' || sum(version) from public.trip_days x where x.trip_id = c.active_trip_id),
      'bookings', (select count(*) || ':' || sum(version) from public.bookings x where x.trip_id = c.active_trip_id),
      'items', (select count(*) || ':' || sum(version) from public.itinerary_items x where x.trip_id = c.active_trip_id),
      'prelude', (select count(*) || ':' || sum(version) from public.prelude_activities x where x.trip_id = c.active_trip_id),
      'checklist', (select count(*) || ':' || sum(version) from public.checklist_items x where x.trip_id = c.active_trip_id),
      'resources', (select count(*) || ':' || sum(version) from public.resources x where x.trip_id = c.active_trip_id),
      'links', (select count(*) from public.resource_links x where x.trip_id = c.active_trip_id),
      'locations', (select count(*) from public.live_locations x where x.trip_id = c.active_trip_id)
    )::text as state
    from private.app_settings c
  `)[0]?.state;

// ── run ──────────────────────────────────────────────────────────────────

const FIXTURE = randomUUID();
const FIXTURE_DAY = randomUUID();
const storageCleanup = []; // [client, path]
let fixtureCreated = false;
let stateBefore = null;
let anonUsersBefore = null;
const clients = [];

async function main() {
  anonUsersBefore = sql(`select count(*)::int as n from auth.users where is_anonymous`)[0].n;
  stateBefore = realTripState();
  if (!stateBefore) throw new Error('No configured trip (private.app_settings). Load the private seed first.');

  // 1. anon key, no sign-in
  const anon = newClient();
  const anonLeaks = await leakingTables(anon);
  check('anon (no sign-in) cannot read any table', anonLeaks.length === 0, anonLeaks.join(', ') || `${TABLES.length} tables`);
  const anonEnter = await anon.rpc('enter_trip', { p_name: 'Eren' });
  check('anon cannot call enter_trip', !!anonEnter.error);
  const anonNow = await anon.rpc('server_now');
  check('anon can call server_now()', !anonNow.error && !Number.isNaN(Date.parse(anonNow.data)));

  // 2. signed in, not entered
  const outsider = await signIn('outsider');
  clients.push(outsider);
  const outLeaks = await leakingTables(outsider.c);
  check('signed in, not entered: no rows from any table', outLeaks.length === 0, outLeaks.join(', ') || `${TABLES.length} tables`);
  const outMe = await outsider.c.rpc('my_member');
  check('signed in, not entered: my_member() is null', !outMe.error && outMe.data === null);
  const outCreate = await outsider.c.rpc('create_row', {
    p_table: 'itinerary',
    p_row: { id: randomUUID(), title: 'x', category: 'rest', time_kind: 'unscheduled' },
  });
  check('signed in, not entered: create_row rejected', outCreate.error?.message === 'not_entered', outCreate.error?.message);

  // 3. wrong names
  const wrong = [];
  for (const name of ['Bob', '', '   ', 'Eren Amy', 'erenn']) {
    const r = await outsider.c.rpc('enter_trip', { p_name: name });
    if (r.error?.message !== 'invalid_name') wrong.push(JSON.stringify(name));
  }
  check('enter_trip rejects other names with invalid_name', wrong.length === 0, wrong.join(', '));

  // 4. Eren and Amy enter the real trip
  const eren = await signIn('eren');
  const amy = await signIn('amy');
  clients.push(eren, amy);
  const erenIn = await eren.c.rpc('enter_trip', { p_name: '  eren ' });
  const erenAgain = await eren.c.rpc('enter_trip', { p_name: 'EREN' });
  const amyIn = await amy.c.rpc('enter_trip', { p_name: 'Amy' });
  check('enter_trip(" eren ") admits Eren', erenIn.data?.profile_key === 'eren' && erenIn.data?.display_name === 'Eren');
  check('enter_trip is idempotent', !erenAgain.error && erenAgain.data?.id === erenIn.data?.id);
  check('enter_trip("Amy") admits Amy', amyIn.data?.profile_key === 'amy' && amyIn.data?.trip_id === erenIn.data?.trip_id);
  const realTrip = erenIn.data.trip_id;
  const me = await amy.c.rpc('my_member');
  check('my_member() returns the entered profile', me.data?.id === amyIn.data?.id);

  for (const who of [eren, amy]) {
    const n = {};
    for (const t of ['trips', 'trip_members', 'trip_days', 'itinerary_items', 'bookings', 'prelude_activities', 'checklist_items']) {
      n[t] = (await rowCount(who.c, t)).n;
    }
    check(
      `entered ${who.label} reads trip data`,
      n.trips === 1 && n.trip_members === 2 && n.trip_days >= 9 && n.itinerary_items > 0 && n.bookings > 0,
      Object.entries(n).map(([k, v]) => `${k}=${v}`).join(' '),
    );
  }
  const sessions = await eren.c.from('trip_sessions').select('auth_user_id');
  check('trip_sessions shows only the caller\'s own session', sessions.data?.length === 1 && sessions.data[0].auth_user_id === eren.uid);
  const realDay = (await eren.c.from('trip_days').select('id').limit(1)).data[0].id;

  // 5. direct writes to profiles, sessions, fx_rates, notification_log
  const insMember = await eren.c.from('trip_members').insert({ trip_id: realTrip, profile_key: 'eren', display_name: 'Eren' });
  check('cannot insert into trip_members directly', !!insMember.error);
  const insSession = await outsider.c
    .from('trip_sessions')
    .insert({ trip_id: realTrip, auth_user_id: outsider.uid, member_id: erenIn.data.id });
  check('cannot insert into trip_sessions directly (self-admit)', !!insSession.error);
  const updSession = await eren.c.from('trip_sessions').update({ member_id: amyIn.data.id }).eq('auth_user_id', eren.uid).select();
  check('cannot update trip_sessions directly', !!updSession.error);
  check('outsider is still not a member', (await rowCount(outsider.c, 'trips')).n === 0);
  const insFx = await eren.c.from('fx_rates').insert({ rate_date: '2000-01-01', rate: 1 });
  check('cannot write fx_rates', !!insFx.error);
  check('members can read fx_rates', !(await eren.c.from('fx_rates').select('*').limit(1)).error);
  check('no client access to notification_log', !!(await eren.c.from('notification_log').select('*').limit(1)).error);
  const outInsert = await outsider.c
    .from('itinerary_items')
    .insert({ id: randomUUID(), trip_id: realTrip, day_id: realDay, title: 'x', category: 'rest', time_kind: 'unscheduled' });
  check('signed in, not entered: direct insert rejected', !!outInsert.error);

  const trip = (await eren.c.from('trips').select('title, version').single()).data;
  const staleTrip = await eren.c.rpc('update_trip', { p_patch: { title: trip.title }, p_expected_version: trip.version + 100 });
  check('update_trip with a stale version → conflict', staleTrip.data?.status === 'conflict' && staleTrip.data.row.version === trip.version);

  // 6. revoked session (outsider enters, then leaves)
  await outsider.c.rpc('enter_trip', { p_name: 'eren' });
  const readsBefore = (await rowCount(outsider.c, 'trip_days')).n;
  await outsider.c.rpc('leave_trip');
  const revokedLeaks = await leakingTables(outsider.c);
  const revokedCreate = await outsider.c.rpc('create_row', {
    p_table: 'itinerary',
    p_row: { id: randomUUID(), day_id: realDay, title: 'x', category: 'rest', time_kind: 'unscheduled' },
  });
  const revokedUpload = await outsider.c.storage.from(BUCKET).upload(`${realTrip}/${randomUUID()}/verify.png`, PNG, { contentType: 'image/png' });
  if (!revokedUpload.error) storageCleanup.push([eren.c, revokedUpload.data.path]);
  check('after leave_trip: cannot read', readsBefore > 0 && revokedLeaks.length === 0, revokedLeaks.join(', '));
  check('after leave_trip: cannot write (create_row, storage)', revokedCreate.error?.message === 'not_entered' && !!revokedUpload.error);
  check('after leave_trip: my_member() is null', (await outsider.c.rpc('my_member')).data === null);

  // 7. fixture trip (via CLI SQL): two devices for fixture Eren, one for fixture Amy
  const fxEren = await signIn('fixture-eren');
  const fxEren2 = await signIn('fixture-eren-device-2');
  const fxAmy = await signIn('fixture-amy');
  clients.push(fxEren, fxEren2, fxAmy);
  const fixture = sql(`
    insert into public.trips (id, title, start_date, end_date) values ('${FIXTURE}', 'verify-rls fixture', '2000-01-01', '2000-01-02');
    select private.ensure_members('${FIXTURE}');
    insert into public.trip_days (id, trip_id, date, day_number, title) values ('${FIXTURE_DAY}', '${FIXTURE}', '2000-01-01', 1, 'fixture');
    insert into public.trip_sessions (trip_id, auth_user_id, member_id)
    select '${FIXTURE}', u.uid, m.id
    from (values ('${fxEren.uid}'::uuid, 'eren'), ('${fxEren2.uid}'::uuid, 'eren'), ('${fxAmy.uid}'::uuid, 'amy')) u (uid, k)
    join public.trip_members m on m.trip_id = '${FIXTURE}' and m.profile_key = u.k;
    select json_object_agg(profile_key, id) as members from public.trip_members where trip_id = '${FIXTURE}';
  `);
  fixtureCreated = true;
  const fm = fixture[0].members;

  // 8. cross-trip isolation
  check('real-trip member cannot read the fixture trip', (await rowCount(eren.c, 'trip_days', (q) => q.eq('trip_id', FIXTURE))).n === 0);
  const fxTrips = (await fxEren.c.from('trips').select('id')).data ?? [];
  check('fixture member sees only its own trip', fxTrips.length === 1 && fxTrips[0].id === FIXTURE);
  check('fixture member cannot read real-trip items', (await rowCount(fxEren.c, 'itinerary_items', (q) => q.eq('trip_id', realTrip))).n === 0);
  const crossFk = await fxEren.c.rpc('create_row', {
    p_table: 'itinerary',
    p_row: { id: randomUUID(), day_id: realDay, date: '2000-01-01', title: 'x', category: 'rest', time_kind: 'unscheduled' },
  });
  check('create_row rejects a day_id from another trip (composite FK)', crossFk.error?.code === '23503', crossFk.error?.code);
  const crossInsert = await fxEren.c
    .from('itinerary_items')
    .insert({ id: randomUUID(), trip_id: realTrip, day_id: realDay, date: '2000-01-01', title: 'x', category: 'rest', time_kind: 'unscheduled' });
  check('direct insert into another trip rejected by RLS', !!crossInsert.error);
  const crossUpdate = await fxEren.c.rpc('update_row', { p_table: 'days', p_id: realDay, p_patch: { title: 'x' }, p_expected_version: 1 });
  check('update_row on another trip\'s row → not_found', crossUpdate.data?.status === 'not_found');
  const crossAsset = await fxEren.c.rpc('create_row', {
    p_table: 'assets',
    p_row: { id: randomUUID(), storage_path: `${realTrip}/${randomUUID()}/x.png`, mime: 'image/png', kind: 'photo', bytes: 10 },
  });
  check('file_assets.storage_path must start with its own trip id', crossAsset.error?.code === '23514', crossAsset.error?.code);

  // 9. create_row idempotency and server-owned columns
  const itemId = randomUUID();
  const payload = {
    id: itemId, day_id: FIXTURE_DAY, title: 'verify item', category: 'rest', time_kind: 'unscheduled',
    trip_id: realTrip, created_by: fm.amy, version: 99,
  };
  const c1 = await fxEren.c.rpc('create_row', { p_table: 'itinerary', p_row: payload });
  const c2 = await fxEren.c.rpc('create_row', { p_table: 'itinerary_items', p_row: { ...payload, title: 'changed' } });
  const c3 = await fxAmy.c.rpc('create_row', { p_table: 'itinerary', p_row: payload });
  check(
    'create_row forces trip_id / created_by / version',
    c1.data?.trip_id === FIXTURE && c1.data?.created_by === fm.eren && c1.data?.version === 1 && c1.data?.date === '2000-01-01',
    c1.error?.message,
  );
  check(
    'create_row is idempotent by id',
    c2.data?.id === itemId && c2.data?.title === 'verify item' && c2.data?.created_at === c1.data?.created_at && c3.data?.id === itemId,
  );
  const badCol = await fxEren.c.rpc('create_row', { p_table: 'itinerary', p_row: { ...payload, id: randomUUID(), nope: 1 } });
  const badTable = await fxEren.c.rpc('create_row', { p_table: 'trip_members', p_row: { id: randomUUID() } });
  check('create_row rejects unknown columns and tables', badCol.error?.message === 'unknown_column' && badTable.error?.message === 'unknown_table');

  // 10. Realtime reaches members of the row's trip only
  const fxWatch = await watchRow(fxAmy.c, 'itinerary_items', itemId);
  const realWatch = await watchRow(eren.c, 'itinerary_items', itemId);

  // 11. concurrent update_row with the same expected version
  const [u1, u2] = await Promise.all([
    fxEren.c.rpc('update_row', { p_table: 'itinerary', p_id: itemId, p_patch: { title: 'from eren' }, p_expected_version: 1 }),
    fxAmy.c.rpc('update_row', { p_table: 'itinerary', p_id: itemId, p_patch: { title: 'from amy' }, p_expected_version: 1 }),
  ]);
  const statuses = [u1.data?.status, u2.data?.status].sort().join(',');
  check('concurrent update_row, same version → one ok, one conflict', statuses === 'conflict,ok', statuses);
  const [win, lose] = u1.data?.status === 'ok' ? [u1, u2] : [u2, u1];
  check(
    'conflict returns the latest row; updated_by is the winner',
    lose.data?.row?.version === 2 && lose.data.row.title === win.data?.row?.title &&
      win.data.row.updated_by === (win === u1 ? fm.eren : fm.amy),
  );

  if (fxWatch && realWatch) {
    const [fxGot, realGot] = await Promise.all([fxWatch.got(5000), realWatch.got(1500)]);
    check('realtime: fixture member receives the change', fxGot === true);
    check('realtime: member of another trip receives nothing', realGot === false);
  } else {
    skip('realtime checks', 'channel did not subscribe');
  }
  await fxWatch?.close();
  await realWatch?.close();

  // 12. Prelude activity follows its linked item
  const actId = randomUUID();
  const act = await fxAmy.c.rpc('create_row', {
    p_table: 'prelude',
    p_row: { id: actId, kind: 'performance', title: 'verify activity', itinerary_item_id: itemId, status: 'planned' },
  });
  check('activity linked to an Idea item stays idea', act.data?.status === 'idea', act.error?.message);
  const adopt = await fxEren.c.rpc('update_row', { p_table: 'itinerary', p_id: itemId, p_patch: { status: 'planned' }, p_expected_version: 2 });
  const actAfterAdopt = (await fxAmy.c.from('prelude_activities').select('status').eq('id', actId).single()).data;
  check('adopting the item (planned) makes the activity planned', adopt.data?.status === 'ok' && actAfterAdopt?.status === 'planned');

  // 13. soft delete
  const del = await fxEren.c.rpc('soft_delete_row', { p_table: 'itinerary', p_id: itemId, p_expected_version: 3 });
  check('soft_delete_row → ok with deleted_at', del.data?.status === 'ok' && !!del.data.row.deleted_at);
  const visible = await fxEren.c.from('itinerary_items').select('id').eq('id', itemId).is('deleted_at', null);
  check('soft-deleted row is hidden by the deleted_at filter', !visible.error && visible.data.length === 0);
  const actAfterDelete = (await fxAmy.c.from('prelude_activities').select('status, itinerary_item_id').eq('id', actId).single()).data;
  check('deleting the item unlinks the activity (back to idea)', actAfterDelete?.itinerary_item_id === null && actAfterDelete?.status === 'idea');
  const updDeleted = await fxEren.c.rpc('update_row', { p_table: 'itinerary', p_id: itemId, p_patch: { title: 'x' }, p_expected_version: 4 });
  check('update_row on a soft-deleted row → conflict', updDeleted.data?.status === 'conflict');
  const missing = await fxEren.c.rpc('update_row', { p_table: 'itinerary', p_id: randomUUID(), p_patch: {}, p_expected_version: 1 });
  check('update_row on an unknown id → not_found', missing.data?.status === 'not_found');
  const hardDelete = await fxEren.c.from('itinerary_items').delete().eq('id', itemId);
  check('hard delete of content rows is not allowed', !!hardDelete.error);

  // 14. live location (§7.8)
  const t0 = Date.now() - 60_000;
  const at = (s) => new Date(t0 + s * 1000).toISOString();
  const loc = (c, s, takeover) =>
    c.rpc('share_location', { p_lat: -33.8688, p_lng: 151.2093, p_accuracy_m: 20, p_measured_at: at(s), p_takeover: takeover });
  const l1 = await loc(fxEren.c, 10, true);
  const l2 = await loc(fxEren.c, 5, false);
  const l3 = await loc(fxEren.c, 20, false);
  check('share_location: takeover → sharing', l1.data?.status === 'ok' && l1.data.row.is_sharing === true);
  check('share_location: older measured_at → stale', l2.data?.status === 'stale');
  check('share_location: newer measured_at → ok', l3.data?.status === 'ok');
  const l4 = await loc(fxEren2.c, 25, true);
  const l5 = await loc(fxEren.c, 30, false);
  check('second device takes over; first device is ignored', l4.data?.status === 'ok' && l5.data?.status === 'not_sharing_device');
  const amyUpd = await fxAmy.c.from('live_locations').update({ lat: 0 }).eq('member_id', fm.eren).select();
  const amyDel = await fxAmy.c.from('live_locations').delete().eq('member_id', fm.eren).select();
  const erenRow = (await fxEren.c.from('live_locations').select('lat').eq('member_id', fm.eren)).data ?? [];
  check('cannot update the other member\'s live_location', !!amyUpd.error);
  check('cannot delete the other member\'s live_location', (amyDel.error || amyDel.data.length === 0) && erenRow.length === 1 && erenRow[0].lat !== 0);
  const stop = await fxEren.c.rpc('stop_sharing');
  const l6 = await loc(fxEren2.c, 40, false);
  check('stop_sharing (any device) keeps the last position, stops all devices', stop.data?.row?.is_sharing === false && l6.data?.status === 'not_sharing_device');
  await fxEren2.c.rpc('clear_my_location');
  check('clear_my_location deletes the row', (await rowCount(fxAmy.c, 'live_locations', (q) => q.eq('member_id', fm.eren))).n === 0);

  // 15. Storage
  const own = `${FIXTURE}/${randomUUID()}/verify.png`;
  const up = await fxEren.c.storage.from(BUCKET).upload(own, PNG, { contentType: 'image/png' });
  if (!up.error) storageCleanup.push([fxEren.c, own]);
  check('storage: upload to own trip path', !up.error, up.error?.message);
  const signed = await fxAmy.c.storage.from(BUCKET).createSignedUrl(own, 60);
  let fetched = 0;
  if (signed.data?.signedUrl) {
    const res = await fetch(signed.data.signedUrl);
    fetched = res.ok ? (await res.arrayBuffer()).byteLength : -res.status;
  }
  check('storage: signed URL works for a member of the trip', fetched === PNG.length, String(fetched));
  const otherSign = await eren.c.storage.from(BUCKET).createSignedUrl(own, 60);
  const anonSign = await anon.storage.from(BUCKET).createSignedUrl(own, 60);
  check('storage: other trip / anon cannot sign the object', !!otherSign.error && !!anonSign.error);
  const denied = [];
  for (const p of [`${realTrip}/${randomUUID()}/verify.png`, `${randomUUID()}/${randomUUID()}/verify.png`, `not-a-trip/${randomUUID()}/verify.png`, `${FIXTURE}/verify.png`]) {
    const r = await fxEren.c.storage.from(BUCKET).upload(p, PNG, { contentType: 'image/png' });
    if (!r.error) {
      denied.push(p.split('/')[0] === realTrip ? 'real-trip path' : p);
      storageCleanup.push([p.startsWith(realTrip) ? eren.c : fxEren.c, p]);
    }
  }
  check('storage: upload outside own trip folder denied', denied.length === 0, denied.join(', '));
  const txt = await fxEren.c.storage.from(BUCKET).upload(`${FIXTURE}/${randomUUID()}/v.txt`, Buffer.from('x'), { contentType: 'text/plain' });
  if (!txt.error) storageCleanup.push([fxEren.c, txt.data.path]);
  check('storage: disallowed MIME type rejected', !!txt.error);
}

async function cleanup() {
  for (const [c, p] of storageCleanup) {
    const { data, error } = await c.storage.from(BUCKET).remove([p]);
    if (error || !data?.length) console.log(`WARN  could not remove storage object ${p}: ${error?.message ?? 'not removed'}`);
  }
  for (const { c } of clients) await c.rpc('leave_trip');
  if (fixtureCreated) sql(`delete from public.trips where id = '${FIXTURE}'`);
  if (users.length) {
    sql(`delete from public.trip_sessions where auth_user_id = any (array[${users.map((u) => `'${u}'`).join(',')}]::uuid[])`);
  }
}

let failed = false;
try {
  await main();
} catch (e) {
  failed = true;
  console.error(`ERROR ${e?.message ?? e}`);
} finally {
  try {
    await cleanup();
    const left = sql(`
      select (select count(*) from public.trips where id = '${FIXTURE}')::int as fixture_trips,
             (select count(*) from public.trip_sessions where auth_user_id = any (array[${users.map((u) => `'${u}'`).join(',') || 'null'}]::uuid[]))::int as sessions,
             (select count(*)::int from auth.users where is_anonymous) as anon_users
    `)[0];
    check('cleanup: fixture trip and test sessions removed', left.fixture_trips === 0 && left.sessions === 0);
    const stateAfter = realTripState();
    check('real trip content unchanged', !!stateBefore && stateAfter === stateBefore);
    console.log(`INFO  anonymous auth users: ${anonUsersBefore} before, ${left.anon_users} after (${users.length} created by this run, not deleted)`);
  } catch (e) {
    failed = true;
    console.error(`ERROR cleanup: ${e?.message ?? e}`);
  }
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed${fails ? `, ${fails} failed` : ''}`);
process.exit(fails || failed ? 1 : 0);
