'use client';
// Booking detail + edit (plan §7.1). The only place booking references show.
// Status and payment are separate fields; expenses link only on request.
import { useState, type ReactNode } from 'react';
import { Button, Field, SaveStatus, Sheet, TextArea, TextInput, useToast, SegmentedControl } from '@/components/ui';
import { newId, useBudget, useEntityOps } from '@/lib/data';
import { formatMoney } from '@/lib/money';
import { mapHref } from '@/lib/maps';
import type { Booking, BookingKind, BookingStatus, CarDetail, FlightDetail, Member, PaymentStatus, StayDetail } from '@/lib/types';
import { formatWallTime, S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { StatusBadges } from './BookingCards';
import { BookingFiles } from './BookingFiles';
import { flightDuration, rentalDays, stayNights, terminalText, wallLine, ZONES } from './bookingUtils';
import { ConfirmDelete, ConflictBlock } from './FormBits';
import { useDraft } from './useDraft';
import { useSaveFlow } from './useSaveFlow';
import form from './Form.module.css';
import styles from './Bookings.module.css';

interface Draft {
  id: string;
  version: number;
  title: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  reference: string;
  notes: string;
  // flight
  carrier: string;
  flightNumber: string;
  from: string;
  to: string;
  departDate: string;
  departTime: string;
  departTimezone: string;
  departTerminal: string;
  arriveDate: string;
  arriveTime: string;
  arriveTimezone: string;
  arriveTerminal: string;
  passengerRefs: Record<string, string>;
  // stay
  name: string;
  address: string;
  checkInDate: string;
  checkOutDate: string;
  guests: StayDetail['guests'];
  // car
  company: string;
  pickUpDate: string;
  pickUpTime: string;
  pickUpPlace: string;
  dropOffDate: string;
  dropOffTime: string;
  dropOffPlace: string;
}

function toDraft(b: Booking | null, members: Member[]): Draft {
  const f = b?.detail.kind === 'flight' ? b.detail : null;
  const s = b?.detail.kind === 'stay' ? b.detail : null;
  const c = b?.detail.kind === 'car' ? b.detail : null;
  const refs: Record<string, string> = {};
  for (const m of members) refs[m.id] = f?.passengers.find((p) => p.memberId === m.id)?.reference ?? '';
  return {
    id: b?.id ?? newId(),
    version: b?.version ?? 0,
    title: b?.title ?? '',
    status: b?.status ?? 'considering',
    paymentStatus: b?.paymentStatus ?? 'unpaid',
    reference: b?.reference ?? '',
    notes: b?.notes ?? '',
    carrier: f?.carrier ?? '',
    flightNumber: f?.flightNumber ?? '',
    from: f?.from ?? '',
    to: f?.to ?? '',
    departDate: f?.departDate ?? '',
    departTime: f?.departTime ?? '',
    departTimezone: f?.departTimezone ?? 'Asia/Seoul',
    departTerminal: f?.departTerminal ?? '',
    arriveDate: f?.arriveDate ?? '',
    arriveTime: f?.arriveTime ?? '',
    arriveTimezone: f?.arriveTimezone ?? 'Australia/Sydney',
    arriveTerminal: f?.arriveTerminal ?? '',
    passengerRefs: refs,
    name: s?.name ?? '',
    address: s?.address ?? '',
    checkInDate: s?.checkInDate ?? '',
    checkOutDate: s?.checkOutDate ?? '',
    guests: s?.guests ?? 'both',
    company: c?.company ?? '',
    pickUpDate: c?.pickUp.date ?? '',
    pickUpTime: c?.pickUp.time ?? '',
    pickUpPlace: c?.pickUp.place ?? '',
    dropOffDate: c?.dropOff.date ?? '',
    dropOffTime: c?.dropOff.time ?? '',
    dropOffPlace: c?.dropOff.place ?? '',
  };
}

const IATA = /^[A-Z]{3}$/;

function validate(kind: BookingKind, d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (kind === 'flight') {
    if (!d.carrier.trim()) e.carrier = S.checklist.titleRequired;
    if (!d.flightNumber.trim()) e.flightNumber = S.checklist.titleRequired;
    if (!IATA.test(d.from)) e.from = S.checklist.airportCodeInvalid;
    if (!IATA.test(d.to)) e.to = S.checklist.airportCodeInvalid;
    if (!d.departDate || !d.departTime) e.departDate = S.checklist.timeRequired;
    if (!d.arriveDate || !d.arriveTime) e.arriveDate = S.checklist.timeRequired;
    else if (d.departDate && d.arriveDate < d.departDate) e.arriveDate = S.checklist.dateOrder;
  }
  if (kind === 'stay') {
    if (!d.name.trim()) e.name = S.checklist.titleRequired;
    if (!d.checkInDate || !d.checkOutDate) e.checkOutDate = S.checklist.timeRequired;
    else if (d.checkOutDate < d.checkInDate) e.checkOutDate = S.checklist.dateOrder;
  }
  if (kind === 'car') {
    if (!d.company.trim()) e.company = S.checklist.titleRequired;
    if (!d.pickUpDate || !d.pickUpTime) e.pickUpDate = S.checklist.timeRequired;
    if (!d.dropOffDate || !d.dropOffTime) e.dropOffDate = S.checklist.timeRequired;
    else if (d.pickUpDate && `${d.dropOffDate} ${d.dropOffTime}` < `${d.pickUpDate} ${d.pickUpTime}`) e.dropOffDate = S.checklist.dateOrder;
  }
  return e;
}

function buildDetail(kind: BookingKind, d: Draft, prev: Booking | null, members: Member[]): FlightDetail | StayDetail | CarDetail {
  if (kind === 'flight') {
    const old = prev?.detail.kind === 'flight' ? prev.detail : null;
    return {
      kind: 'flight',
      carrier: d.carrier.trim(),
      flightNumber: d.flightNumber.trim().toUpperCase(),
      from: d.from,
      to: d.to,
      departDate: d.departDate,
      departTime: d.departTime,
      departTimezone: d.departTimezone,
      arriveDate: d.arriveDate,
      arriveTime: d.arriveTime,
      arriveTimezone: d.arriveTimezone,
      departTerminal: d.departTerminal.trim() || undefined,
      arriveTerminal: d.arriveTerminal.trim() || undefined,
      checkInBy: old?.checkInBy,
      passengers: (old?.passengers.length ? old.passengers.map((p) => p.memberId) : members.map((m) => m.id)).map((memberId) => ({
        ...(old?.passengers.find((p) => p.memberId === memberId) ?? { memberId }),
        reference: d.passengerRefs[memberId]?.trim() || undefined,
      })),
    };
  }
  if (kind === 'stay') {
    const old = prev?.detail.kind === 'stay' ? prev.detail : null;
    return {
      kind: 'stay',
      name: d.name.trim(),
      address: d.address.trim() || undefined,
      checkInDate: d.checkInDate,
      checkOutDate: d.checkOutDate,
      guests: d.guests,
      lat: old?.lat ?? null,
      lng: old?.lng ?? null,
    };
  }
  const old = prev?.detail.kind === 'car' ? prev.detail : null;
  return {
    kind: 'car',
    company: d.company.trim(),
    pickUp: { ...old?.pickUp, date: d.pickUpDate, time: d.pickUpTime, place: d.pickUpPlace.trim() },
    dropOff: { ...old?.dropOff, date: d.dropOffDate, time: d.dropOffTime, place: d.dropOffPlace.trim() },
  };
}

function autoTitle(kind: BookingKind, d: Draft): string {
  if (kind === 'flight') return `${d.carrier.trim()} · ${d.flightNumber.trim().toUpperCase()}`;
  if (kind === 'stay') return d.name.trim();
  return d.company.trim();
}

export function BookingSheet({
  open,
  booking,
  newKind,
  members,
  me,
  partner,
  onClose,
  onOpenExpense,
}: {
  open: boolean;
  booking: Booking | null;
  /** Set when adding a new booking. */
  newKind: BookingKind | null;
  members: Member[];
  me: Member | null;
  partner: Member | null;
  onClose: () => void;
  /** Opens a linked expense in Budget (expenses are entered and linked there). */
  onOpenExpense: (id: string) => void;
}) {
  const ops = useEntityOps('bookings');
  const budget = useBudget();
  const toast = useToast();
  const kind: BookingKind = booking?.detail.kind ?? newKind ?? 'flight';
  const isNew = !booking;
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [modeFor, setModeFor] = useState<string | null>(null);
  const key = open ? (booking?.id ?? `new-${kind}`) : null;
  if (key !== modeFor) {
    setModeFor(key);
    setMode(isNew ? 'edit' : 'view');
  }
  const [draft, patch] = useDraft<Draft>(open, key, () => toDraft(booking, members));
  const save = useSaveFlow<Booking>();
  const [tried, setTried] = useState(false);

  const errors = validate(kind, draft);
  const err = (k: keyof Draft) => (tried ? errors[k] : undefined);
  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  const submit = async () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    const detail = buildDetail(kind, draft, booking, members);
    const fields = {
      kind,
      title: draft.title.trim() || autoTitle(kind, draft),
      status: draft.status,
      paymentStatus: draft.paymentStatus,
      reference: draft.reference.trim() || null,
      notes: draft.notes.trim(),
      detail,
    };
    const result = await save.run(() => (isNew ? ops.create({ id: draft.id, ...fields }) : ops.update(draft.id, fields, draft.version)));
    if (!result.ok) return;
    if (isNew) onClose();
    else setMode('view');
  };

  const remove = async () => {
    if (!booking) return;
    const result = await save.run(() => ops.remove(booking.id, draft.version));
    if (result.ok) onClose();
  };

  const expenses = budget.status === 'ready' ? budget.data.expenses : [];
  const linked = booking ? expenses.filter((e) => e.bookingId === booking.id && !e.deletedAt) : [];

  const copyRef = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(S.checklist.copied);
    } catch {
      toast.show(S.sync.failed, { tone: 'error' });
    }
  };

  const title = isNew ? S.checklist.newTitle[kind] : (booking?.title ?? '');
  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? '';
  const zoneOptions = ZONES.map((z) => ({ value: z, label: S.checklist.zones[z] ?? z }));

  const footer =
    mode === 'view' ? (
      <div className={form.footer}>
        <div className={form.footerEnd}>
          <Button variant="ghost" onClick={onClose}>
            {S.actions.close}
          </Button>
          <Button variant="primary" iconStart="edit" onClick={() => setMode('edit')}>
            {S.actions.edit}
          </Button>
        </div>
      </div>
    ) : (
      <div className={form.footer}>
        {!isNew && <ConfirmDelete onConfirm={remove} busy={save.busy} />}
        <div className={form.footerEnd}>
          <Button variant="ghost" onClick={isNew ? onClose : () => setMode('view')}>
            {S.actions.cancel}
          </Button>
          <Button variant="primary" busy={save.busy} onClick={submit}>
            {S.actions.save}
          </Button>
        </div>
      </div>
    );

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title} headerExtra={<SaveStatus state={save.state} />} footer={footer}>
        {mode === 'view' && booking ? (
          <div className={form.form}>
            <StatusBadges booking={booking} />
            <BookingFacts booking={booking} memberName={memberName} onCopy={copyRef} />
            <section className={styles.sheetBlock} aria-label={S.checklist.linkedExpenses}>
              <h3 className={form.subhead}>{S.checklist.linkedExpenses}</h3>
              {linked.length ? (
                <ul className={styles.expenseList}>
                  {linked.map((e) => (
                    <li key={e.id}>
                      <button type="button" className={styles.expenseRow} onClick={() => onOpenExpense(e.id)}>
                        <span className={styles.expenseText}>
                          <b>{e.title}</b>
                          <span>
                            {formatDayLabel(e.date)} · {S.labels.expenseStatus[e.status]}
                          </span>
                        </span>
                        <span className={styles.expenseAmount}>{formatMoney(e.amountMinor, e.currency)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={form.hint}>{S.checklist.noLinkedExpense}</p>
              )}
              <p className={form.hint}>{S.checklist.expensesInBudget}</p>
            </section>
            <BookingFiles booking={booking} />
          </div>
        ) : (
          <form
            className={form.form}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {save.conflict && (
              <ConflictBlock
                key={save.conflict.latest?.version ?? 0}
                latest={save.conflict.latest}
                me={me}
                partner={partner}
                onRebase={(latest) => patch({ version: latest.version })}
                renderLatest={(latest) => <p className={form.latestBody}>{latest.title}</p>}
                onUseLatest={(latest) => patch(toDraft(latest, members))}
              />
            )}
            {kind === 'flight' && (
              <>
                <div className={form.grid2}>
                  <Field label={S.checklist.fields.carrier} error={err('carrier')}>
                    <TextInput value={draft.carrier} onChange={(e) => edit({ carrier: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.flightNumber} error={err('flightNumber')}>
                    <TextInput value={draft.flightNumber} autoCapitalize="characters" onChange={(e) => edit({ flightNumber: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.from} error={err('from')}>
                    <TextInput
                      value={draft.from}
                      maxLength={3}
                      autoCapitalize="characters"
                      onChange={(e) => edit({ from: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                    />
                  </Field>
                  <Field label={S.checklist.fields.to} error={err('to')}>
                    <TextInput
                      value={draft.to}
                      maxLength={3}
                      autoCapitalize="characters"
                      onChange={(e) => edit({ to: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                    />
                  </Field>
                </div>
                <div className={form.grid2}>
                  <Field label={S.checklist.fields.departDate} error={err('departDate')}>
                    <TextInput type="date" value={draft.departDate} onChange={(e) => edit({ departDate: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.departTime}>
                    <TextInput type="time" value={draft.departTime} onChange={(e) => edit({ departTime: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.departZone}>
                    <SegmentedControl
              label={S.checklist.fields.departZone}
              fill
              columns={2} value={draft.departTimezone} onChange={(v) => edit({ departTimezone: v })} options={zoneOptions} />
                  </Field>
                  <Field label={S.checklist.fields.departTerminal} optional>
                    <TextInput value={draft.departTerminal} onChange={(e) => edit({ departTerminal: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.arriveDate} error={err('arriveDate')}>
                    <TextInput type="date" value={draft.arriveDate} onChange={(e) => edit({ arriveDate: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.arriveTime}>
                    <TextInput type="time" value={draft.arriveTime} onChange={(e) => edit({ arriveTime: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.arriveZone}>
                    <SegmentedControl
              label={S.checklist.fields.arriveZone}
              fill
              columns={2} value={draft.arriveTimezone} onChange={(v) => edit({ arriveTimezone: v })} options={zoneOptions} />
                  </Field>
                  <Field label={S.checklist.fields.arriveTerminal} optional>
                    <TextInput value={draft.arriveTerminal} onChange={(e) => edit({ arriveTerminal: e.target.value })} />
                  </Field>
                </div>
                <fieldset className={form.fieldset}>
                  <legend className={form.legend}>{S.checklist.passengers}</legend>
                  {members.map((m) => (
                    <Field key={m.id} label={`${m.displayName} · ${S.checklist.reference}`} optional>
                      <TextInput
                        value={draft.passengerRefs[m.id] ?? ''}
                        autoComplete="off"
                        onChange={(e) => edit({ passengerRefs: { ...draft.passengerRefs, [m.id]: e.target.value } })}
                      />
                    </Field>
                  ))}
                </fieldset>
              </>
            )}
            {kind === 'stay' && (
              <>
                <Field label={S.checklist.fields.stayName} error={err('name')}>
                  <TextInput value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
                </Field>
                <Field label={S.checklist.fields.address} optional>
                  <TextInput value={draft.address} onChange={(e) => edit({ address: e.target.value })} />
                </Field>
                <div className={form.grid2}>
                  <Field label={S.checklist.fields.checkIn}>
                    <TextInput type="date" value={draft.checkInDate} onChange={(e) => edit({ checkInDate: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.checkOut} error={err('checkOutDate')}>
                    <TextInput type="date" value={draft.checkOutDate} onChange={(e) => edit({ checkOutDate: e.target.value })} />
                  </Field>
                </div>
                <Field label={S.checklist.guests}>
                  <SegmentedControl
              label={S.checklist.guests}
              fill
              columns={3}
                    value={draft.guests}
                    onChange={(v) => edit({ guests: v as StayDetail['guests'] })}
                    options={[
                      { value: 'both', label: S.people.participants.together },
                      { value: 'eren', label: S.people.participants.eren },
                      { value: 'amy', label: S.people.participants.amy },
                    ]}
                  />
                </Field>
              </>
            )}
            {kind === 'car' && (
              <>
                <Field label={S.checklist.fields.company} error={err('company')}>
                  <TextInput value={draft.company} onChange={(e) => edit({ company: e.target.value })} />
                </Field>
                <div className={form.grid2}>
                  <Field label={S.checklist.fields.pickUpDate} error={err('pickUpDate')}>
                    <TextInput type="date" value={draft.pickUpDate} onChange={(e) => edit({ pickUpDate: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.pickUpTime}>
                    <TextInput type="time" value={draft.pickUpTime} onChange={(e) => edit({ pickUpTime: e.target.value })} />
                  </Field>
                </div>
                <Field label={S.checklist.fields.pickUpPlace} optional>
                  <TextInput value={draft.pickUpPlace} onChange={(e) => edit({ pickUpPlace: e.target.value })} />
                </Field>
                <div className={form.grid2}>
                  <Field label={S.checklist.fields.dropOffDate} error={err('dropOffDate')}>
                    <TextInput type="date" value={draft.dropOffDate} onChange={(e) => edit({ dropOffDate: e.target.value })} />
                  </Field>
                  <Field label={S.checklist.fields.dropOffTime}>
                    <TextInput type="time" value={draft.dropOffTime} onChange={(e) => edit({ dropOffTime: e.target.value })} />
                  </Field>
                </div>
                <Field label={S.checklist.fields.dropOffPlace} optional>
                  <TextInput value={draft.dropOffPlace} onChange={(e) => edit({ dropOffPlace: e.target.value })} />
                </Field>
              </>
            )}
            <Field label={S.fields.title} optional hint={autoTitle(kind, draft) || undefined}>
              <TextInput value={draft.title} onChange={(e) => edit({ title: e.target.value })} placeholder={autoTitle(kind, draft)} />
            </Field>
            {/* Full width each: three choices side by side need the room ('Considering'). */}
            <>
              <Field label={S.checklist.bookingStatus}>
                <SegmentedControl
              label={S.checklist.bookingStatus}
              fill
              columns={3}
                  value={draft.status}
                  onChange={(v) => edit({ status: v as BookingStatus })}
                  options={(['considering', 'booked', 'cancelled'] as const).map((v) => ({ value: v, label: S.labels.bookingStatus[v] }))}
                />
              </Field>
              <Field label={S.checklist.paymentStatus}>
                <SegmentedControl
              label={S.checklist.paymentStatus}
              fill
              columns={2}
                  value={draft.paymentStatus}
                  onChange={(v) => edit({ paymentStatus: v as PaymentStatus })}
                  options={(['unpaid', 'paid'] as const).map((v) => ({ value: v, label: S.labels.paymentStatus[v] }))}
                />
              </Field>
            </>
            {kind !== 'flight' && (
              <Field label={S.checklist.reference} optional>
                <TextInput value={draft.reference} autoComplete="off" onChange={(e) => edit({ reference: e.target.value })} />
              </Field>
            )}
            <Field label={S.fields.notes} optional hint={S.checklist.sensitiveNote}>
              <TextArea rows={3} value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />
            </Field>
            <button type="submit" hidden />
          </form>
        )}
      </Sheet>

    </>
  );
}

/** Read-only facts, including references (detail sheet only). */
function BookingFacts({ booking, memberName, onCopy }: { booking: Booking; memberName: (id: string) => string; onCopy: (v: string) => void }) {
  const d = booking.detail;
  const rows: Array<[string, ReactNode]> = [];
  if (d.kind === 'flight') {
    rows.push([S.maps.route, `${d.from} → ${d.to} · ${flightDuration(d)}`]);
    rows.push([S.checklist.departs, `${wallLine(d.departDate, d.departTime, d.departTimezone)} · ${terminalText(d.from, d.departTerminal)}`]);
    rows.push([S.checklist.arrives, `${wallLine(d.arriveDate, d.arriveTime, d.arriveTimezone)} · ${terminalText(d.to, d.arriveTerminal)}`]);
    if (d.checkInBy) rows.push([S.checklist.airportBy, wallLine(d.checkInBy.date, d.checkInBy.time, d.checkInBy.timezone)]);
    rows.push([S.checklist.passengers, d.passengers.map((p) => memberName(p.memberId)).filter(Boolean).join(', ')]);
    for (const p of d.passengers) {
      if (!p.reference) continue;
      rows.push([
        `${memberName(p.memberId)} · ${S.checklist.reference}`,
        <span key={p.memberId} className={styles.refLine}>
          <code>{p.reference}</code>
          <Button variant="link" size="sm" onClick={() => onCopy(p.reference!)}>
            {S.checklist.copyReference}
          </Button>
        </span>,
      ]);
    }
  }
  if (d.kind === 'stay') {
    rows.push([S.checklist.fields.checkIn, formatDayLabel(d.checkInDate)]);
    rows.push([S.checklist.fields.checkOut, `${formatDayLabel(d.checkOutDate)} · ${S.checklist.nights(stayNights(d))}`]);
    rows.push([S.checklist.guests, d.guests === 'both' ? S.people.participants.together : S.people.participants[d.guests]]);
    if (d.address) rows.push([S.checklist.fields.address, d.address]);
    const map = mapHref({ mapUrl: null, place: d.address || d.name, mapLat: d.lat ?? null, mapLng: d.lng ?? null });
    if (map)
      rows.push([
        S.maps.link,
        <a key="map" href={map.href} target="_blank" rel="noopener noreferrer">
          {map.kind === 'link' ? S.maps.open : S.maps.search}
          <span className="sr-only"> ({S.ui.externalLink})</span>
        </a>,
      ]);
  }
  if (d.kind === 'car') {
    rows.push([S.checklist.pickUp, `${formatWallTime(d.pickUp.time)} · ${formatDayLabel(d.pickUp.date)}${d.pickUp.place ? ` · ${d.pickUp.place}` : ''}`]);
    rows.push([S.checklist.dropOff, `${formatWallTime(d.dropOff.time)} · ${formatDayLabel(d.dropOff.date)}${d.dropOff.place ? ` · ${d.dropOff.place}` : ''}`]);
    rows.push([S.checklist.rental, S.checklist.rentalDays(rentalDays(d))]);
  }
  if (booking.reference)
    rows.push([
      S.checklist.reference,
      <span key="ref" className={styles.refLine}>
        <code>{booking.reference}</code>
        <Button variant="link" size="sm" onClick={() => onCopy(booking.reference!)}>
          {S.checklist.copyReference}
        </Button>
      </span>,
    ]);
  if (booking.notes) rows.push([S.fields.notes, <span key="notes" className={styles.notes}>{booking.notes}</span>]);
  return (
    <dl className={form.readonly}>
      {rows.map(([k, v], i) => (
        <div key={i} className={styles.factRow}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
