'use client';
// Booking summaries (plan §7.1): boarding-pass flight, car pass, stay card,
// document row. Booking references never appear here — only in the detail sheet.
import { Badge, ButtonLink, Icon, MemberMarks } from '@/components/ui';
import { mapHref } from '@/lib/maps';
import type { Booking, Member, TripDocument } from '@/lib/types';
import { formatWallTime, S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import {
  currentOrNextStay,
  departsIn,
  isFlight,
  isStay,
  flightDuration,
  flightTimes,
  rentalDays,
  stayGuests,
  stayNights,
  zoneAbbr,
  type CarBooking,
  type FlightBooking,
  type StayBooking,
} from './bookingUtils';
import styles from './Bookings.module.css';

export function StatusBadges({ booking, onDark }: { booking: Booking; onDark?: boolean }) {
  return (
    <span className={[styles.badges, onDark ? styles.onDark : ''].join(' ')}>
      <Badge tone={booking.status === 'booked' ? 'soft' : 'neutral'} className={booking.status === 'cancelled' ? styles.cancelled : undefined}>
        {S.labels.bookingStatus[booking.status]}
      </Badge>
      <Badge tone={booking.paymentStatus === 'paid' ? 'soft' : 'neutral'}>{S.labels.paymentStatus[booking.paymentStatus]}</Badge>
    </span>
  );
}

export function FlightPass({
  booking,
  now,
  isNext,
  onOpen,
}: {
  booking: FlightBooking;
  now: Date | null;
  isNext: boolean;
  onOpen: (id: string) => void;
}) {
  const d = booking.detail;
  const { departAt } = flightTimes(d);
  const departZone = zoneAbbr(d.departTimezone, d.departDate, d.departTime);
  const arriveZone = zoneAbbr(d.arriveTimezone, d.arriveDate, d.arriveTime);
  // A long, low pass: one line each for flight, route (with terminals) and times; the date
  // sits on the stub. A booked and paid flight needs no status chips; anything else
  // (considering, unpaid, cancelled) still shows them.
  const usual = booking.status === 'booked' && booking.paymentStatus === 'paid';
  const nextDay = d.arriveDate !== d.departDate;
  return (
    <button
      type="button"
      className={[styles.pass, booking.status === 'cancelled' ? styles.passCancelled : ''].join(' ')}
      onClick={() => onOpen(booking.id)}
    >
      <span className={styles.passMain}>
        <span className={styles.passTop}>
          <span className={styles.passFlight}>
            {d.carrier} · {d.flightNumber}
          </span>
        </span>
        <span className={styles.route}>
          <b>{d.from}</b>
          {d.departTerminal ? <small className={styles.terminal}>{d.departTerminal}</small> : null}
          <span className={styles.routeLine} aria-hidden="true">
            <Icon name="plane" size={14} style={{ transform: 'rotate(45deg)' }} />
          </span>
          <b>{d.to}</b>
          {d.arriveTerminal ? <small className={styles.terminal}>{d.arriveTerminal}</small> : null}
        </span>
        <span className={styles.times}>
          <span className={styles.time}>
            {formatWallTime(d.departTime)} <abbr title={S.checklist.zones[d.departTimezone] ?? d.departTimezone}>{departZone}</abbr>
          </span>
          <span className={[styles.time, styles.timesEnd].join(' ')}>
            {formatWallTime(d.arriveTime)} <abbr title={S.checklist.zones[d.arriveTimezone] ?? d.arriveTimezone}>{arriveZone}</abbr>
            {nextDay ? (
              <sup className={styles.plusDay} title={formatDayLabel(d.arriveDate)}>
                +1<span className="sr-only"> {S.itinerary.nextDay}</span>
              </sup>
            ) : null}
          </span>
        </span>
        {usual ? null : <StatusBadges booking={booking} onDark />}
      </span>
      <span className={styles.stub}>
        <span className="sr-only">{isNext ? S.checklist.nextFlight : S.checklist.flight}</span>
        <span>{formatDayLabel(d.departDate)}</span>
        <b>{now ? departsIn(departAt, now) : ' '}</b>
        <span>{flightDuration(d)}</span>
      </span>
    </button>
  );
}

export function CarPass({ booking, onOpen }: { booking: CarBooking; onOpen: (id: string) => void }) {
  const d = booking.detail;
  return (
    <button type="button" className={styles.carPass} onClick={() => onOpen(booking.id)}>
      <span className={styles.carTop}>
        <span className={styles.carCompany}>
          <Icon name="car" size={18} />
          {d.company || booking.title}
        </span>
        <StatusBadges booking={booking} />
      </span>
      <span className={styles.carRow}>
        <span className={styles.carEnd}>
          <small>{S.checklist.pickUp}</small>
          <b>{formatWallTime(d.pickUp.time)}</b>
          <span>{formatDayLabel(d.pickUp.date)}</span>
          <span className={styles.place}>{d.pickUp.place}</span>
        </span>
        <span className={styles.carMid}>{S.checklist.rentalDays(rentalDays(d))}</span>
        <span className={[styles.carEnd, styles.carEndRight].join(' ')}>
          <small>{S.checklist.dropOff}</small>
          <b>{formatWallTime(d.dropOff.time)}</b>
          <span>{formatDayLabel(d.dropOff.date)}</span>
          <span className={styles.place}>{d.dropOff.place}</span>
        </span>
      </span>
    </button>
  );
}

export function StayCard({ booking, label, onOpen }: { booking: StayBooking; label?: string; onOpen: (id: string) => void }) {
  const d = booking.detail;
  const map = mapHref({ mapUrl: null, place: d.address || d.name, mapLat: d.lat ?? null, mapLng: d.lng ?? null });
  return (
    <div className={styles.stay}>
      <button type="button" className={styles.stayMain} onClick={() => onOpen(booking.id)}>
        <span className={styles.stayIcon} aria-hidden="true">
          <Icon name="bed" size={20} />
        </span>
        <span className={styles.stayText}>
          {label && <span className={styles.stayLabel}>{label}</span>}
          <b className={styles.stayName}>{d.name || booking.title}</b>
          <span className={styles.stayDates}>
            {formatDayLabel(d.checkInDate)} – {formatDayLabel(d.checkOutDate)} · {S.checklist.nights(stayNights(d))}
          </span>
          <span className={styles.stayMeta}>
            <MemberMarks who={stayGuests(d)} size="sm" />
            <StatusBadges booking={booking} />
          </span>
        </span>
      </button>
      {map && (
        <ButtonLink href={map.href} external size="sm" variant="link" iconStart="external" className={styles.mapLink}>
          {map.kind === 'link' ? S.maps.open : S.maps.search}
          <span className="sr-only"> ({S.ui.externalLink})</span>
        </ButtonLink>
      )}
    </div>
  );
}

export function DocumentRow({ doc, members, onOpen }: { doc: TripDocument; members: Member[]; onOpen: (id: string) => void }) {
  const subject = members.find((m) => m.id === doc.subjectMemberId);
  return (
    <li>
      <button type="button" className={styles.doc} onClick={() => onOpen(doc.id)}>
        <span className={styles.docIcon} aria-hidden="true">
          <Icon name="note" size={18} />
        </span>
        <span className={styles.docText}>
          <b>{doc.title}</b>
          <span>
            {[subject?.displayName ?? S.checklist.nobody, doc.expiryOrDueDate ? `${S.checklist.checkBy} ${formatDayLabel(doc.expiryOrDueDate)}` : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <Badge tone={doc.status === 'ready' ? 'soft' : doc.status === 'in_progress' ? 'brass' : 'neutral'}>
          {S.labels.documentStatus[doc.status]}
        </Badge>
      </button>
    </li>
  );
}

/** Board summary: the next flight as a pass and tonight's / the next stay (plan §5.3). */
export function NextUp({
  bookings,
  now,
  today,
  onOpen,
}: {
  bookings: Booking[];
  now: Date | null;
  today: string | null;
  onOpen: (id: string) => void;
}) {
  if (!now || !today) return null;
  const next = bookings
    .filter(isFlight)
    .filter((f) => f.status !== 'cancelled' && flightTimes(f.detail).departAt.getTime() > now.getTime())
    .sort((a, b) => flightTimes(a.detail).departAt.getTime() - flightTimes(b.detail).departAt.getTime())[0];
  const stay = currentOrNextStay(bookings.filter(isStay), today);
  if (!next && !stay) return null;
  return (
    <div className={styles.nextUp}>
      {next && <FlightPass booking={next} now={now} isNext onOpen={onOpen} />}
      {stay && <StayCard booking={stay.stay} label={stay.tonight ? S.checklist.tonight : S.checklist.nextStay} onOpen={onOpen} />}
    </div>
  );
}
