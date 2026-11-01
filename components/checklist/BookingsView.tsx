'use client';
// Bookings: Flights / Stays / Cars / Documents (plan §4.3, §7.1, §7.4 C).
import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import type { Booking, BookingKind, Member, TripDocument } from '@/lib/types';
import { S } from '@/lib/strings';
import { CarPass, DocumentRow, FlightPass, StayCard } from './BookingCards';
import { flightTimes, isCar, isFlight, isStay } from './bookingUtils';
import styles from './Bookings.module.css';

export type NewBookingKind = BookingKind | 'document';

export function BookingsView({
  bookings,
  documents,
  members,
  now,
  onOpen,
  onAdd,
}: {
  bookings: Booking[];
  documents: TripDocument[];
  members: Member[];
  now: Date | null;
  onOpen: (id: string) => void;
  onAdd: (kind: NewBookingKind) => void;
}) {
  const flights = bookings.filter(isFlight).sort((a, b) => flightTimes(a.detail).departAt.getTime() - flightTimes(b.detail).departAt.getTime());
  const nextId = now
    ? flights.find((f) => f.status !== 'cancelled' && flightTimes(f.detail).departAt.getTime() > now.getTime())?.id
    : undefined;
  const stays = bookings.filter(isStay).sort((a, b) => a.detail.checkInDate.localeCompare(b.detail.checkInDate));
  const cars = bookings.filter(isCar).sort((a, b) => a.detail.pickUp.date.localeCompare(b.detail.pickUp.date));

  const group = (kind: NewBookingKind, title: string, count: number, body: ReactNode) => (
    <section className={styles.group} aria-label={title}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{title}</h3>
        <Button variant="ghost" size="sm" iconStart="plus" onClick={() => onAdd(kind)}>
          {S.checklist.add[kind]}
        </Button>
      </div>
      {count ? body : <p className={styles.empty}>{S.checklist.emptyKind[kind]}</p>}
    </section>
  );

  return (
    <div className={styles.view}>
      {group(
        'flight',
        S.labels.bookingKinds.flight,
        flights.length,
        <div className={styles.stack}>
          {flights.map((f) => (
            <FlightPass key={f.id} booking={f} now={now} isNext={f.id === nextId} onOpen={onOpen} />
          ))}
        </div>,
      )}
      {group(
        'stay',
        S.labels.bookingKinds.stay,
        stays.length,
        <div className={styles.stack}>
          {stays.map((s) => (
            <StayCard key={s.id} booking={s} onOpen={onOpen} />
          ))}
        </div>,
      )}
      {group(
        'car',
        S.labels.bookingKinds.car,
        cars.length,
        <div className={styles.stack}>
          {cars.map((c) => (
            <CarPass key={c.id} booking={c} onOpen={onOpen} />
          ))}
        </div>,
      )}
      {group(
        'document',
        S.labels.documents,
        documents.length,
        <ul className={styles.docs}>
          {documents.map((d) => (
            <DocumentRow key={d.id} doc={d} members={members} onOpen={onOpen} />
          ))}
        </ul>,
      )}
    </div>
  );
}
