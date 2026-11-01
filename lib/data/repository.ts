// Repository contract between UI hooks and a data source (plan §8).
// Phase 2: mock (dev only) or "unconnected" (production). Phase 3: Supabase.
// Components never import a repository directly; they use lib/data hooks.

import type {
  Booking,
  ChecklistItem,
  Expense,
  FileAsset,
  FxRate,
  ItineraryItem,
  JournalEntry,
  LiveLocation,
  Member,
  PreludeActivity,
  Resource,
  ResourceLink,
  RowMeta,
  SaveResult,
  Settlement,
  Trip,
  TripBudget,
  TripDay,
  TripDocument,
} from '../types';

/** Editable, versioned tables. Keys double as snapshot list names. */
export interface EntityRowMap {
  days: TripDay;
  itinerary: ItineraryItem;
  prelude: PreludeActivity;
  checklist: ChecklistItem;
  bookings: Booking;
  documents: TripDocument;
  expenses: Expense;
  settlements: Settlement;
  journal: JournalEntry;
  resources: Resource;
  assets: FileAsset;
}

export type EntityName = keyof EntityRowMap;

export const ENTITY_NAMES: readonly EntityName[] = [
  'days',
  'itinerary',
  'prelude',
  'checklist',
  'bookings',
  'documents',
  'expenses',
  'settlements',
  'journal',
  'resources',
  'assets',
];

export type EntityLists = { [E in EntityName]: EntityRowMap[E][] };

/** Everything one signed-in client reads. Lists contain live rows only (no `deletedAt`). */
export interface TripSnapshot extends EntityLists {
  trip: Trip;
  members: Member[];
  budgets: TripBudget[];
  fxRates: FxRate[]; // newest first
  resourceLinks: ResourceLink[];
}

/** Columns the server owns. */
export type ServerColumns = keyof RowMeta;
/** Fields a client may write. */
export type EditableFields<T extends RowMeta> = Omit<T, ServerColumns>;
/** Create payload. `id` is a client UUID so retries are idempotent (plan §8.2-7). */
export type NewRow<T extends RowMeta> = EditableFields<T> & { id: string };
export type RowPatch<T extends RowMeta> = Partial<EditableFields<T>>;
export type TripPatch = Partial<Omit<Trip, 'id' | 'version'>>;

export type EnterResult =
  | { ok: true; member: Member }
  | { ok: false; reason: 'invalid_name' | 'error'; message?: string };

export type ChangeEntity = EntityName | 'trip' | 'budgets' | 'fxRates' | 'resourceLinks' | 'liveLocations';

/**
 * Realtime-style notification (plan §8.2-2). `changed` → refetch; `reconnected`
 * → full refetch (also sent shortly after the first subscribe); `disconnected`
 * → the live channel is down, so the provider polls until `reconnected`.
 */
export type ChangeEvent = { type: 'changed'; entity: ChangeEntity } | { type: 'reconnected' } | { type: 'disconnected' };

/** One position reading (plan §7.8). `measuredAt` is server-corrected. */
export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  measuredAt: string;
}

export type ShareStatus = 'ok' | 'stale' | 'not_sharing_device';

export interface LocationsSnapshot {
  locations: LiveLocation[];
  /** This browser's trip session (compare with `sharingSessionId`). */
  mySessionId: string | null;
}

export interface UploadFile {
  /** File name inside the new folder (sanitised by the repository). */
  name: string;
  blob: Blob;
  contentType: string;
}

export type DataErrorCode = 'not_connected' | 'network' | 'unknown';

export class RepositoryError extends Error {
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

export interface DataError {
  code: DataErrorCode;
  message: string;
}

export function toDataError(e: unknown): DataError {
  if (e instanceof RepositoryError) return { code: e.code, message: e.message };
  return { code: 'unknown', message: e instanceof Error ? e.message : String(e) };
}

export interface TripRepository {
  readonly kind: 'mock' | 'supabase' | 'unconnected';
  /**
   * True when the database itself keeps Prelude activity status in step with
   * linked itinerary items (link/unlink/adoption/delete triggers). The UI then
   * writes only the link, never the derived status (plan §7.3).
   */
  readonly serverManagesPreludeStatus: boolean;

  // ── session (plan §8.1) ──
  /** Member of a valid, non-revoked session for this browser, or null. Never trusts localStorage alone. */
  getSession(): Promise<Member | null>;
  /** Name entry: trimmed, case-insensitive 'Eren' | 'Amy'. */
  enter(name: string): Promise<EnterResult>;
  leave(): Promise<void>;

  // ── time (plan §9) ──
  /** serverNow − Date.now(), in ms. */
  serverTimeOffset(): Promise<number>;

  // ── reads ──
  loadSnapshot(): Promise<TripSnapshot>;
  /** Returns an unsubscribe function. */
  subscribe(onChange: (e: ChangeEvent) => void): () => void;

  // ── writes: resolve to SaveResult, never throw for conflicts ──
  create<E extends EntityName>(entity: E, row: NewRow<EntityRowMap[E]>): Promise<SaveResult<EntityRowMap[E]>>;
  /** Optimistic lock: succeeds only when the stored version equals `expectedVersion`. */
  update<E extends EntityName>(
    entity: E,
    id: string,
    patch: RowPatch<EntityRowMap[E]>,
    expectedVersion: number,
  ): Promise<SaveResult<EntityRowMap[E]>>;
  /** Sets `deletedAt` (restorable). Same version check as update. */
  softDelete<E extends EntityName>(entity: E, id: string, expectedVersion: number): Promise<SaveResult<EntityRowMap[E]>>;
  updateTrip(patch: TripPatch, expectedVersion: number): Promise<SaveResult<Trip>>;
  /** Upsert by scope (unique per trip). */
  setBudget(budget: Omit<TripBudget, 'tripId'>): Promise<SaveResult<TripBudget>>;
  /** Idempotent by `id`. */
  linkResource(link: Omit<ResourceLink, 'tripId'>): Promise<SaveResult<ResourceLink>>;
  unlinkResource(id: string): Promise<SaveResult<ResourceLink>>;

  // ── files (plan §8.3): private storage, short-lived signed URLs ──
  /** Uploads into one new `<trip_id>/<uuid>/` folder; resolves to the stored paths (same order). Throws RepositoryError. */
  uploadFiles(files: UploadFile[]): Promise<string[]>;
  /** Best-effort removal (cleanup after a failed row create). */
  removeFiles(paths: string[]): Promise<void>;
  /** Short-lived URL for one stored path. Never persist it. Throws RepositoryError. */
  signedUrl(path: string, ttlSeconds?: number): Promise<string>;

  // ── live location (plan §7.8). Throw RepositoryError on failure ──
  loadLocations(): Promise<LocationsSnapshot>;
  /** `takeover` = turn on / take over from another device of the same profile. */
  shareLocation(fix: LocationFix, takeover: boolean): Promise<{ status: ShareStatus; row: LiveLocation | null }>;
  /** Stops sharing for the whole profile; the last position stays. */
  stopSharing(): Promise<LiveLocation | null>;
  /** Deletes the profile's row. */
  clearMyLocation(): Promise<void>;
}
