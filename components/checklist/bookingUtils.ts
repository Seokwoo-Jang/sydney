// Display helpers for bookings (plan §7.1). Pure; every time names its zone.
import type { Booking, CarDetail, FlightDetail, StayDetail } from '@/lib/types';
import { formatWallTime, S } from '@/lib/strings';
import { diffDays, formatDayLabel, zonedToInstant } from '@/lib/time/zone';

export type FlightBooking = Booking & { detail: FlightDetail };
export type StayBooking = Booking & { detail: StayDetail };
export type CarBooking = Booking & { detail: CarDetail };

export const isFlight = (b: Booking): b is FlightBooking => b.detail.kind === 'flight';
export const isStay = (b: Booking): b is StayBooking => b.detail.kind === 'stay';
export const isCar = (b: Booking): b is CarBooking => b.detail.kind === 'car';

/** The name a booking goes by, as its card shows it: a stay's name, a car's company, else the title. */
export function bookingName(b: Booking): string {
  const d = b.detail;
  if (d.kind === 'stay') return d.name?.trim() || b.title;
  if (d.kind === 'car') return d.company?.trim() || b.title;
  return b.title;
}

export const ZONES = ['Asia/Seoul', 'Australia/Sydney'] as const;

/** 'KST' / 'AEDT' / 'AEST' for the wall clock on that date. */
export function zoneAbbr(tz: string, date: string, time = '12:00'): string {
  if (tz === 'Asia/Seoul') return 'KST';
  try {
    const at = zonedToInstant(date, time, tz);
    const part = new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

export function flightTimes(d: FlightDetail): { departAt: Date; arriveAt: Date } {
  return {
    departAt: zonedToInstant(d.departDate, d.departTime, d.departTimezone),
    arriveAt: zonedToInstant(d.arriveDate, d.arriveTime, d.arriveTimezone),
  };
}

export function flightDuration(d: FlightDetail): string {
  const { departAt, arriveAt } = flightTimes(d);
  const mins = Math.max(0, Math.round((arriveAt.getTime() - departAt.getTime()) / 60000));
  return S.checklist.duration(Math.floor(mins / 60), mins % 60);
}

/** 'in 55 days' / 'in 5h 12m' / 'Departed'. */
export function departsIn(departAt: Date, now: Date): string {
  const ms = departAt.getTime() - now.getTime();
  if (ms <= 0) return S.checklist.departed;
  const mins = Math.ceil(ms / 60000);
  if (mins < 24 * 60) return S.checklist.inHours(Math.floor(mins / 60), mins % 60);
  return S.checklist.inDays(Math.floor(mins / (24 * 60)));
}

/** '9:50 pm · Thu, 26 Dec · KST' */
export function wallLine(date: string, time: string, tz: string): string {
  return `${formatWallTime(time)} · ${formatDayLabel(date)} · ${zoneAbbr(tz, date, time)}`;
}

export function terminalText(code: string, terminal: string | undefined): string {
  return terminal ? `${code} ${terminal}` : S.checklist.terminalTbc;
}

export function stayNights(d: StayDetail): number {
  return Math.max(0, diffDays(d.checkOutDate, d.checkInDate));
}

export function rentalDays(d: CarDetail): number {
  return Math.max(1, diffDays(d.dropOff.date, d.pickUp.date));
}

/** Stay that covers `today` (check-in ≤ today < check-out), else the next one. */
export function currentOrNextStay(stays: StayBooking[], today: string): { stay: StayBooking; tonight: boolean } | null {
  const live = stays.filter((s) => s.status !== 'cancelled').sort((a, b) => a.detail.checkInDate.localeCompare(b.detail.checkInDate));
  const now = live.find((s) => s.detail.checkInDate <= today && today < s.detail.checkOutDate);
  if (now) return { stay: now, tonight: true };
  const next = live.find((s) => s.detail.checkInDate > today);
  return next ? { stay: next, tonight: false } : null;
}

export function stayGuests(d: StayDetail): 'together' | 'eren' | 'amy' {
  return d.guests === 'both' ? 'together' : d.guests;
}
