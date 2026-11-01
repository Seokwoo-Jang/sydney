'use client';
// Countdown chip + flight lookups (plan §9.1). Departure comes from
// trips.start_date and the outbound flight booking — never hard-coded.
import { useMemo } from 'react';
import type { Booking, FlightDetail, Trip } from '../types';
import { countdown, type CountdownState } from '../time/countdown';
import { formatDayLabel, zonedToInstant } from '../time/zone';
import { formatWallTime } from '../strings';
import { useBookings, useServerNow, useTrip } from '../data/hooks';

export interface FlightSummary {
  booking: Booking;
  detail: FlightDetail;
  departAt: Date;
  airportBy: Date | null;
  /** 'SB101 · Thu, 26 Dec, 9:50 pm' (departure wall clock) */
  label: string;
}

export function flightSummaries(bookings: Booking[]): FlightSummary[] {
  return bookings
    .filter((b): b is Booking & { detail: FlightDetail } => b.detail.kind === 'flight' && b.status !== 'cancelled')
    .map((b) => {
      const d = b.detail;
      return {
        booking: b,
        detail: d,
        departAt: zonedToInstant(d.departDate, d.departTime, d.departTimezone),
        airportBy: d.checkInBy ? zonedToInstant(d.checkInBy.date, d.checkInBy.time, d.checkInBy.timezone) : null,
        label: `${d.flightNumber} · ${formatDayLabel(d.departDate)}, ${formatWallTime(d.departTime)}`,
      };
    })
    .sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
}

/** Flight that starts the trip: departs on the start date, else the earliest one. */
export function outboundFlight(trip: Trip, bookings: Booking[]): FlightSummary | null {
  const all = flightSummaries(bookings);
  return all.find((f) => f.detail.departDate === trip.startDate) ?? all[0] ?? null;
}

/** First flight departing after `now`. */
export function nextFlight(bookings: Booking[], now: Date): FlightSummary | null {
  return flightSummaries(bookings).find((f) => f.departAt.getTime() > now.getTime()) ?? null;
}

export interface CountdownInfo {
  state: CountdownState;
  outbound: FlightSummary | null;
  now: Date;
}

/** null until trip data and the clock are ready. */
export function useCountdown(): CountdownInfo | null {
  const trip = useTrip();
  const bookings = useBookings();
  const now = useServerNow(30_000);
  const t = trip.status === 'ready' ? trip.data.trip : null;
  const b = bookings.status === 'ready' ? bookings.data : null;
  return useMemo(() => {
    if (!t || !b || !now) return null;
    const outbound = outboundFlight(t, b);
    const state = countdown(now, {
      startDate: t.startDate,
      endDate: t.endDate,
      homeTimezone: t.homeTimezone,
      tripTimezone: t.timezone,
      departureAt: outbound?.departAt ?? null,
      airportBy: outbound?.airportBy ?? null,
    });
    return { state, outbound, now };
  }, [t, b, now]);
}
