'use client';
// Owns the single repository, session, snapshot, Realtime subscription and
// clock offset. Board and tab layouts read the same store (plan §4.5).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { unsubscribeThisDevice } from '../push';
import type { ResourceLink, SaveResult, Trip, TripBudget } from '../types';
import { createLocationController, type LocationActions } from './location';
import {
  toDataError,
  type ChangeEvent,
  type EnterResult,
  type EntityName,
  type EntityRowMap,
  type NewRow,
  type RowPatch,
  type TripPatch,
  type TripRepository,
} from './repository';
import { loadRepository } from './source';
import {
  applyBudget,
  applyResourceLink,
  applyRow,
  applyTrip,
  createTripStore,
  initialLocation,
  reconcileSnapshot,
  type TripState,
  type TripStore,
} from './store';

export interface TripActions extends LocationActions {
  /** Full refetch. Keeps showing current data while it runs. */
  reload(): Promise<void>;
  /** Shows the loading state, then refetches (ErrorState retry). */
  retry(): void;
  resyncTime(): Promise<void>;
  enter(name: string): Promise<EnterResult>;
  leave(): Promise<void>;
  create<E extends EntityName>(entity: E, row: NewRow<EntityRowMap[E]>): Promise<SaveResult<EntityRowMap[E]>>;
  update<E extends EntityName>(
    entity: E,
    id: string,
    patch: RowPatch<EntityRowMap[E]>,
    expectedVersion: number,
  ): Promise<SaveResult<EntityRowMap[E]>>;
  remove<E extends EntityName>(entity: E, id: string, expectedVersion: number): Promise<SaveResult<EntityRowMap[E]>>;
  updateTrip(patch: TripPatch, expectedVersion: number): Promise<SaveResult<Trip>>;
  setBudget(budget: Omit<TripBudget, 'tripId'>): Promise<SaveResult<TripBudget>>;
  linkResource(link: Omit<ResourceLink, 'tripId'>): Promise<SaveResult<ResourceLink>>;
  unlinkResource(id: string): Promise<SaveResult<ResourceLink>>;
}

interface TripDataContextValue {
  store: TripStore;
  actions: TripActions;
}

const TripDataContext = createContext<TripDataContextValue | null>(null);

export function useTripDataContext(): TripDataContextValue {
  const ctx = useContext(TripDataContext);
  if (!ctx) throw new Error('TripDataProvider is missing above this component.');
  return ctx;
}

const NOT_READY = { ok: false as const, reason: 'error' as const, message: 'Not ready yet.' };
const REFETCH_DEBOUNCE_MS = 150;
const POLL_MS = 30_000;

function createActions(store: TripStore): { actions: TripActions; startLocationWatch: () => () => void } {
  let loadSeq = 0;
  const location = createLocationController(store);
  const repo = () => store.get().repo;
  const withSnapshot = (fn: (s: TripState) => TripState) =>
    store.set((s) => (s.data.snapshot ? fn(s) : s));

  async function reload(): Promise<void> {
    const r = repo();
    if (!r || store.get().session.status !== 'signed_in') return;
    const seq = ++loadSeq;
    try {
      const snap = await r.loadSnapshot();
      if (seq !== loadSeq) return;
      store.set((s) => ({
        ...s,
        data: { status: 'ready', error: null, snapshot: reconcileSnapshot(s.data.snapshot, snap) },
        sync: { ...s.sync, reconnecting: false },
      }));
    } catch (e) {
      if (seq !== loadSeq) return;
      store.set((s) =>
        s.data.status === 'ready'
          ? { ...s, sync: { ...s.sync, reconnecting: true } } // keep stale data, show "Reconnecting…"
          : { ...s, data: { status: 'error', error: toDataError(e), snapshot: null } },
      );
    }
  }

  async function guard<T>(run: (r: TripRepository) => Promise<SaveResult<T>>, apply: (row: T) => void): Promise<SaveResult<T>> {
    const r = repo();
    if (!r) return NOT_READY;
    try {
      const res = await run(r);
      if (res.ok) apply(res.row);
      else if (res.reason === 'conflict' && res.latest) apply(res.latest);
      return res;
    } catch (e) {
      return { ok: false, reason: 'error', message: toDataError(e).message };
    }
  }

  const actions: TripActions = {
    ...location.actions,
    reload,
    retry() {
      store.set((s) => ({ ...s, data: { status: 'loading', error: null, snapshot: s.data.snapshot } }));
      void reload();
    },
    async resyncTime() {
      const r = repo();
      if (!r) return;
      try {
        const offsetMs = await r.serverTimeOffset();
        store.set((s) => ({ ...s, time: { offsetMs, synced: true } }));
      } catch {
        // Keep the last offset (or device time) and try again on the next resume (plan §9).
        store.set((s) => (s.time.synced ? { ...s, time: { ...s.time, synced: false } } : s));
      }
    },
    async enter(name) {
      const r = repo();
      if (!r) return { ok: false, reason: 'error' };
      let res: EnterResult;
      try {
        res = await r.enter(name);
      } catch (e) {
        res = { ok: false, reason: 'error', message: toDataError(e).message };
      }
      if (res.ok) {
        const member = res.member;
        store.set((s) => ({
          ...s,
          session: { status: 'signed_in', member },
          data: { status: 'loading', error: null, snapshot: null },
        }));
        void reload();
      }
      return res;
    },
    async leave() {
      const r = repo();
      loadSeq++;
      try {
        // This browser stops getting pushes; leave_trip deletes its row (plan §8.5). Never throws.
        await unsubscribeThisDevice();
        await r?.leave();
      } finally {
        store.set((s) => ({
          ...s,
          session: { status: 'signed_out', member: null },
          data: { status: 'loading', error: null, snapshot: null },
          sync: { reconnecting: false, live: true },
          location: initialLocation,
        }));
      }
    },
    create(entity, row) {
      return guard(
        (r) => r.create(entity, row),
        (saved) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyRow(s.data.snapshot!, entity, saved) } })),
      );
    },
    update(entity, id, patch, expectedVersion) {
      return guard(
        (r) => r.update(entity, id, patch, expectedVersion),
        (saved) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyRow(s.data.snapshot!, entity, saved) } })),
      );
    },
    remove(entity, id, expectedVersion) {
      return guard(
        (r) => r.softDelete(entity, id, expectedVersion),
        (saved) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyRow(s.data.snapshot!, entity, saved) } })),
      );
    },
    updateTrip(patch, expectedVersion) {
      return guard(
        (r) => r.updateTrip(patch, expectedVersion),
        (trip) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyTrip(s.data.snapshot!, trip) } })),
      );
    },
    setBudget(budget) {
      return guard(
        (r) => r.setBudget(budget),
        (saved) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyBudget(s.data.snapshot!, saved) } })),
      );
    },
    linkResource(link) {
      return guard(
        (r) => r.linkResource(link),
        (saved) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyResourceLink(s.data.snapshot!, saved, false) } })),
      );
    },
    unlinkResource(id) {
      return guard(
        (r) => r.unlinkResource(id),
        (saved) => withSnapshot((s) => ({ ...s, data: { ...s.data, snapshot: applyResourceLink(s.data.snapshot!, saved, true) } })),
      );
    },
  };
  return { actions, startLocationWatch: location.start };
}

export function TripDataProvider({ children, repository }: { children: ReactNode; repository?: TripRepository }) {
  const [store] = useState(createTripStore);
  const { actions, startLocationWatch } = useMemo(() => createActions(store), [store]);
  const value = useMemo(() => ({ store, actions }), [store, actions]);
  const [sessionStatus, setSessionStatus] = useState(store.get().session.status);

  // Boot: pick the repository, sync the clock, restore the session.
  useEffect(() => {
    let alive = true;
    const unsub = store.subscribe(() => setSessionStatus(store.get().session.status));
    (async () => {
      const repo = repository ?? (await loadRepository());
      if (!alive) return;
      store.set((s) => ({ ...s, repo }));
      void actions.resyncTime();
      let member = null;
      try {
        member = await repo.getSession();
      } catch {
        member = null;
      }
      if (!alive) return;
      store.set((s) => ({
        ...s,
        session: member ? { status: 'signed_in', member } : { status: 'signed_out', member: null },
      }));
      if (member) void actions.reload();
    })();
    return () => {
      alive = false;
      unsub();
    };
  }, [store, actions, repository]);

  // Realtime → refetch; resume/online → full refetch + clock resync; poll while
  // reconnecting or while the live channel is down (plan §8.2-3).
  useEffect(() => {
    const repo = store.get().repo;
    if (sessionStatus !== 'signed_in' || !repo) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let locTimer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void actions.reload(), REFETCH_DEBOUNCE_MS);
    };
    const scheduleLocations = () => {
      if (locTimer) clearTimeout(locTimer);
      locTimer = setTimeout(() => void actions.reloadLocations(), REFETCH_DEBOUNCE_MS);
    };
    const setLive = (live: boolean) => store.set((s) => (s.sync.live === live ? s : { ...s, sync: { ...s.sync, live } }));
    const onEvent = (e: ChangeEvent) => {
      if (e.type === 'disconnected') return setLive(false);
      if (e.type === 'reconnected') {
        setLive(true);
        schedule();
        scheduleLocations();
        return;
      }
      if (e.entity === 'liveLocations') scheduleLocations();
      else schedule();
    };
    const unsubscribe = repo.subscribe(onEvent);
    const stopWatch = startLocationWatch();
    void actions.reloadLocations();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      schedule();
      scheduleLocations();
      void actions.resyncTime();
    };
    const onOnline = () => {
      schedule();
      scheduleLocations();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const poll = setInterval(() => {
      const { sync } = store.get();
      if (document.visibilityState !== 'visible' || (!sync.reconnecting && sync.live)) return;
      void actions.reload();
      void actions.reloadLocations();
    }, POLL_MS);
    return () => {
      if (timer) clearTimeout(timer);
      if (locTimer) clearTimeout(locTimer);
      unsubscribe();
      stopWatch();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [sessionStatus, store, actions, startLocationWatch]);

  return <TripDataContext.Provider value={value}>{children}</TripDataContext.Provider>;
}
