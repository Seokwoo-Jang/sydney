// DEVELOPMENT-ONLY in-memory repository. Imported solely from the
// `NODE_ENV === 'development'` branch in lib/data/source.ts.
//
// Dev query params (read once per page load):
//   ?now=2030-12-28T15:10   Sydney wall clock → server time offset (clock keeps ticking)
//   ?mockState=loading|error|empty
//   ?as=eren|amy            enter automatically (screenshots)
//   ?mockLatency=0          override the ~300ms latency
// Console: __sydneyMock.simulateRemoteEdit('itinerary', 'it-d2-arcade', { title: '…' })
import type {
  FileAsset,
  LiveLocation,
  Member,
  ProfileKey,
  PushDevice,
  PushKind,
  ResourceLink,
  SaveResult,
  Trip,
  TripBudget,
} from '../../types';
import { SYDNEY_TZ, zonedToInstant } from '../../time/zone';
import {
  RepositoryError,
  type ChangeEvent,
  type EnterResult,
  type EntityLists,
  type EntityName,
  type EntityRowMap,
  type LocationFix,
  type LocationsSnapshot,
  type NewRow,
  type PushSubscriptionInput,
  type ResolvedMapLink,
  type RowPatch,
  type TripPatch,
  type TripRepository,
  type TripSnapshot,
  type UploadFile,
} from '../repository';
import { newId, normalizeEntryName } from '../session';
import { MEMBERS, TRIP_ID, createEmptySeed, createSeed } from './data';

type Forced = 'loading' | 'error' | 'empty' | null;

interface MockOptions {
  latencyMs: number;
  forced: Forced;
  nowOverride: string | null;
  autoEnter: ProfileKey | null;
}

const SESSION_KEY = 'sydney.mock.profile';

function readOptions(): MockOptions {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const state = p.get('mockState');
  const latency = Number(p.get('mockLatency'));
  return {
    latencyMs: Number.isFinite(latency) && p.has('mockLatency') ? latency : 300,
    forced: state === 'loading' || state === 'error' || state === 'empty' ? state : null,
    nowOverride: p.get('now'),
    autoEnter: normalizeEntryName(p.get('as') ?? ''),
  };
}

function offsetFor(nowOverride: string | null): number {
  const m = nowOverride ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(nowOverride) : null;
  if (!m) return 0;
  return zonedToInstant(m[1], m[2], SYDNEY_TZ).getTime() - Date.now();
}

const clone = <T,>(v: T): T => structuredClone(v);

/** A stored example device without its owner column (the client never reads it). */
const deviceOf = (d: PushDevice & { memberId: string }): PushDevice => ({
  id: d.id,
  endpoint: d.endpoint,
  deviceLabel: d.deviceLabel,
  enabledKinds: [...d.enabledKinds],
  createdAt: d.createdAt,
  lastSuccessAt: d.lastSuccessAt,
});

function readStoredProfile(): ProfileKey | null {
  try {
    return normalizeEntryName(window.sessionStorage.getItem(SESSION_KEY) ?? '');
  } catch {
    return null;
  }
}

function storeProfile(key: ProfileKey | null) {
  try {
    if (key) window.sessionStorage.setItem(SESSION_KEY, key);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the session simply lasts for this page.
  }
}

export interface MockControls {
  /** Bumps a row as the other profile and emits a change, to exercise conflicts and refetch. */
  simulateRemoteEdit<E extends EntityName>(entity: E, id: string, patch: RowPatch<EntityRowMap[E]>): void;
  /** Restores the seed data. */
  reset(): void;
}

class MockRepository implements TripRepository, MockControls {
  readonly kind = 'mock' as const;
  /** The mock keeps phase-2 behaviour: the UI writes derived Prelude status itself. */
  readonly serverManagesPreludeStatus = false;
  private options: MockOptions;
  private offsetMs: number;
  private db: TripSnapshot;
  private member: Member | null = null;
  private listeners = new Set<(e: ChangeEvent) => void>();
  /** Uploaded blobs live as object URLs for this page only. */
  private files = new Map<string, string>();
  private sessionId = `mock-session-${newId()}`;
  private locations: LiveLocation[];
  /** Example devices only (fictional endpoints). */
  private pushDevices: Array<PushDevice & { memberId: string }>;

  constructor(options: MockOptions) {
    this.options = options;
    this.offsetMs = offsetFor(options.nowOverride);
    this.db = options.forced === 'empty' ? createEmptySeed() : createSeed();
    const profile = options.autoEnter ?? readStoredProfile();
    this.member = profile ? MEMBERS[profile] : null;
    // Example only: Amy shared from "another device" a few minutes ago.
    const seen = new Date(Date.now() + this.offsetMs - 4 * 60_000).toISOString();
    this.locations =
      options.forced === 'empty'
        ? []
        : [
            {
              tripId: TRIP_ID,
              memberId: MEMBERS.amy.id,
              lat: -33.8718,
              lng: 151.2067,
              accuracyM: 30,
              measuredAt: seen,
              updatedAt: seen,
              isSharing: true,
              sharingSessionId: 'mock-other-device',
            },
          ];
    // Example only: each profile already has one other device on the list.
    const allKinds: PushKind[] = ['schedule', 'flights_car', 'partner_updates', 'countdown'];
    this.pushDevices =
      options.forced === 'empty'
        ? []
        : (['eren', 'amy'] as const).map((key) => ({
            id: `mock-push-${key}`,
            memberId: MEMBERS[key].id,
            endpoint: `https://push.example.invalid/${key}-1`,
            deviceLabel: key === 'eren' ? 'Android phone (Chrome)' : 'iPhone',
            enabledKinds: allKinds,
            createdAt: '2030-10-31T01:00:00.000Z',
            lastSuccessAt: null,
          }));
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms + Math.round(Math.random() * ms * 0.3))) : Promise.resolve();
  }

  private nowIso(): string {
    return new Date(Date.now() + this.offsetMs).toISOString();
  }

  private emit(e: ChangeEvent) {
    // Echo like Realtime would, slightly after the write resolves.
    setTimeout(() => this.listeners.forEach((l) => l(e)), 60);
  }

  private list<E extends EntityName>(entity: E): EntityLists[E] {
    return this.db[entity];
  }

  // ── session ──
  async getSession() {
    await this.delay();
    return this.member;
  }

  async enter(name: string): Promise<EnterResult> {
    await this.delay();
    const key = normalizeEntryName(name);
    if (!key) return { ok: false, reason: 'invalid_name' };
    this.member = MEMBERS[key];
    storeProfile(key);
    return { ok: true, member: this.member };
  }

  async leave() {
    await this.delay();
    this.member = null;
    storeProfile(null);
  }

  async serverTimeOffset() {
    await this.delay();
    return this.offsetMs;
  }

  // ── reads ──
  async loadSnapshot(): Promise<TripSnapshot> {
    if (this.options.forced === 'loading') return new Promise<TripSnapshot>(() => {});
    await this.delay();
    if (this.options.forced === 'error') throw new RepositoryError('network', 'Mock load failure (?mockState=error).');
    if (!this.member) throw new RepositoryError('unknown', 'Not entered.');
    return clone(this.db);
  }

  subscribe(onChange: (e: ChangeEvent) => void) {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }

  // ── writes ──
  async create<E extends EntityName>(entity: E, row: NewRow<EntityRowMap[E]>): Promise<SaveResult<EntityRowMap[E]>> {
    await this.delay();
    const list = this.list(entity) as EntityRowMap[E][];
    const existing = list.find((r) => r.id === row.id);
    if (existing) return { ok: true, row: clone(existing) }; // idempotent retry
    const now = this.nowIso();
    const by = this.member?.id ?? null;
    const full = {
      ...this.withFileUrls(entity, row),
      tripId: TRIP_ID,
      createdBy: by,
      updatedBy: by,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
    } as EntityRowMap[E];
    list.push(full);
    this.emit({ type: 'changed', entity });
    return { ok: true, row: clone(full) };
  }

  private async write<E extends EntityName>(
    entity: E,
    id: string,
    expectedVersion: number,
    change: (row: EntityRowMap[E], now: string) => EntityRowMap[E],
  ): Promise<SaveResult<EntityRowMap[E]>> {
    await this.delay();
    const list = this.list(entity) as EntityRowMap[E][];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, reason: 'error', message: 'Not found.' };
    const current = list[i];
    if (current.version !== expectedVersion || current.deletedAt) {
      return { ok: false, reason: 'conflict', latest: clone(current) };
    }
    const next = change(current, this.nowIso());
    list[i] = next;
    this.emit({ type: 'changed', entity });
    return { ok: true, row: clone(next) };
  }

  update<E extends EntityName>(entity: E, id: string, patch: RowPatch<EntityRowMap[E]>, expectedVersion: number) {
    return this.write(entity, id, expectedVersion, (row, now) => ({
      ...this.withFileUrls(entity, row),
      ...patch,
      version: row.version + 1,
      updatedAt: now,
      updatedBy: this.member?.id ?? null,
    }));
  }

  softDelete<E extends EntityName>(entity: E, id: string, expectedVersion: number) {
    return this.write(entity, id, expectedVersion, (row, now) => ({
      ...row,
      deletedAt: now,
      version: row.version + 1,
      updatedAt: now,
      updatedBy: this.member?.id ?? null,
    }));
  }

  async updateTrip(patch: TripPatch, expectedVersion: number): Promise<SaveResult<Trip>> {
    await this.delay();
    if (this.db.trip.version !== expectedVersion) return { ok: false, reason: 'conflict', latest: clone(this.db.trip) };
    this.db.trip = { ...this.db.trip, ...patch, version: this.db.trip.version + 1 };
    this.emit({ type: 'changed', entity: 'trip' });
    return { ok: true, row: clone(this.db.trip) };
  }

  async setBudget(budget: Omit<TripBudget, 'tripId'>): Promise<SaveResult<TripBudget>> {
    await this.delay();
    const row: TripBudget = { ...budget, tripId: TRIP_ID };
    this.db.budgets = [...this.db.budgets.filter((b) => b.scope !== row.scope), row];
    this.emit({ type: 'changed', entity: 'budgets' });
    return { ok: true, row: clone(row) };
  }

  async linkResource(link: Omit<ResourceLink, 'tripId'>): Promise<SaveResult<ResourceLink>> {
    await this.delay();
    const existing = this.db.resourceLinks.find((l) => l.id === link.id);
    if (existing) return { ok: true, row: clone(existing) };
    const row: ResourceLink = { ...link, tripId: TRIP_ID };
    this.db.resourceLinks = [...this.db.resourceLinks, row];
    this.emit({ type: 'changed', entity: 'resourceLinks' });
    return { ok: true, row: clone(row) };
  }

  async unlinkResource(id: string): Promise<SaveResult<ResourceLink>> {
    await this.delay();
    const existing = this.db.resourceLinks.find((l) => l.id === id);
    if (!existing) return { ok: false, reason: 'error', message: 'Not found.' };
    this.db.resourceLinks = this.db.resourceLinks.filter((l) => l.id !== id);
    this.emit({ type: 'changed', entity: 'resourceLinks' });
    return { ok: true, row: clone(existing) };
  }

  // ── files ──
  private withFileUrls<T>(entity: EntityName, row: T): T {
    if (entity !== 'assets') return row;
    const a = row as unknown as FileAsset;
    const url = this.files.get(a.displayPath ?? a.storagePath);
    const thumbUrl = this.files.get(a.thumbPath ?? '') ?? url;
    return (url ? { ...a, url, thumbUrl } : a) as unknown as T;
  }

  async uploadFiles(files: UploadFile[]): Promise<string[]> {
    await this.delay();
    const folder = `${TRIP_ID}/${newId()}`;
    return files.map((f) => {
      const path = `${folder}/${f.name}`;
      this.files.set(path, URL.createObjectURL(f.blob));
      return path;
    });
  }

  async removeFiles(paths: string[]): Promise<void> {
    for (const p of paths) {
      const url = this.files.get(p);
      if (url) URL.revokeObjectURL(url);
      this.files.delete(p);
    }
  }

  async signedUrl(path: string): Promise<string> {
    await this.delay();
    const url = this.files.get(path) ?? this.db.assets.find((a) => a.storagePath === path || a.displayPath === path)?.url;
    if (!url) throw new RepositoryError('unknown', 'Example file not available.');
    return url;
  }

  // ── map links: no server in development, so only a short link becomes an example point ──
  async resolveMapLink(url: string): Promise<ResolvedMapLink | null> {
    await this.delay();
    return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(url)
      ? { lat: 12.31, lng: 45.61, precision: 'pin', name: '예시 장소' }
      : null;
  }

  // ── live location ──
  async loadLocations(): Promise<LocationsSnapshot> {
    await this.delay();
    return { locations: clone(this.locations), mySessionId: this.sessionId };
  }

  async shareLocation(fix: LocationFix, takeover: boolean) {
    await this.delay();
    if (!this.member) throw new RepositoryError('unknown', 'Not entered.');
    const me = this.member.id;
    const current = this.locations.find((l) => l.memberId === me) ?? null;
    if (!takeover) {
      if (!current || !current.isSharing || current.sharingSessionId !== this.sessionId) {
        return { status: 'not_sharing_device' as const, row: current ? clone(current) : null };
      }
      if (current.measuredAt >= fix.measuredAt) return { status: 'stale' as const, row: clone(current) };
    }
    const row: LiveLocation = {
      tripId: TRIP_ID,
      memberId: me,
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM,
      measuredAt: fix.measuredAt,
      updatedAt: this.nowIso(),
      isSharing: true,
      sharingSessionId: this.sessionId,
    };
    this.locations = [...this.locations.filter((l) => l.memberId !== me), row];
    this.emit({ type: 'changed', entity: 'liveLocations' });
    return { status: 'ok' as const, row: clone(row) };
  }

  async stopSharing(): Promise<LiveLocation | null> {
    await this.delay();
    const me = this.member?.id;
    const current = this.locations.find((l) => l.memberId === me);
    if (!current) return null;
    const row = { ...current, isSharing: false, sharingSessionId: null };
    this.locations = this.locations.map((l) => (l.memberId === me ? row : l));
    this.emit({ type: 'changed', entity: 'liveLocations' });
    return clone(row);
  }

  async clearMyLocation(): Promise<void> {
    await this.delay();
    this.locations = this.locations.filter((l) => l.memberId !== this.member?.id);
    this.emit({ type: 'changed', entity: 'liveLocations' });
  }

  // ── push notifications ──
  async listPushDevices(): Promise<PushDevice[]> {
    await this.delay();
    if (!this.member) throw new RepositoryError('unknown', 'Not entered.');
    const me = this.member.id;
    return this.pushDevices
      .filter((d) => d.memberId === me)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(deviceOf);
  }

  async savePushSubscription(input: PushSubscriptionInput): Promise<PushDevice> {
    await this.delay();
    if (!this.member) throw new RepositoryError('unknown', 'Not entered.');
    if (!/^https:\/\//.test(input.endpoint)) throw new RepositoryError('unknown', 'Invalid endpoint.');
    // Same endpoint = same browser, whoever held it before.
    const row = {
      id: newId(),
      memberId: this.member.id,
      endpoint: input.endpoint,
      deviceLabel: input.deviceLabel,
      enabledKinds: [...input.enabledKinds],
      createdAt: this.nowIso(),
      lastSuccessAt: null,
    };
    this.pushDevices = [...this.pushDevices.filter((d) => d.endpoint !== input.endpoint), row];
    return deviceOf(row);
  }

  async setPushKinds(id: string, kinds: PushKind[]): Promise<PushDevice> {
    await this.delay();
    const i = this.pushDevices.findIndex((d) => d.id === id && d.memberId === this.member?.id);
    if (i < 0) throw new RepositoryError('unknown', 'This device is no longer on the list.');
    this.pushDevices[i] = { ...this.pushDevices[i], enabledKinds: [...kinds] };
    return deviceOf(this.pushDevices[i]);
  }

  async removePushDevice(id: string): Promise<void> {
    await this.delay();
    this.pushDevices = this.pushDevices.filter((d) => !(d.id === id && d.memberId === this.member?.id));
  }

  // ── dev controls ──
  simulateRemoteEdit<E extends EntityName>(entity: E, id: string, patch: RowPatch<EntityRowMap[E]>) {
    const list = this.list(entity) as EntityRowMap[E][];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    const other = this.member?.profileKey === 'amy' ? MEMBERS.eren : MEMBERS.amy;
    list[i] = { ...list[i], ...patch, version: list[i].version + 1, updatedAt: this.nowIso(), updatedBy: other.id };
    this.emit({ type: 'changed', entity });
  }

  reset() {
    this.db = createSeed();
    this.emit({ type: 'reconnected' });
  }
}

type MockGlobal = typeof globalThis & { __sydneyMock?: MockRepository };

/** One instance per page load (survives React StrictMode double effects and HMR). */
export function getMockRepository(): TripRepository & MockControls {
  const g = globalThis as MockGlobal;
  if (!g.__sydneyMock) g.__sydneyMock = new MockRepository(readOptions());
  return g.__sydneyMock;
}
