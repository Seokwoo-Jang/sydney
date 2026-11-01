// snake_case rows (PostgREST / to_jsonb) ⇄ camelCase domain types (lib/types.ts).
// Every entity has an explicit column list typed against its interface, so a
// missing or extra field is a compile error and unknown keys never leak either
// way (the server also rejects unknown columns).
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
  PushDevice,
  Resource,
  ResourceLink,
  RowMeta,
  Settlement,
  Trip,
  TripBudget,
  TripDay,
  TripDocument,
} from '../../types';
import type { EditableFields, EntityName, EntityRowMap, TripPatch } from '../repository';

type Cols<T> = { readonly [K in keyof T]-?: string };
export type Json = Record<string, unknown>;

const META: Cols<RowMeta> = {
  id: 'id',
  tripId: 'trip_id',
  createdBy: 'created_by',
  updatedBy: 'updated_by',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  version: 'version',
  deletedAt: 'deleted_at',
};

const DAYS: Cols<EditableFields<TripDay>> = {
  date: 'date',
  dayNumber: 'day_number',
  title: 'title',
  highlight: 'highlight',
  coverAssetId: 'cover_asset_id',
  collageVariant: 'collage_variant',
  defaultPhotoRemoved: 'default_photo_removed',
};

const BOOKINGS: Cols<EditableFields<Booking>> = {
  kind: 'kind',
  title: 'title',
  status: 'status',
  paymentStatus: 'payment_status',
  reference: 'reference',
  notes: 'notes',
  detail: 'detail', // jsonb, stored with the camelCase keys of FlightDetail / StayDetail / CarDetail
};

const ITINERARY: Cols<EditableFields<ItineraryItem>> = {
  dayId: 'day_id',
  date: 'date', // rewritten by the server from day_id
  timeKind: 'time_kind',
  startTime: 'start_time',
  endTime: 'end_time',
  endDate: 'end_date',
  timezone: 'timezone',
  category: 'category',
  status: 'status',
  title: 'title',
  summary: 'summary',
  detail: 'detail',
  place: 'place',
  mapUrl: 'map_url',
  mapLat: 'map_lat',
  mapLng: 'map_lng',
  mapSource: 'map_source',
  travelMode: 'travel_mode',
  participants: 'participants',
  bookingId: 'booking_id',
  continuesFromPreviousDay: 'continues_from_previous_day',
  sortOrder: 'sort_order',
  isExample: 'is_example',
};

const PRELUDE: Cols<EditableFields<PreludeActivity>> = {
  kind: 'kind',
  title: 'title',
  notes: 'notes',
  peopleNote: 'people_note',
  status: 'status',
  itineraryItemId: 'itinerary_item_id',
  resourceId: 'resource_id',
  sortOrder: 'sort_order',
  isExample: 'is_example',
};

const CHECKLIST: Cols<EditableFields<ChecklistItem>> = {
  kind: 'kind',
  category: 'category',
  title: 'title',
  assignee: 'assignee',
  quantity: 'quantity',
  dueDate: 'due_date',
  priority: 'priority',
  checked: 'checked',
  isApplicable: 'is_applicable',
  notes: 'notes',
  bookingId: 'booking_id',
  documentId: 'document_id',
  resourceIds: 'resource_ids',
  sortOrder: 'sort_order',
};

const DOCUMENTS: Cols<EditableFields<TripDocument>> = {
  title: 'title',
  subjectMemberId: 'subject_member_id',
  status: 'status',
  expiryOrDueDate: 'expiry_or_due_date',
  assetId: 'asset_id',
  referenceUrl: 'reference_url',
};

const EXPENSES: Cols<EditableFields<Expense>> = {
  date: 'date',
  kind: 'kind',
  status: 'status',
  title: 'title',
  amountMinor: 'amount_minor',
  currency: 'currency',
  payerId: 'payer_id',
  splitMode: 'split_mode',
  splitEren: 'split_eren',
  splitAmy: 'split_amy',
  budgetScope: 'budget_scope',
  fxRate: 'fx_rate',
  fxRateDate: 'fx_rate_date',
  fxLocked: 'fx_locked',
  fxManual: 'fx_manual',
  krwChargedMinor: 'krw_charged_minor',
  category: 'category',
  bookingIds: 'booking_ids',
  itineraryItemIds: 'itinerary_item_ids',
  refundOfId: 'refund_of_id',
};

const SETTLEMENTS: Cols<EditableFields<Settlement>> = {
  fromMember: 'from_member',
  toMember: 'to_member',
  amountMinor: 'amount_minor',
  currency: 'currency',
  date: 'date',
  fxRate: 'fx_rate',
  note: 'note',
};

const JOURNAL: Cols<EditableFields<JournalEntry>> = {
  dayId: 'day_id',
  authorId: 'author_id',
  assetId: 'asset_id',
  body: 'body',
};

const RESOURCES: Cols<EditableFields<Resource>> = {
  title: 'title',
  url: 'url',
  category: 'category',
  note: 'note',
  pinnedOrder: 'pinned_order',
};

/** `url` / `thumbUrl` are resolved in the browser and never stored. */
const ASSETS: Cols<Omit<EditableFields<FileAsset>, 'url' | 'thumbUrl'>> = {
  storagePath: 'storage_path',
  displayPath: 'display_path',
  thumbPath: 'thumb_path',
  width: 'width',
  height: 'height',
  focalX: 'focal_x',
  focalY: 'focal_y',
  zoom: 'zoom',
  mime: 'mime',
  bytes: 'bytes',
  kind: 'kind',
  isDefault: 'is_default',
  dayId: 'day_id',
  bookingId: 'booking_id',
  documentId: 'document_id',
  caption: 'caption',
  sortOrder: 'sort_order',
};

const EDITABLE: { [E in EntityName]: Readonly<Record<string, string>> } = {
  days: DAYS,
  itinerary: ITINERARY,
  prelude: PRELUDE,
  checklist: CHECKLIST,
  bookings: BOOKINGS,
  documents: DOCUMENTS,
  expenses: EXPENSES,
  settlements: SETTLEMENTS,
  journal: JOURNAL,
  resources: RESOURCES,
  assets: ASSETS,
};

export const TABLE: { [E in EntityName]: string } = {
  days: 'trip_days',
  itinerary: 'itinerary_items',
  prelude: 'prelude_activities',
  checklist: 'checklist_items',
  bookings: 'bookings',
  documents: 'documents',
  expenses: 'expenses',
  settlements: 'settlements',
  journal: 'journal_entries',
  resources: 'resources',
  assets: 'file_assets',
};

const TRIP: Cols<Trip> = {
  id: 'id',
  title: 'title',
  subtitle: 'subtitle',
  startDate: 'start_date',
  endDate: 'end_date',
  timezone: 'timezone',
  homeTimezone: 'home_timezone',
  displayCurrencyFirst: 'display_currency_first',
  preludeGoal: 'prelude_goal',
  version: 'version',
};

const MEMBER: Cols<Member> = { id: 'id', tripId: 'trip_id', profileKey: 'profile_key', displayName: 'display_name' };
const BUDGET: Cols<TripBudget> = { tripId: 'trip_id', scope: 'scope', amountMinor: 'amount_minor', currency: 'currency' };
const FX: Cols<FxRate> = { rateDate: 'rate_date', base: 'base', quote: 'quote', rate: 'rate', source: 'source' };
const LINK: Cols<ResourceLink> = {
  id: 'id',
  tripId: 'trip_id',
  resourceId: 'resource_id',
  itineraryItemId: 'itinerary_item_id',
  preludeActivityId: 'prelude_activity_id',
  documentId: 'document_id',
};
const LOCATION: Cols<LiveLocation> = {
  tripId: 'trip_id',
  memberId: 'member_id',
  lat: 'lat',
  lng: 'lng',
  accuracyM: 'accuracy_m',
  measuredAt: 'measured_at',
  updatedAt: 'updated_at',
  isSharing: 'is_sharing',
  sharingSessionId: 'sharing_session_id',
};
// Keys (p256dh, auth) are written once by the RPC and never read back.
const PUSH_DEVICE: Cols<PushDevice> = {
  id: 'id',
  endpoint: 'endpoint',
  deviceLabel: 'device_label',
  enabledKinds: 'enabled_kinds',
  createdAt: 'created_at',
  lastSuccessAt: 'last_success_at',
};
/** Column list for `select(...)` on push_subscriptions. */
export const PUSH_DEVICE_COLUMNS = Object.values(PUSH_DEVICE).join(',');

// numeric / bigint can arrive as strings depending on the path; timestamps carry
// microseconds and '+00:00'. Normalise both so the UI sees what the mock gives.
const NUMERIC = new Set([
  'amount_minor',
  'split_eren',
  'split_amy',
  'krw_charged_minor',
  'fx_rate',
  'rate',
  'bytes',
  'lat',
  'lng',
  'accuracy_m',
  'map_lat',
  'map_lng',
  'focal_x',
  'focal_y',
  'zoom',
]);
const TIMESTAMP = new Set(['created_at', 'updated_at', 'deleted_at', 'measured_at', 'last_success_at']);

/** '2026-11-01 03:04:05.123456+00' / '…T…+00:00' → '2026-11-01T03:04:05.123Z'. */
export function isoInstant(v: string): string {
  const d = new Date(v.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

function readValue(col: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (NUMERIC.has(col) && typeof v === 'string') return Number(v);
  if (TIMESTAMP.has(col) && typeof v === 'string') return isoInstant(v);
  return v;
}

function pick<T>(cols: Readonly<Record<string, string>>, row: Json): T {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) out[key] = readValue(col, row[col]);
  return out as T;
}

/** Snake row → domain row for one entity (meta + editable columns only). */
export function rowFrom<E extends EntityName>(entity: E, row: Json): EntityRowMap[E] {
  return pick<EntityRowMap[E]>({ ...META, ...EDITABLE[entity] }, row);
}

/**
 * Domain payload → snake columns. Only editable columns that are present are
 * sent; server columns, `url`/`thumbUrl` and unknown keys are dropped.
 * `withId` keeps `id` for idempotent creates.
 */
export function rowTo(entity: EntityName, data: Record<string, unknown>, withId = false): Json {
  const out: Json = {};
  if (withId && typeof data.id === 'string') out.id = data.id;
  for (const [key, col] of Object.entries(EDITABLE[entity])) {
    if (key in data && data[key] !== undefined) out[col] = data[key];
  }
  return out;
}

export const tripFrom = (row: Json): Trip => pick<Trip>(TRIP, row);
export const memberFrom = (row: Json): Member => pick<Member>(MEMBER, row);
export const budgetFrom = (row: Json): TripBudget => pick<TripBudget>(BUDGET, row);
export const fxFrom = (row: Json): FxRate => pick<FxRate>(FX, row);
export const linkFrom = (row: Json): ResourceLink => pick<ResourceLink>(LINK, row);
export const locationFrom = (row: Json): LiveLocation => pick<LiveLocation>(LOCATION, row);
export const pushDeviceFrom = (row: Json): PushDevice => pick<PushDevice>(PUSH_DEVICE, row);

/** Trip settings patch → update_trip keys (id / version are never sent). */
export function tripPatchTo(patch: TripPatch): Json {
  const out: Json = {};
  for (const [key, col] of Object.entries(TRIP)) {
    if (key === 'id' || key === 'version') continue;
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export function linkTo(link: Omit<ResourceLink, 'tripId'>): Json {
  return {
    id: link.id,
    resource_id: link.resourceId,
    itinerary_item_id: link.itineraryItemId,
    prelude_activity_id: link.preludeActivityId,
    document_id: link.documentId,
  };
}

/** Realtime table → snapshot key it invalidates. */
export const TABLE_ENTITY = {
  trips: 'trip',
  trip_budgets: 'budgets',
  fx_rates: 'fxRates',
  trip_days: 'days',
  bookings: 'bookings',
  itinerary_items: 'itinerary',
  resources: 'resources',
  prelude_activities: 'prelude',
  documents: 'documents',
  checklist_items: 'checklist',
  expenses: 'expenses',
  settlements: 'settlements',
  journal_entries: 'journal',
  file_assets: 'assets',
  resource_links: 'resourceLinks',
  live_locations: 'liveLocations',
} as const;
