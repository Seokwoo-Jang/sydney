// Domain types shared by UI, data hooks and pure logic.
// Field names are camelCase versions of the SQL columns (plan §10).
// Dates are calendar dates 'YYYY-MM-DD'; times are wall-clock 'HH:mm' in `timezone`.

export type ProfileKey = 'eren' | 'amy';
export type Participants = 'together' | ProfileKey;
export type Currency = 'AUD' | 'KRW';
export type BudgetScope = 'shared' | ProfileKey;

/** Columns every editable row carries. */
export interface RowMeta {
  id: string;
  tripId: string;
  createdBy: string | null; // member id
  updatedBy: string | null; // member id
  createdAt: string; // ISO instant
  updatedAt: string; // ISO instant
  version: number;
  deletedAt: string | null;
}

export interface Member {
  id: string;
  tripId: string;
  profileKey: ProfileKey;
  displayName: 'Eren' | 'Amy';
}

export interface Trip {
  id: string;
  title: string;
  subtitle: string;
  startDate: string;
  endDate: string;
  timezone: string; // 'Australia/Sydney'
  homeTimezone: string; // 'Asia/Seoul' — countdown uses this calendar
  displayCurrencyFirst: Currency;
  preludeGoal: string;
  version: number;
}

export interface TripBudget {
  tripId: string;
  scope: BudgetScope;
  amountMinor: number;
  currency: Currency;
}

export interface FxRate {
  rateDate: string;
  base: 'AUD';
  quote: 'KRW';
  rate: number; // KRW per 1 AUD
  source: string;
}

export interface TripDay extends RowMeta {
  date: string;
  dayNumber: number;
  title: string;
  highlight: string;
  coverAssetId: string | null;
  collageVariant: number;
}

export type BookingKind = 'flight' | 'stay' | 'car';
export type BookingStatus = 'considering' | 'booked' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid';

export interface FlightDetail {
  kind: 'flight';
  carrier: string;
  flightNumber: string;
  from: string; // IATA
  to: string;
  departDate: string;
  departTime: string;
  departTimezone: string;
  arriveDate: string;
  arriveTime: string;
  arriveTimezone: string;
  departTerminal?: string;
  arriveTerminal?: string;
  checkInBy?: { date: string; time: string; timezone: string }; // recommended airport arrival
  passengers: Array<{ memberId: string; reference?: string; ticketAssetId?: string | null }>;
}

export interface StayDetail {
  kind: 'stay';
  name: string;
  address?: string;
  checkInDate: string;
  checkOutDate: string;
  guests: 'eren' | 'amy' | 'both';
  lat?: number | null;
  lng?: number | null;
}

export interface CarDetail {
  kind: 'car';
  company: string;
  pickUp: { date: string; time: string; place: string; lat?: number | null; lng?: number | null };
  dropOff: { date: string; time: string; place: string; lat?: number | null; lng?: number | null };
}

export interface Booking extends RowMeta {
  kind: BookingKind;
  title: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  reference: string | null; // never rendered in notifications
  notes: string;
  detail: FlightDetail | StayDetail | CarDetail;
}

export type TimeKind = 'timed' | 'all_day' | 'unscheduled';
export type ItineraryCategory = 'transport' | 'explore' | 'dining' | 'rest' | 'business';
export type ItineraryStatus = 'idea' | 'planned' | 'confirmed' | 'completed' | 'cancelled';
export type TravelMode = 'walk' | 'transit' | 'drive';
export type MapSource = 'link' | 'search' | 'pin';

export interface ItineraryItem extends RowMeta {
  dayId: string;
  date: string; // denormalised from the day for convenience
  timeKind: TimeKind;
  startTime: string | null; // 'HH:mm'
  endTime: string | null; // 'HH:mm'; may be earlier than start when crossing midnight
  endDate: string | null; // set when the item ends on another calendar date
  timezone: string;
  category: ItineraryCategory;
  status: ItineraryStatus;
  title: string;
  summary: string;
  detail: string;
  place: string;
  mapUrl: string | null;
  mapLat: number | null;
  mapLng: number | null;
  mapSource: MapSource | null;
  travelMode: TravelMode | null;
  participants: Participants;
  bookingId: string | null;
  continuesFromPreviousDay: boolean;
  sortOrder: number;
  isExample: boolean;
}

export type PreludeKind = 'networking' | 'performance' | 'venue_visit' | 'lesson' | 'other';
export type PreludeStatus = 'idea' | 'planned' | 'done';

export interface PreludeActivity extends RowMeta {
  kind: PreludeKind;
  title: string;
  notes: string;
  peopleNote: string;
  status: PreludeStatus;
  itineraryItemId: string | null;
  resourceId: string | null;
  sortOrder: number;
  isExample: boolean;
}

export type ChecklistKind = 'packing' | 'task';

export interface ChecklistItem extends RowMeta {
  kind: ChecklistKind;
  category: string;
  title: string;
  assignee: ProfileKey | 'both' | null;
  quantity: number | null;
  dueDate: string | null;
  priority: 'low' | 'normal' | 'high';
  checked: boolean;
  isApplicable: boolean;
  notes: string;
  bookingId: string | null;
  documentId: string | null;
  resourceId: string | null;
  sortOrder: number;
}

export interface TripDocument extends RowMeta {
  title: string;
  subjectMemberId: string | null;
  status: 'needed' | 'in_progress' | 'ready';
  expiryOrDueDate: string | null;
  assetId: string | null;
  referenceUrl: string | null;
}

export type ExpenseStatus = 'planned' | 'paid' | 'cancelled';
export type SplitMode = 'equal' | 'eren' | 'amy' | 'custom';
export type ExpenseCategory =
  | 'flights'
  | 'stays'
  | 'food'
  | 'transport'
  | 'sightseeing'
  | 'business'
  | 'shopping'
  | 'other';

export interface Expense extends RowMeta {
  date: string;
  kind: 'expense' | 'refund';
  status: ExpenseStatus;
  title: string;
  amountMinor: number;
  currency: Currency;
  payerId: string | null; // member id
  splitMode: SplitMode;
  splitEren: number; // minor units in `currency`
  splitAmy: number;
  budgetScope: BudgetScope;
  fxRate: number | null; // KRW per AUD used for this row
  fxRateDate: string | null;
  fxLocked: boolean;
  fxManual: boolean;
  krwChargedMinor: number | null;
  category: ExpenseCategory;
  bookingId: string | null;
  itineraryItemId: string | null;
  refundOfId: string | null;
}

export interface Settlement extends RowMeta {
  fromMember: string;
  toMember: string;
  amountMinor: number;
  currency: Currency;
  date: string;
  fxRate: number | null;
  note: string;
}

export interface JournalEntry extends RowMeta {
  dayId: string;
  authorId: string; // member id
  body: string;
}

export type ResourceCategory = 'maps_transport' | 'places_dining' | 'booking_guides' | 'music_connections' | 'other';

export interface Resource extends RowMeta {
  title: string;
  url: string;
  category: ResourceCategory;
  note: string;
  pinnedOrder: number | null; // 1..4 when pinned
}

export interface ResourceLink {
  id: string;
  tripId: string;
  resourceId: string;
  itineraryItemId: string | null;
  preludeActivityId: string | null;
  documentId: string | null;
}

export interface FileAsset extends RowMeta {
  storagePath: string;
  displayPath: string | null;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  focalX: number; // 0..1, default 0.5
  focalY: number; // 0..1, default 0.4
  zoom: number; // >= 1
  mime: string;
  bytes: number;
  kind: 'photo' | 'document';
  dayId: string | null;
  bookingId: string | null;
  documentId: string | null;
  caption: string;
  sortOrder: number;
  /** Resolved, short-lived URL for display. Never persisted. */
  url?: string;
  thumbUrl?: string;
}

export interface LiveLocation {
  tripId: string;
  memberId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  measuredAt: string;
  updatedAt: string;
  isSharing: boolean;
  sharingSessionId: string | null;
}

/** Result of any write. `conflict` carries the latest server row. */
export type SaveResult<T> =
  | { ok: true; row: T }
  | { ok: false; reason: 'conflict'; latest: T | null }
  | { ok: false; reason: 'error'; message: string };
