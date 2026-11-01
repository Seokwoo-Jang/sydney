// Fictional test data only (trip year 2030).
import type { Expense, ItineraryItem, RowMeta } from '@/lib/types';

const meta = (id: string): RowMeta => ({
  id,
  tripId: 't1',
  createdBy: null,
  updatedBy: null,
  createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z',
  version: 1,
  deletedAt: null,
});

export function item(id: string, p: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    ...meta(id),
    dayId: 'd',
    date: '2030-12-28',
    timeKind: 'timed',
    startTime: '09:00',
    endTime: null,
    endDate: null,
    timezone: 'Australia/Sydney',
    category: 'explore',
    status: 'planned',
    title: id,
    summary: '',
    detail: '',
    place: '',
    mapUrl: null,
    mapLat: null,
    mapLng: null,
    mapSource: null,
    travelMode: null,
    participants: 'together',
    bookingId: null,
    continuesFromPreviousDay: false,
    sortOrder: 0,
    isExample: true,
    ...p,
  };
}

export function expense(id: string, p: Partial<Expense> = {}): Expense {
  return {
    ...meta(id),
    date: '2030-12-27',
    kind: 'expense',
    status: 'paid',
    title: id,
    amountMinor: 10000,
    currency: 'AUD',
    payerId: 'm-eren',
    splitMode: 'equal',
    splitEren: 5000,
    splitAmy: 5000,
    budgetScope: 'shared',
    fxRate: null,
    fxRateDate: null,
    fxLocked: false,
    fxManual: false,
    krwChargedMinor: null,
    category: 'food',
    bookingIds: [],
    itineraryItemIds: [],
    refundOfId: null,
    ...p,
  };
}
