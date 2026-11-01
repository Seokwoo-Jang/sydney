'use client';
// Data hooks used by every section. Each returns
//   { status: 'loading' | 'ready' | 'error', data, error, retry } + mutations.
// `data` is non-null only when status === 'ready' (narrow on status).
// Mutations resolve to SaveResult; show "Saved" only when result.ok (plan §8.2).
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  Booking,
  ChecklistItem,
  Expense,
  FileAsset,
  FxRate,
  ItineraryItem,
  JournalEntry,
  Member,
  PreludeActivity,
  Resource,
  ResourceLink,
  SaveResult,
  Settlement,
  Trip,
  TripBudget,
  TripDay,
  TripDocument,
} from '../types';
import {
  RepositoryError,
  type DataError,
  type EnterResult,
  type EntityName,
  type EntityRowMap,
  type NewRow,
  type ResolvedMapLink,
  type RowPatch,
  type TripPatch,
  type TripSnapshot,
  type UploadFile,
} from './repository';
import { newId } from './session';
import { initialState, type LocationState, type SessionStatus, type TripState } from './store';
import { useTripDataContext } from './TripDataProvider';

// ── result shapes ────────────────────────────────────────────────
type Base = { retry: () => void };
export type DataResult<T> =
  | (Base & { status: 'loading'; data: null; error: null })
  | (Base & { status: 'ready'; data: T; error: null })
  | (Base & { status: 'error'; data: null; error: DataError });

/** Create payload: `id` optional — pass a stable id (e.g. from `newId()` on form mount) to make retries idempotent. */
export type CreateInput<E extends EntityName> = Omit<NewRow<EntityRowMap[E]>, 'id'> & { id?: string };

export interface EntityOps<E extends EntityName> {
  create(input: CreateInput<E>): Promise<SaveResult<EntityRowMap[E]>>;
  update(id: string, patch: RowPatch<EntityRowMap[E]>, expectedVersion: number): Promise<SaveResult<EntityRowMap[E]>>;
  remove(id: string, expectedVersion: number): Promise<SaveResult<EntityRowMap[E]>>;
}

export type ListResult<E extends EntityName, T = EntityRowMap[E][]> = DataResult<T> & EntityOps<E>;

// ── internals ────────────────────────────────────────────────────
function useSelect<T>(select: (s: TripState) => T): T {
  const { store } = useTripDataContext();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(initialState),
  );
}

function useBaseStatus() {
  const status = useSelect((s) => s.data.status);
  const error = useSelect((s) => s.data.error);
  const { actions } = useTripDataContext();
  return useMemo(() => ({ status, error, retry: actions.retry }), [status, error, actions]);
}

function toResult<T>(base: ReturnType<typeof useBaseStatus>, data: T | null): DataResult<T> {
  if (base.status === 'ready' && data !== null) return { status: 'ready', data, error: null, retry: base.retry };
  if (base.status === 'error' && base.error) return { status: 'error', data: null, error: base.error, retry: base.retry };
  return { status: 'loading', data: null, error: null, retry: base.retry };
}

function useList<E extends EntityName>(entity: E): EntityRowMap[E][] | null {
  return useSelect((s) => (s.data.snapshot ? (s.data.snapshot[entity] as EntityRowMap[E][]) : null));
}

function useSnapshotField<K extends keyof TripSnapshot>(key: K): TripSnapshot[K] | null {
  return useSelect((s) => (s.data.snapshot ? s.data.snapshot[key] : null));
}

export function useEntityOps<E extends EntityName>(entity: E): EntityOps<E> {
  const { actions } = useTripDataContext();
  return useMemo(
    () => ({
      create: (input: CreateInput<E>) =>
        actions.create(entity, { ...input, id: input.id ?? newId() } as NewRow<EntityRowMap[E]>),
      update: (id: string, patch: RowPatch<EntityRowMap[E]>, v: number) => actions.update(entity, id, patch, v),
      remove: (id: string, v: number) => actions.remove(entity, id, v),
    }),
    [actions, entity],
  );
}

function useListResult<E extends EntityName, T>(entity: E, derive: (rows: EntityRowMap[E][]) => T): DataResult<T> & EntityOps<E> {
  const base = useBaseStatus();
  const rows = useList(entity);
  // `derive` must be a module-level function so this memo stays stable.
  const data = useMemo(() => (rows ? derive(rows) : null), [rows, derive]);
  const ops = useEntityOps(entity);
  return useMemo(() => ({ ...toResult(base, data), ...ops }), [base, data, ops]);
}

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);
const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

const sortDays = (rows: TripDay[]) => rows.slice().sort((a, b) => a.date.localeCompare(b.date));
const TIME_KIND_ORDER = { timed: 0, all_day: 1, unscheduled: 2 } as const;
const sortItinerary = (rows: ItineraryItem[]) =>
  rows
    .slice()
    .sort(
      (a, b) =>
        byDate(a, b) ||
        TIME_KIND_ORDER[a.timeKind] - TIME_KIND_ORDER[b.timeKind] ||
        (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') ||
        bySort(a, b),
    );
const sortBySortOrder = <T extends { sortOrder: number }>(rows: T[]) => rows.slice().sort(bySort);
const identity = <T,>(rows: T) => rows;
const sortExpenses = (rows: Expense[]) => rows.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
const sortSettlements = (rows: Settlement[]) => rows.slice().sort((a, b) => b.date.localeCompare(a.date));
const sortResources = (rows: Resource[]) =>
  rows
    .slice()
    .sort((a, b) => (a.pinnedOrder ?? 99) - (b.pinnedOrder ?? 99) || a.title.localeCompare(b.title));

// ── session ──────────────────────────────────────────────────────
export interface SessionApi {
  status: SessionStatus;
  member: Member | null;
  /** Trim + case-insensitive Eren/Amy. Resolves to { ok:false, reason:'invalid_name' } otherwise. */
  enter(name: string): Promise<EnterResult>;
  leave(): Promise<void>;
}

export function useSession(): SessionApi {
  const session = useSelect((s) => s.session);
  const { actions } = useTripDataContext();
  return useMemo(
    () => ({ status: session.status, member: session.member, enter: actions.enter, leave: actions.leave }),
    [session, actions],
  );
}

// ── trip ─────────────────────────────────────────────────────────
export interface TripInfo {
  trip: Trip;
  members: Member[];
  me: Member | null;
  partner: Member | null;
}

export function useTrip(): DataResult<TripInfo> & {
  updateTrip(patch: TripPatch, expectedVersion: number): Promise<SaveResult<Trip>>;
} {
  const base = useBaseStatus();
  const trip = useSnapshotField('trip');
  const members = useSnapshotField('members');
  const me = useSelect((s) => s.session.member);
  const { actions } = useTripDataContext();
  const data = useMemo<TripInfo | null>(() => {
    if (!trip || !members) return null;
    const mine = me ? (members.find((m) => m.profileKey === me.profileKey) ?? me) : null;
    const partner = mine ? (members.find((m) => m.profileKey !== mine.profileKey) ?? null) : null;
    return { trip, members, me: mine, partner };
  }, [trip, members, me]);
  return useMemo(
    () => ({ ...toResult(base, data), updateTrip: actions.updateTrip }),
    [base, data, actions],
  );
}

// ── lists ────────────────────────────────────────────────────────
/** Day 1–9, sorted by date. */
export const useDays = (): ListResult<'days'> => useListResult('days', sortDays);
/** Sorted by date → timed/all-day/unscheduled → start time → sortOrder. Includes example rows. */
export const useItinerary = (): ListResult<'itinerary'> => useListResult('itinerary', sortItinerary);
export const useChecklist = (): ListResult<'checklist', ChecklistItem[]> => useListResult('checklist', sortBySortOrder<ChecklistItem>);
export const useBookings = (): ListResult<'bookings', Booking[]> => useListResult('bookings', identity<Booking[]>);
export const useDocuments = (): ListResult<'documents', TripDocument[]> => useListResult('documents', identity<TripDocument[]>);
export const useJournal = (): ListResult<'journal', JournalEntry[]> => useListResult('journal', identity<JournalEntry[]>);
/** Photos and documents. `url`/`thumbUrl` are resolved display URLs (signed in phase 3). */
export const useAssets = (): ListResult<'assets', FileAsset[]> => useListResult('assets', sortBySortOrder<FileAsset>);

// ── prelude ──────────────────────────────────────────────────────
export interface PreludeData {
  goal: string;
  activities: PreludeActivity[];
}

export function usePrelude(): DataResult<PreludeData> &
  EntityOps<'prelude'> & { setGoal(goal: string): Promise<SaveResult<Trip>> } {
  const base = useBaseStatus();
  const trip = useSnapshotField('trip');
  const rows = useList('prelude');
  const ops = useEntityOps('prelude');
  const { actions, store } = useTripDataContext();
  const data = useMemo(
    () => (trip && rows ? { goal: trip.preludeGoal, activities: sortBySortOrder(rows) } : null),
    [trip, rows],
  );
  const setGoal = useCallback(
    (goal: string) => {
      const current = store.get().data.snapshot?.trip;
      if (!current) return Promise.resolve({ ok: false as const, reason: 'error' as const, message: 'Not ready yet.' });
      return actions.updateTrip({ preludeGoal: goal }, current.version);
    },
    [actions, store],
  );
  return useMemo(
    () => ({ ...toResult(base, data), ...ops, setGoal }),
    [base, data, ops, setGoal],
  );
}

// ── budget ───────────────────────────────────────────────────────
export interface BudgetData {
  budgets: TripBudget[];
  /** Newest first. */
  expenses: Expense[];
  settlements: Settlement[];
  /** Newest first. */
  fxRates: FxRate[];
  latestFx: FxRate | null;
  members: Member[];
}

/** Expense ops at the top level; settlement ops under `settlements`. */
export function useBudget(): DataResult<BudgetData> &
  EntityOps<'expenses'> & {
    settlements: EntityOps<'settlements'>;
    setBudget(budget: Omit<TripBudget, 'tripId'>): Promise<SaveResult<TripBudget>>;
  } {
  const base = useBaseStatus();
  const budgets = useSnapshotField('budgets');
  const fxRates = useSnapshotField('fxRates');
  const members = useSnapshotField('members');
  const expenses = useList('expenses');
  const settlements = useList('settlements');
  const expenseOps = useEntityOps('expenses');
  const settlementOps = useEntityOps('settlements');
  const { actions } = useTripDataContext();
  const data = useMemo<BudgetData | null>(() => {
    if (!budgets || !fxRates || !expenses || !settlements || !members) return null;
    const sortedFx = fxRates.slice().sort((a, b) => b.rateDate.localeCompare(a.rateDate));
    return {
      budgets,
      expenses: sortExpenses(expenses),
      settlements: sortSettlements(settlements),
      fxRates: sortedFx,
      latestFx: sortedFx[0] ?? null,
      members,
    };
  }, [budgets, fxRates, expenses, settlements, members]);
  return useMemo(
    () => ({ ...toResult(base, data), ...expenseOps, settlements: settlementOps, setBudget: actions.setBudget }),
    [base, data, expenseOps, settlementOps, actions],
  );
}

// ── library ──────────────────────────────────────────────────────
export interface LibraryData {
  /** Pinned first (pinnedOrder 1..4), then by title. */
  resources: Resource[];
  links: ResourceLink[];
}

export function useLibrary(): DataResult<LibraryData> &
  EntityOps<'resources'> & {
    linkResource(link: Omit<ResourceLink, 'tripId' | 'id'> & { id?: string }): Promise<SaveResult<ResourceLink>>;
    unlinkResource(id: string): Promise<SaveResult<ResourceLink>>;
  } {
  const base = useBaseStatus();
  const rows = useList('resources');
  const links = useSnapshotField('resourceLinks');
  const ops = useEntityOps('resources');
  const { actions } = useTripDataContext();
  const data = useMemo(() => (rows && links ? { resources: sortResources(rows), links } : null), [rows, links]);
  const linkResource = useCallback(
    (link: Omit<ResourceLink, 'tripId' | 'id'> & { id?: string }) => actions.linkResource({ ...link, id: link.id ?? newId() }),
    [actions],
  );
  return useMemo(
    () => ({ ...toResult(base, data), ...ops, linkResource, unlinkResource: actions.unlinkResource }),
    [base, data, ops, linkResource, actions],
  );
}

// ── repository capabilities ──────────────────────────────────────
/** True when the database keeps Prelude status in step with linked items (write the link only). */
export function useServerManagesPreludeStatus(): boolean {
  return useSelect((s) => s.repo?.serverManagesPreludeStatus ?? false);
}

// ── files (plan §8.3) ────────────────────────────────────────────
export interface FilesApi {
  /** False until a repository that can store files is ready. */
  available: boolean;
  /** One new private folder per call; resolves to stored paths (same order). Throws on failure. */
  upload(files: UploadFile[]): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
  /** Short-lived link. Never persist it. Throws on failure. */
  signedUrl(path: string, ttlSeconds?: number): Promise<string>;
}

export function useFiles(): FilesApi {
  const { store } = useTripDataContext();
  const available = useSelect((s) => !!s.repo && s.repo.kind !== 'unconnected' && s.session.status === 'signed_in');
  return useMemo(() => {
    const repo = () => {
      const r = store.get().repo;
      if (!r) throw new RepositoryError('not_connected', 'Not ready yet.');
      return r;
    };
    return {
      available,
      upload: (files) => repo().uploadFiles(files),
      remove: (paths) => repo().removeFiles(paths),
      signedUrl: (path, ttl) => repo().signedUrl(path, ttl),
    };
  }, [store, available]);
}

// ── map links (plan §7.2.5) ──────────────────────────────────────
/** Server lookup of coordinates for a short / place link. Resolves null when unavailable. */
export function useMapLinkResolver(): (url: string) => Promise<ResolvedMapLink | null> {
  const { store } = useTripDataContext();
  return useCallback((url: string) => store.get().repo?.resolveMapLink(url) ?? Promise.resolve(null), [store]);
}

// ── live location (plan §7.8) ────────────────────────────────────
export interface LocationsApi extends LocationState {
  share(): Promise<boolean>;
  stop(): Promise<boolean>;
  clear(): Promise<boolean>;
  reload(): Promise<void>;
}

export function useLocations(): LocationsApi {
  const location = useSelect((s) => s.location);
  const { actions } = useTripDataContext();
  return useMemo(
    () => ({
      ...location,
      share: actions.shareLocation,
      stop: actions.stopSharing,
      clear: actions.clearLocation,
      reload: actions.reloadLocations,
    }),
    [location, actions],
  );
}

// ── connection + time ────────────────────────────────────────────
/** True while showing stale data after a failed background refetch ("Reconnecting…"). */
export function useReconnecting(): boolean {
  return useSelect((s) => s.sync.reconnecting);
}

/** Clock offset state. `synced` false = device clock in use (plan §9). */
export function useTimeSync(): { offsetMs: number; synced: boolean; resync: () => Promise<void> } {
  const time = useSelect((s) => s.time);
  const { actions } = useTripDataContext();
  return useMemo(() => ({ ...time, resync: actions.resyncTime }), [time, actions]);
}

type Ticker = { value: number; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null };
const tickers = new Map<number, Ticker>();
let visibilityHooked = false;

function getTicker(ms: number): Ticker {
  let t = tickers.get(ms);
  if (!t) {
    t = { value: Date.now(), listeners: new Set(), timer: null };
    tickers.set(ms, t);
  }
  return t;
}

function hookVisibility() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    tickers.forEach((t) => {
      t.value = now;
      t.listeners.forEach((l) => l());
    });
  });
}

function subscribeTicker(ms: number, cb: () => void): () => void {
  hookVisibility();
  const t = getTicker(ms);
  t.listeners.add(cb);
  if (!t.timer) {
    t.value = Date.now();
    t.timer = setInterval(() => {
      t.value = Date.now();
      t.listeners.forEach((l) => l());
    }, ms);
  }
  return () => {
    t.listeners.delete(cb);
    if (!t.listeners.size && t.timer) {
      clearInterval(t.timer);
      t.timer = null;
    }
  };
}

/**
 * Server-corrected current time, re-evaluated every `intervalMs` and when the
 * page becomes visible. `null` during static render/hydration only.
 * Dev: `?now=2030-12-28T15:10` (Sydney wall clock) shifts the mock server clock.
 */
export function useServerNow(intervalMs = 30_000): Date | null {
  const offset = useSelect((s) => s.time.offsetMs);
  const subscribe = useCallback((cb: () => void) => subscribeTicker(intervalMs, cb), [intervalMs]);
  const tick = useSyncExternalStore<number | null>(
    subscribe,
    () => getTicker(intervalMs).value,
    () => null,
  );
  return useMemo(() => (tick == null ? null : new Date(tick + offset)), [tick, offset]);
}
