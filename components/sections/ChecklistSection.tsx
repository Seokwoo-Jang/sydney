'use client';
// Checklist · Before We Go (plan §4.3, §7.1, §7.4). Root id stays "section-ready".
import { useCallback, useState } from 'react';
import { NextUp } from '@/components/checklist/BookingCards';
import { BookingSheet } from '@/components/checklist/BookingSheet';
import { BookingsView, type NewBookingKind } from '@/components/checklist/BookingsView';
import { ChecklistItemSheet } from '@/components/checklist/ChecklistItemSheet';
import { ChecklistList } from '@/components/checklist/ChecklistList';
import { ChecklistProgress, ComingUp } from '@/components/checklist/ChecklistSummary';
import { DocumentSheet } from '@/components/checklist/DocumentSheet';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSectionNav } from '@/components/checklist/useSectionNav';
import { Card, ErrorState, LoadingState, SectionHeading, SegmentedControl, useToast } from '@/components/ui';
import { useBookings, useChecklist, useDocuments, useLibrary, useServerNow, useTrip } from '@/lib/data';
import type { ChecklistItem, ChecklistKind } from '@/lib/types';
import { S } from '@/lib/strings';
import type { SectionProps } from './types';
import styles from '@/components/checklist/Checklist.module.css';

const VIEWS = ['packing', 'task', 'bookings'] as const;
type View = (typeof VIEWS)[number];

type Adding = { kind: ChecklistKind; category: string | null } | { kind: NewBookingKind };

export default function ChecklistSection({ layout }: SectionProps) {
  const checklist = useChecklist();
  const bookings = useBookings();
  const documents = useDocuments();
  const library = useLibrary();
  const trip = useTrip();
  const due = useDueContext();
  const now = useServerNow(60_000);
  const toast = useToast();
  const nav = useSectionNav<View>('ready', VIEWS, 'packing');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<Adding | null>(null);

  const me = trip.status === 'ready' ? trip.data.me : null;
  const partner = trip.status === 'ready' ? trip.data.partner : null;
  const members = trip.status === 'ready' ? trip.data.members : [];
  const items = checklist.status === 'ready' ? checklist.data : [];
  const bookingRows = bookings.status === 'ready' ? bookings.data : [];
  const docRows = documents.status === 'ready' ? documents.data : [];
  const resources = library.status === 'ready' ? library.data.resources : [];

  const toggle = useCallback(
    async (item: ChecklistItem) => {
      setPending((s) => new Set(s).add(item.id));
      const r = await checklist.update(item.id, { checked: !item.checked }, item.version);
      setPending((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
      if (!r.ok) toast.show(r.reason === 'conflict' ? S.sync.conflict : S.sync.failed, { tone: 'error' });
    },
    [checklist, toast],
  );

  const openItem = (item: ChecklistItem) => nav.openItem(item.id, { view: item.kind });
  const openBooking = (id: string) => nav.openItem(id, { view: 'bookings' });

  const openChecklistItem = nav.item ? (items.find((i) => i.id === nav.item) ?? null) : null;
  const openBookingRow = nav.item ? (bookingRows.find((b) => b.id === nav.item) ?? null) : null;
  const openDoc = nav.item ? (docRows.find((d) => d.id === nav.item) ?? null) : null;

  const status = [checklist, bookings, documents].find((r) => r.status === 'error') ?? (checklist.status === 'loading' ? checklist : null);
  const board = layout === 'board';

  const body =
    status?.status === 'error' ? (
      <ErrorState onRetry={status.retry} />
    ) : status?.status === 'loading' ? (
      <LoadingState rows={4} />
    ) : (
      <>
        <div className={board ? styles.summaryBoard : styles.summaryTabs}>
          <ChecklistProgress items={items} />
          <ComingUp items={items} me={me} due={due} pending={pending} onToggle={toggle} onEdit={openItem} />
          {board && <NextUp bookings={bookingRows} now={now} today={due?.today ?? null} onOpen={openBooking} />}
        </div>
        <SegmentedControl<View>
          label={S.checklist.viewsLabel}
          fill
          size={board ? 'sm' : 'md'}
          className={styles.views}
          value={nav.view}
          onChange={nav.setView}
          options={VIEWS.map((v) => ({ value: v, label: S.labels.checklistViews[v] }))}
        />
        <div className={styles.viewBody}>
          {nav.view === 'bookings' ? (
            <BookingsView
              bookings={bookingRows}
              documents={docRows}
              members={members}
              now={now}
              onOpen={openBooking}
              onAdd={(kind) => setAdding({ kind })}
            />
          ) : (
            <ChecklistList
              key={nav.view}
              kind={nav.view}
              items={items}
              me={me}
              due={due}
              pending={pending}
              defaultOpen={!board}
              onToggle={toggle}
              onEdit={openItem}
              onAdd={(category) => setAdding({ kind: nav.view as ChecklistKind, category })}
            />
          )}
        </div>
      </>
    );

  const addingChecklist = adding && (adding.kind === 'packing' || adding.kind === 'task') ? adding : null;
  const addingBooking = adding && (adding.kind === 'flight' || adding.kind === 'stay' || adding.kind === 'car') ? adding.kind : null;
  const addingDoc = adding?.kind === 'document';

  return (
    <section id="section-ready" aria-labelledby="section-ready-title" className={styles.root} data-layout={layout}>
      {board ? (
        <Card className={styles.boardCard}>
          <SectionHeading
            id="section-ready-title"
            eyebrow={S.sections.ready.menu}
            title={S.sections.ready.title}
            intro={S.sections.ready.intro}
            layout={layout}
          />
          {body}
        </Card>
      ) : (
        <>
          <SectionHeading
            id="section-ready-title"
            eyebrow={S.sections.ready.menu}
            title={S.sections.ready.title}
            intro={S.sections.ready.intro}
            layout={layout}
          />
          {body}
        </>
      )}

      <ChecklistItemSheet
        open={!!openChecklistItem || !!addingChecklist}
        kind={openChecklistItem?.kind ?? addingChecklist?.kind ?? 'packing'}
        item={openChecklistItem}
        category={addingChecklist?.category ?? null}
        me={me}
        partner={partner}
        bookings={bookingRows}
        resources={resources}
        onClose={() => (addingChecklist ? setAdding(null) : nav.closeItem())}
        onOpenBooking={openBooking}
      />
      <BookingSheet
        open={!!openBookingRow || !!addingBooking}
        booking={openBookingRow}
        newKind={addingBooking}
        members={members}
        me={me}
        partner={partner}
        onClose={() => (addingBooking ? setAdding(null) : nav.closeItem())}
      />
      <DocumentSheet
        open={!!openDoc || addingDoc}
        doc={openDoc}
        members={members}
        me={me}
        partner={partner}
        onClose={() => (addingDoc ? setAdding(null) : nav.closeItem())}
      />
    </section>
  );
}
