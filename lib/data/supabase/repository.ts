// Supabase repository (plan §8). Every write goes through the RPCs in
// supabase/migrations/*_rpc.sql; reads use RLS-protected selects. Rows come back
// snake_case and are mapped 1:1 by ./mappers.
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { FileAsset, LiveLocation, Member, ResourceLink, SaveResult, Trip, TripBudget } from '../../types';
import {
  ENTITY_NAMES,
  RepositoryError,
  type ChangeEvent,
  type EnterResult,
  type EntityName,
  type EntityRowMap,
  type LocationFix,
  type LocationsSnapshot,
  type NewRow,
  type RowPatch,
  type ShareStatus,
  type TripPatch,
  type TripRepository,
  type TripSnapshot,
  type UploadFile,
} from '../repository';
import { newId, normalizeEntryName } from '../session';
import { BUCKET, getSupabase } from './client';
import {
  TABLE,
  TABLE_ENTITY,
  budgetFrom,
  fxFrom,
  isoInstant,
  linkFrom,
  linkTo,
  locationFrom,
  memberFrom,
  rowFrom,
  rowTo,
  tripFrom,
  tripPatchTo,
  type Json,
} from './mappers';

// ── errors ────────────────────────────────────────────────────────
interface ErrLike {
  message?: string;
  code?: string;
  status?: number;
}

const MESSAGES: Record<string, string> = {
  not_entered: 'Your entry has ended on this device. Enter your name again.',
  not_signed_in: 'Your entry has ended on this device. Enter your name again.',
  trip_not_configured: 'The trip isn’t set up yet.',
  unknown_column: 'This change couldn’t be saved (unknown field).',
  invalid_payload: 'This change couldn’t be saved.',
  invalid_id: 'This change couldn’t be saved.',
  id_conflict: 'This change couldn’t be saved.',
  invalid_location: 'That location couldn’t be saved.',
  '23503': 'A linked entry no longer exists.',
  '23505': 'This entry already exists.',
  '23514': 'Some values aren’t valid.',
  '22P02': 'Some values aren’t valid.',
  '42501': 'You don’t have access to this entry.',
};

function isNetwork(e: ErrLike | null | undefined, status?: number): boolean {
  if (status === 0 || (status !== undefined && status >= 500)) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|connection/i.test(e?.message ?? '');
}

function toRepoError(e: unknown, status?: number): RepositoryError {
  if (e instanceof RepositoryError) return e;
  const err = (e ?? {}) as ErrLike;
  const st = status ?? err.status;
  if (isNetwork(err, st)) return new RepositoryError('network', 'Couldn’t reach the server. Check the connection and try again.');
  const known = (err.message && MESSAGES[err.message]) || (err.code && MESSAGES[err.code]);
  return new RepositoryError('unknown', known || 'Something went wrong. Try again.');
}

/** Unwraps a supabase-js `{ data, error, status }` result or throws a RepositoryError. */
function must<T>(res: { data: T | null; error: unknown; status?: number }): T {
  if (res.error) throw toRepoError(res.error, res.status);
  return res.data as T;
}

const fail = (e: unknown): { ok: false; reason: 'error'; message: string } => ({
  ok: false,
  reason: 'error',
  message: toRepoError(e).message,
});

interface WriteResult {
  status: 'ok' | 'conflict' | 'not_found';
  row: Json | null;
}

/** RPC write result → SaveResult. `not_found` = removed elsewhere (or no access): a conflict without a latest row. */
function toSave<T>(res: WriteResult, map: (row: Json) => T): SaveResult<T> {
  if (res.status === 'ok' && res.row) return { ok: true, row: map(res.row) };
  if (res.status === 'conflict') return { ok: false, reason: 'conflict', latest: res.row ? map(res.row) : null };
  return { ok: false, reason: 'conflict', latest: null };
}

// ── signed URLs ───────────────────────────────────────────────────
const PHOTO_TTL_S = 60 * 60; // display URLs: 1 h, re-signed before expiry
const PHOTO_REUSE_MS = 15 * 60 * 1000; // re-sign when less than this is left
const OPEN_TTL_S = 5 * 60; // "Open document"

/** Keeps a file name storage-safe: ASCII letters, digits, dot, dash, underscore. */
export function safeFileName(name: string, fallback = 'file'): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return `${base || fallback}${ext ? `.${ext}` : ''}`;
}

// ── repository ────────────────────────────────────────────────────
class SupabaseRepository implements TripRepository {
  readonly kind = 'supabase' as const;
  readonly serverManagesPreludeStatus = true;
  private sb = getSupabase();
  private member: Member | null = null;
  private sessionId: string | null = null;
  private urlCache = new Map<string, { url: string; expiresAt: number }>();

  private tripId(): string {
    if (!this.member) throw new RepositoryError('unknown', MESSAGES.not_entered);
    return this.member.tripId;
  }

  // ── session (plan §8.1) ──
  async getSession(): Promise<Member | null> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    const me = must(await this.sb.rpc('my_member'));
    this.member = me ? memberFrom(me as Json) : null;
    return this.member;
  }

  async enter(name: string): Promise<EnterResult> {
    if (!normalizeEntryName(name)) return { ok: false, reason: 'invalid_name' };
    try {
      const { data } = await this.sb.auth.getSession();
      if (!data.session) {
        const res = await this.sb.auth.signInAnonymously();
        if (res.error) throw toRepoError(res.error, res.error.status);
      }
      const res = await this.sb.rpc('enter_trip', { p_name: name.trim() });
      if (res.error?.message === 'invalid_name') return { ok: false, reason: 'invalid_name' };
      this.member = memberFrom(must(res) as Json);
      this.sessionId = null;
      return { ok: true, member: this.member };
    } catch (e) {
      return { ok: false, reason: 'error', message: toRepoError(e).message };
    }
  }

  async leave(): Promise<void> {
    try {
      await this.sb.rpc('leave_trip'); // revokes this browser's session, stops its location sharing
    } catch {
      // Offline: the local exit below still happens; the server session stays until the next entry.
    }
    this.member = null;
    this.sessionId = null;
    this.urlCache.clear();
    await this.sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }

  async serverTimeOffset(): Promise<number> {
    const t0 = Date.now();
    const iso = must(await this.sb.rpc('server_now')) as string;
    const t1 = Date.now();
    const server = Date.parse(isoInstant(iso));
    if (Number.isNaN(server)) throw new RepositoryError('unknown', 'Invalid server time.');
    return server - (t0 + t1) / 2; // midpoint of the round trip
  }

  // ── reads ──
  async loadSnapshot(): Promise<TripSnapshot> {
    const trip = this.tripId();
    const sb = this.sb;
    const live = (table: string) => sb.from(table).select('*').eq('trip_id', trip).is('deleted_at', null);
    const lists = ENTITY_NAMES.map((e) => live(TABLE[e]));
    const [tripRes, membersRes, budgetsRes, fxRes, linksRes, ...listRes] = await Promise.all([
      sb.from('trips').select('*').eq('id', trip),
      sb.from('trip_members').select('*').eq('trip_id', trip),
      sb.from('trip_budgets').select('*').eq('trip_id', trip),
      sb.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(400),
      sb.from('resource_links').select('*').eq('trip_id', trip),
      ...lists,
    ]);
    const trips = must(tripRes) as Json[];
    if (!trips.length) throw new RepositoryError('unknown', MESSAGES.not_entered);
    const out = {
      trip: tripFrom(trips[0]),
      members: (must(membersRes) as Json[]).map(memberFrom),
      budgets: (must(budgetsRes) as Json[]).map(budgetFrom),
      fxRates: (must(fxRes) as Json[]).map(fxFrom),
      resourceLinks: (must(linksRes) as Json[]).map(linkFrom),
    } as TripSnapshot;
    ENTITY_NAMES.forEach((e, i) => {
      (out as unknown as Record<EntityName, unknown[]>)[e] = (must(listRes[i]) as Json[]).map((r) => rowFrom(e, r));
    });
    out.assets = await this.withUrls(out.assets);
    return out;
  }

  /** Adds short-lived display URLs to photos (one batch call; cached until close to expiry). */
  private async withUrls(assets: FileAsset[]): Promise<FileAsset[]> {
    const now = Date.now();
    const wanted = new Set<string>();
    for (const a of assets) {
      if (a.kind !== 'photo') continue;
      wanted.add(a.displayPath ?? a.storagePath);
      wanted.add(a.thumbPath ?? a.displayPath ?? a.storagePath);
    }
    const missing = [...wanted].filter((p) => {
      const c = this.urlCache.get(p);
      return !c || c.expiresAt - now < PHOTO_REUSE_MS;
    });
    if (missing.length) {
      const res = await this.sb.storage.from(BUCKET).createSignedUrls(missing, PHOTO_TTL_S);
      for (const s of res.data ?? []) {
        if (s.path && s.signedUrl && !s.error) this.urlCache.set(s.path, { url: s.signedUrl, expiresAt: now + PHOTO_TTL_S * 1000 });
      }
    }
    return assets.map((a) => {
      if (a.kind !== 'photo') return a;
      const url = this.urlCache.get(a.displayPath ?? a.storagePath)?.url;
      const thumbUrl = this.urlCache.get(a.thumbPath ?? a.displayPath ?? a.storagePath)?.url ?? url;
      return url ? { ...a, url, thumbUrl } : a;
    });
  }

  private async asset<E extends EntityName>(entity: E, row: EntityRowMap[E]): Promise<EntityRowMap[E]> {
    if (entity !== 'assets') return row;
    try {
      return (await this.withUrls([row as FileAsset]))[0] as EntityRowMap[E];
    } catch {
      return row;
    }
  }

  subscribe(onChange: (e: ChangeEvent) => void): () => void {
    let closed = false;
    let down = false;
    let catchUp: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = this.sb.channel(`trip-${this.member?.tripId ?? 'none'}-${newId()}`);
    for (const [table, entity] of Object.entries(TABLE_ENTITY)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (!closed) onChange({ type: 'changed', entity });
      });
    }
    channel.subscribe((status) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') {
        // The server starts matching ~1–1.5 s after SUBSCRIBED: refetch once
        // then to cover anything written between the last load and now.
        if (catchUp) clearTimeout(catchUp);
        catchUp = setTimeout(() => !closed && onChange({ type: 'reconnected' }), 1500);
        down = false;
      } else if (!down) {
        down = true; // CHANNEL_ERROR / TIMED_OUT / CLOSED: supabase-js rejoins with backoff
        onChange({ type: 'disconnected' });
      }
    });
    // Photo URLs are short-lived: ask for a refetch before they expire.
    const expiry = setInterval(() => {
      const soon = Date.now() + PHOTO_REUSE_MS;
      for (const c of this.urlCache.values()) {
        if (c.expiresAt < soon) {
          onChange({ type: 'changed', entity: 'assets' });
          return;
        }
      }
    }, 5 * 60 * 1000);
    return () => {
      closed = true;
      if (catchUp) clearTimeout(catchUp);
      clearInterval(expiry);
      if (channel) void this.sb.removeChannel(channel);
      channel = null;
    };
  }

  // ── writes ──
  async create<E extends EntityName>(entity: E, row: NewRow<EntityRowMap[E]>): Promise<SaveResult<EntityRowMap[E]>> {
    try {
      const data = must(await this.sb.rpc('create_row', { p_table: entity, p_row: rowTo(entity, row as Record<string, unknown>, true) }));
      return { ok: true, row: await this.asset(entity, rowFrom(entity, data as Json)) };
    } catch (e) {
      return fail(e);
    }
  }

  async update<E extends EntityName>(
    entity: E,
    id: string,
    patch: RowPatch<EntityRowMap[E]>,
    expectedVersion: number,
  ): Promise<SaveResult<EntityRowMap[E]>> {
    try {
      const res = must(
        await this.sb.rpc('update_row', {
          p_table: entity,
          p_id: id,
          p_patch: rowTo(entity, patch as Record<string, unknown>),
          p_expected_version: expectedVersion,
        }),
      ) as WriteResult;
      const out = toSave(res, (r) => rowFrom(entity, r));
      if (out.ok) return { ok: true, row: await this.asset(entity, out.row) };
      if (out.reason === 'conflict' && out.latest) return { ...out, latest: await this.asset(entity, out.latest) };
      return out;
    } catch (e) {
      return fail(e);
    }
  }

  async softDelete<E extends EntityName>(entity: E, id: string, expectedVersion: number): Promise<SaveResult<EntityRowMap[E]>> {
    try {
      const res = must(
        await this.sb.rpc('soft_delete_row', { p_table: entity, p_id: id, p_expected_version: expectedVersion }),
      ) as WriteResult;
      return toSave(res, (r) => rowFrom(entity, r));
    } catch (e) {
      return fail(e);
    }
  }

  async updateTrip(patch: TripPatch, expectedVersion: number): Promise<SaveResult<Trip>> {
    try {
      const res = must(
        await this.sb.rpc('update_trip', { p_patch: tripPatchTo(patch), p_expected_version: expectedVersion }),
      ) as WriteResult;
      return toSave(res, tripFrom);
    } catch (e) {
      return fail(e);
    }
  }

  async setBudget(budget: Omit<TripBudget, 'tripId'>): Promise<SaveResult<TripBudget>> {
    try {
      const res = must(
        await this.sb.rpc('set_budget', { p_scope: budget.scope, p_amount_minor: budget.amountMinor, p_currency: budget.currency }),
      ) as WriteResult;
      // A null amount removes the scope; the UI always sends a number.
      return { ok: true, row: res.row ? budgetFrom(res.row) : { ...budget, tripId: this.tripId() } };
    } catch (e) {
      return fail(e);
    }
  }

  async linkResource(link: Omit<ResourceLink, 'tripId'>): Promise<SaveResult<ResourceLink>> {
    try {
      const data = must(await this.sb.rpc('create_row', { p_table: 'resourceLinks', p_row: linkTo(link) }));
      return { ok: true, row: linkFrom(data as Json) };
    } catch (e) {
      return fail(e);
    }
  }

  async unlinkResource(id: string): Promise<SaveResult<ResourceLink>> {
    try {
      const rows = must(await this.sb.from('resource_links').delete().eq('id', id).select()) as Json[];
      if (!rows.length) return { ok: false, reason: 'error', message: 'This link no longer exists.' };
      return { ok: true, row: linkFrom(rows[0]) };
    } catch (e) {
      return fail(e);
    }
  }

  // ── files ──
  async uploadFiles(files: UploadFile[]): Promise<string[]> {
    const folder = `${this.tripId()}/${newId()}`;
    const done: string[] = [];
    try {
      for (const f of files) {
        const path = `${folder}/${safeFileName(f.name)}`;
        const res = await this.sb.storage.from(BUCKET).upload(path, f.blob, { contentType: f.contentType, upsert: false, cacheControl: '3600' });
        if (res.error) throw toRepoError(res.error);
        done.push(path);
      }
      return done;
    } catch (e) {
      if (done.length) await this.removeFiles(done);
      throw toRepoError(e);
    }
  }

  async removeFiles(paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      await this.sb.storage.from(BUCKET).remove(paths);
    } catch {
      // Left for the server-side cleanup rule (plan §8.2-8).
    }
  }

  async signedUrl(path: string, ttlSeconds = OPEN_TTL_S): Promise<string> {
    const res = await this.sb.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
    if (res.error || !res.data?.signedUrl) throw toRepoError(res.error);
    return res.data.signedUrl;
  }

  // ── live location (plan §7.8) ──
  async loadLocations(): Promise<LocationsSnapshot> {
    const trip = this.tripId();
    const [locs, session] = await Promise.all([
      this.sb.from('live_locations').select('*').eq('trip_id', trip),
      this.sessionId
        ? Promise.resolve(null)
        : this.sb.from('trip_sessions').select('id').eq('trip_id', trip).is('revoked_at', null).limit(1),
    ]);
    if (session) this.sessionId = ((must(session) as Json[])[0]?.id as string | undefined) ?? null;
    return { locations: (must(locs) as Json[]).map(locationFrom), mySessionId: this.sessionId };
  }

  async shareLocation(fix: LocationFix, takeover: boolean): Promise<{ status: ShareStatus; row: LiveLocation | null }> {
    const res = must(
      await this.sb.rpc('share_location', {
        p_lat: fix.lat,
        p_lng: fix.lng,
        p_accuracy_m: fix.accuracyM,
        p_measured_at: fix.measuredAt,
        p_takeover: takeover,
      }),
    ) as { status: ShareStatus; row: Json | null };
    return { status: res.status, row: res.row ? locationFrom(res.row) : null };
  }

  async stopSharing(): Promise<LiveLocation | null> {
    const res = must(await this.sb.rpc('stop_sharing')) as { row: Json | null };
    return res.row ? locationFrom(res.row) : null;
  }

  async clearMyLocation(): Promise<void> {
    must(await this.sb.rpc('clear_my_location'));
  }
}

let repo: SupabaseRepository | null = null;

/** One instance per page load. */
export function createSupabaseRepository(): TripRepository {
  repo ??= new SupabaseRepository();
  return repo;
}
