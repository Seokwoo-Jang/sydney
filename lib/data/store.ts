// Tiny external store shared by every data hook (one subscription per app,
// whatever the layout). Lists hold live rows only and keep object identity for
// unchanged rows so selectors stay cheap.
import type { LiveLocation, Member, ResourceLink, Trip, TripBudget } from '../types';
import { ENTITY_NAMES, type DataError, type EntityLists, type EntityName, type EntityRowMap, type TripRepository, type TripSnapshot } from './repository';

export type SessionStatus = 'checking' | 'signed_out' | 'signed_in';
export type DataStatus = 'loading' | 'ready' | 'error';
export type LocationDeviceError = 'denied' | 'unavailable' | 'unsupported' | 'failed';

/** Live locations (plan §7.8): fetched apart from the snapshot, refreshed on their own Realtime events. */
export interface LocationState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  list: LiveLocation[];
  /** This browser's trip session; equals `sharingSessionId` when this device is the one sharing. */
  mySessionId: string | null;
  /** This device's geolocation watch. */
  device: { watching: boolean; busy: boolean; error: LocationDeviceError | null };
}

export const initialLocation: LocationState = {
  status: 'idle',
  list: [],
  mySessionId: null,
  device: { watching: false, busy: false, error: null },
};

export interface TripState {
  repo: TripRepository | null;
  session: { status: SessionStatus; member: Member | null };
  data: { status: DataStatus; error: DataError | null; snapshot: TripSnapshot | null };
  time: { offsetMs: number; synced: boolean };
  /**
   * `reconnecting`: a background refetch failed while data is shown.
   * `live`: the Realtime channel is up; while false the provider polls every 30 s.
   */
  sync: { reconnecting: boolean; live: boolean };
  location: LocationState;
}

export const initialState: TripState = {
  repo: null,
  session: { status: 'checking', member: null },
  data: { status: 'loading', error: null, snapshot: null },
  time: { offsetMs: 0, synced: false },
  sync: { reconnecting: false, live: true },
  location: initialLocation,
};

export interface TripStore {
  get(): TripState;
  set(update: (s: TripState) => TripState): void;
  subscribe(listener: () => void): () => void;
}

export function createTripStore(): TripStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const next = update(state);
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type Versioned = { id: string; version: number; deletedAt: string | null; url?: string; thumbUrl?: string };

/** Keeps previous objects (and the previous array) when nothing changed. Re-signed photo URLs count as a change. */
export function reconcileList<T extends Versioned>(prev: T[] | undefined, next: T[]): T[] {
  const live = next.filter((r) => !r.deletedAt);
  if (!prev) return live;
  const byId = new Map(prev.map((r) => [r.id, r]));
  let changed = prev.length !== live.length;
  const out = live.map((r, i) => {
    const old = byId.get(r.id);
    const keep = old && old.version === r.version && old.url === r.url && old.thumbUrl === r.thumbUrl ? old : r;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? out : prev;
}

function sameJson<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function reconcileSnapshot(prev: TripSnapshot | null, next: TripSnapshot): TripSnapshot {
  const lists = {} as Record<EntityName, Versioned[]>;
  for (const e of ENTITY_NAMES) {
    lists[e] = reconcileList<Versioned>(prev?.[e] as Versioned[] | undefined, next[e] as Versioned[]);
  }
  const keep = <T>(a: T | undefined, b: T): T => (a !== undefined && sameJson(a, b) ? a : b);
  return {
    ...(lists as unknown as EntityLists),
    trip: prev && prev.trip.version === next.trip.version && sameJson(prev.trip, next.trip) ? prev.trip : next.trip,
    members: keep(prev?.members, next.members),
    budgets: keep(prev?.budgets, next.budgets),
    fxRates: keep(prev?.fxRates, next.fxRates),
    resourceLinks: keep(prev?.resourceLinks, next.resourceLinks),
  };
}

/** Inserts/replaces one row; a soft-deleted row is removed. */
export function applyRow<E extends EntityName>(snapshot: TripSnapshot, entity: E, row: EntityRowMap[E]): TripSnapshot {
  const list = snapshot[entity] as EntityRowMap[E][];
  const i = list.findIndex((r) => r.id === row.id);
  let next: EntityRowMap[E][];
  if (row.deletedAt) {
    if (i < 0) return snapshot;
    next = list.filter((r) => r.id !== row.id);
  } else if (i < 0) {
    next = [...list, row];
  } else {
    if (list[i].version > row.version) return snapshot; // stale echo
    next = list.slice();
    next[i] = row;
  }
  return { ...snapshot, [entity]: next };
}

export function applyTrip(snapshot: TripSnapshot, trip: Trip): TripSnapshot {
  return trip.version < snapshot.trip.version ? snapshot : { ...snapshot, trip };
}

export function applyBudget(snapshot: TripSnapshot, budget: TripBudget): TripSnapshot {
  const others = snapshot.budgets.filter((b) => b.scope !== budget.scope);
  return { ...snapshot, budgets: [...others, budget] };
}

export function applyResourceLink(snapshot: TripSnapshot, link: ResourceLink, removed: boolean): TripSnapshot {
  const others = snapshot.resourceLinks.filter((l) => l.id !== link.id);
  return { ...snapshot, resourceLinks: removed ? others : [...others, link] };
}

/** Replaces the profile's row (one per member); `null` removes it. */
export function applyLocation(list: LiveLocation[], memberId: string, row: LiveLocation | null): LiveLocation[] {
  const others = list.filter((l) => l.memberId !== memberId);
  return row ? [...others, row] : others;
}
