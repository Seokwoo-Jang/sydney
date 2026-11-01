'use client';
// Itinerary body once data is ready (plan §7.2). Board: 3×3 Day cards + the
// selected day's timeline. Tabs: sticky Day 1–9 strip + one day's timeline.
// The selected day lives in the URL; time passing never changes it.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShellNav } from '@/components/shell/ShellNav';
import { Button, Chip, ChipGroup, EmptyState, Icon, LoadingState, SegmentedControl } from '@/components/ui';
import { useServerNow } from '@/lib/data';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { S } from '@/lib/strings';
import { computeNow } from '@/lib/time/now';
import { formatDayLabel, zonedDate } from '@/lib/time/zone';
import type { Booking, Expense, ItineraryItem, Member, PreludeActivity, Resource, ResourceLink, Trip, TripDay } from '@/lib/types';
import { useUrlState } from '@/lib/url';
import { DayChips, chipId } from './DayChips';
import { DayGrid, type DayCardInfo } from './DayGrid';
import { ItemSheet, type SheetTarget } from './ItemSheet';
import { ItineraryRow, type RowLinks, type RowState } from './ItineraryRow';
import {
  buildDayRows,
  defaultDay,
  isPassed,
  laneItems,
  mixLabel,
  overviewWindow,
  type DayRow,
  type PeopleFilter,
} from './logic';
import { useExpanded } from './useExpanded';
import { DayTitle } from './DayTitle';
import { meetUpIds } from '@/components/route/routeLogic';
import styles from './itinerary.module.css';

export type ItineraryMode = 'day' | 'full';

export interface ItineraryData {
  trip: Trip;
  me: Member | null;
  partner: Member | null;
  days: TripDay[];
  items: ItineraryItem[];
  activities: PreludeActivity[];
  bookings: Booking[];
  resources: Resource[];
  resourceLinks: ResourceLink[];
  expenses: Expense[];
}

// Route map (plan §7.2.7): its own chunk with Leaflet, fetched the first time Route is chosen.
const RouteView = dynamic(() => import('@/components/route/RouteView'), {
  ssr: false,
  loading: () => <LoadingState variant="block" />,
});

const OVERVIEW_LIMIT = 4;
const DAY_KEY = 'sydney.itinerary.day';
const NO_NOW = { nowIds: [] as string[], upNextIds: [] as string[] };
const PANEL_ID = 'itin-day-panel';

const rowKeyFor = (date: string, row: Pick<DayRow, 'continuation'> & { item: { id: string } }) =>
  `${date}-${row.item.id}${row.continuation ? '-c' : ''}`.replace(/[^A-Za-z0-9_-]/g, '-');

function readSessionDay(): string | null {
  try {
    return window.sessionStorage.getItem(DAY_KEY);
  } catch {
    return null;
  }
}

export function ItineraryBody({
  layout,
  data,
  mode,
  setMode,
}: {
  layout: 'board' | 'tabs';
  data: ItineraryData;
  mode: ItineraryMode;
  setMode: (m: ItineraryMode) => void;
}) {
  const { trip, days, items, activities } = data;
  const tz = trip.timezone;
  const now = useServerNow(30_000);
  const today = now ? zonedDate(now, tz) : null;
  const tripToday = today && days.some((d) => d.date === today) ? today : null;
  const reduced = useReducedMotion();
  const { state: url, nav, push, replace } = useUrlState();
  const { goToSection } = useShellNav();
  const expanded = useExpanded();

  // Default day is decided once (URL → this session → Sydney today); never moved by the clock.
  const [initialDay] = useState(() => {
    const session = readSessionDay();
    if (session && days.some((d) => d.date === session)) return session;
    return defaultDay(days, today) ?? '';
  });
  const urlDay = url.day && days.some((d) => d.date === url.day) ? url.day : null;
  const selectedDay = urlDay ?? (days.some((d) => d.date === initialDay) ? initialDay : (days[0]?.date ?? ''));
  useEffect(() => {
    try {
      window.sessionStorage.setItem(DAY_KEY, selectedDay);
    } catch {
      // Storage blocked: the URL still carries the day.
    }
  }, [selectedDay]);

  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [view, setView] = useState<'list' | 'route'>('list');
  const [showAllDay, setShowAllDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ date: string; key?: string } | null>(null);
  const [scrollSeq, setScrollSeq] = useState(0);

  // ── derived ───────────────────────────────────────────────────
  const live = useMemo(() => items.filter((i) => !i.deletedAt), [items]);
  const visible = useMemo(() => laneItems(live, filter), [live, filter]);
  /** Whether `item` shows under `f` (a just-saved row may be newer than `live`). */
  const shownUnder = (item: ItineraryItem, f: PeopleFilter) =>
    laneItems([...live.filter((i) => i.id !== item.id), item], f).some((i) => i.id === item.id);
  const nowInfo = useMemo(() => (now && today ? computeNow(visible, now, today, tz) : NO_NOW), [visible, now, today, tz]);
  const rowsByDay = useMemo(() => new Map(days.map((d) => [d.date, buildDayRows(visible, d.date, tz)])), [days, visible, tz]);

  const bookingById = useMemo(() => new Map(data.bookings.filter((b) => !b.deletedAt).map((b) => [b.id, b])), [data.bookings]);
  const activityByItem = useMemo(() => {
    const m = new Map<string, PreludeActivity>();
    for (const a of activities) if (!a.deletedAt && a.itineraryItemId) m.set(a.itineraryItemId, a);
    return m;
  }, [activities]);
  const liveResources = useMemo(() => data.resources.filter((r) => !r.deletedAt), [data.resources]);
  const resourcesByItem = useMemo(() => {
    const byId = new Map(liveResources.map((r) => [r.id, r]));
    const m = new Map<string, Resource[]>();
    const add = (itemId: string, resourceId: string | null) => {
      const r = resourceId ? byId.get(resourceId) : undefined;
      if (!r) return;
      const list = m.get(itemId) ?? [];
      if (!list.includes(r)) list.push(r);
      m.set(itemId, list);
    };
    for (const l of data.resourceLinks) if (l.itineraryItemId) add(l.itineraryItemId, l.resourceId);
    // Links a Prelude plan still holds itself show on its item until the item is saved again.
    for (const l of data.resourceLinks) {
      if (!l.preludeActivityId) continue;
      for (const [itemId, a] of activityByItem) if (a.id === l.preludeActivityId) add(itemId, l.resourceId);
    }
    return m;
  }, [liveResources, data.resourceLinks, activityByItem]);
  const expensesByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.expenses) if (!e.deletedAt) for (const id of e.itineraryItemIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [data.expenses]);

  const dayInfo = useMemo(() => {
    const m = new Map<string, DayCardInfo>();
    for (const d of days) {
      const rows = buildDayRows(live, d.date, tz);
      const all = [...rows.timed, ...rows.untimed];
      const own = all.filter((r) => !r.continuation);
      const flightOf = (r: DayRow) => {
        const b = r.item.bookingId ? bookingById.get(r.item.bookingId) : undefined;
        return b?.detail.kind === 'flight' ? b.detail : null;
      };
      const departing = own.map(flightOf).find(Boolean) ?? null;
      m.set(d.date, {
        count: own.length,
        flight: all.some((r) => flightOf(r) !== null),
        route: departing ? S.itinerary.route(departing.from, departing.to) : null,
        prelude: own.some((r) => activityByItem.has(r.item.id)),
      });
    }
    return m;
  }, [days, live, tz, bookingById, activityByItem]);

  const hasExample = visible.some((i) => i.isExample);
  const meetUps = useMemo(() => meetUpIds(live, data.bookings, tz), [live, data.bookings, tz]);

  // ── navigation ────────────────────────────────────────────────
  const selectDay = (date: string, via: 'click' | 'key') => {
    setMode('day');
    if (date !== selectedDay) (via === 'click' ? push : replace)({ day: date });
  };

  const queueScroll = (date: string, key?: string) => {
    pendingScroll.current = { date, key };
    setScrollSeq((s) => s + 1);
  };

  const jumpToNow = () => {
    if (!tripToday) return;
    setMode('day');
    if (tripToday !== selectedDay) push({ day: tripToday });
    queueScroll(tripToday);
  };

  useEffect(() => {
    const p = pendingScroll.current;
    if (!p || p.date !== selectedDay || mode !== 'day') return;
    pendingScroll.current = null;
    // Two frames: lets the shell's own section scroll start first, then refines it.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        const target =
          (p.key ? root.querySelector(`[data-row-key="${p.key}"]`) : null) ??
          root.querySelector('[data-focus="true"]') ??
          root.querySelector('[data-day-panel]');
        target?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        // A row a link landed on (ringed) also takes focus, for keyboard and screen readers.
        if (target instanceof HTMLElement && target.dataset.highlight != null) target.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollSeq, selectedDay, mode, reduced]);

  // Deep link / "View itinerary" / a Library tag: ?section=days&day=…&item=<id> expands,
  // shows and rings that row.
  const handledSeq = useRef(-1);
  useEffect(() => {
    if (handledSeq.current === nav.seq) return;
    handledSeq.current = nav.seq;
    if (nav.kind === 'replace' || url.section !== 'days' || !url.item) return;
    const item = live.find((i) => i.id === url.item);
    if (!item) return;
    setMode('day');
    setView('list');
    setFilter((f) => (shownUnder(item, f) ? f : 'all'));
    setShowAllDay(item.date);
    expanded.open(item.id);
    setHighlight(item.id);
    replace({ day: item.date, item: null });
    queueScroll(item.date, rowKeyFor(item.date, { item, continuation: false }));
  }, [nav, url.section, url.item, live, expanded, replace, setMode]);

  // The ring marks where the link landed, then steps back.
  useEffect(() => {
    if (!highlight) return;
    const fade = window.setTimeout(() => setHighlight(null), 4000);
    return () => window.clearTimeout(fade);
  }, [highlight]);

  // ── rendering ─────────────────────────────────────────────────
  const rowState = (item: ItineraryItem, date: string): RowState => {
    if (date === today) {
      if (nowInfo.nowIds.includes(item.id)) return 'now';
      if (nowInfo.upNextIds.includes(item.id)) return 'upNext';
    }
    return now && today && isPassed(item, now, today) ? 'past' : null;
  };

  const linksFor = (item: ItineraryItem): RowLinks => ({
    booking: item.bookingId ? (bookingById.get(item.bookingId) ?? null) : null,
    activity: activityByItem.get(item.id) ?? null,
    resources: resourcesByItem.get(item.id) ?? [],
    expenses: expensesByItem.get(item.id) ?? 0,
  });

  const renderRows = (date: string, rows: DayRow[]) => (
    <ol role="list" className={styles.rows}>
      {rows.map((r) => {
        const key = rowKeyFor(date, r);
        return (
          <ItineraryRow
            key={key}
            row={r}
            rowKey={key}
            layout={layout}
            tripTz={tz}
            state={rowState(r.item, date)}
            open={expanded.isOpen(r.item.id)}
            highlighted={highlight === r.item.id}
            meetUp={meetUps.has(r.item.id)}
            links={linksFor(r.item)}
            onToggle={() => expanded.toggle(r.item.id)}
            onEdit={() => setSheet({ kind: 'edit', item: r.item })}
            onViewPlan={(a) => goToSection('prelude', { item: a.id })}
            onViewBooking={(b) => goToSection('ready', { view: 'bookings', mark: b.id })}
            onOpenExpenses={() => goToSection('wallet')}
          />
        );
      })}
    </ol>
  );

  const renderDay = (date: string, limit: boolean): ReactNode => {
    const rows = rowsByDay.get(date) ?? { timed: [], untimed: [] };
    const all = [...rows.timed, ...rows.untimed];
    const add = () => setSheet({ kind: 'add', date });
    if (!all.length) {
      // Plans that day, just none in this lane.
      const title = filter !== 'all' && live.some((i) => i.date === date) ? S.itinerary.noneInLane(S.people.participants[filter]) : S.empty.day;
      return <EmptyState title={title} actionLabel={S.empty.dayAction} onAction={add} compact className={styles.empty} />;
    }
    const focus = new Set(date === today ? [...nowInfo.nowIds, ...nowInfo.upNextIds] : []);
    const collapsible = limit && all.length > OVERVIEW_LIMIT;
    const shown = collapsible && showAllDay !== date ? overviewWindow(all, (r) => focus.has(r.item.id), OVERVIEW_LIMIT) : all;
    const timed = shown.filter((r) => rows.timed.includes(r));
    const untimed = shown.filter((r) => rows.untimed.includes(r));
    return (
      <>
        {timed.length > 0 && renderRows(date, timed)}
        {untimed.length > 0 && (
          <>
            <h4 className={styles.groupHeading}>{S.itinerary.anyTime}</h4>
            {renderRows(date, untimed)}
          </>
        )}
        <div className={styles.dayFoot}>
          {collapsible && (
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              aria-expanded={showAllDay === date}
              onClick={() => setShowAllDay(showAllDay === date ? null : date)}
            >
              {showAllDay === date ? S.itinerary.showFewer : S.itinerary.viewAll(all.length)}
            </Button>
          )}
          <button type="button" className={styles.addRow} onClick={add}>
            <Icon name="plus" size={16} />
            {S.empty.dayAction}
          </button>
        </div>
      </>
    );
  };

  const day = days.find((d) => d.date === selectedDay) ?? days[0];
  const filterChips = (
    <ChipGroup label={S.itinerary.filterLabel} className={styles.filter}>
      {(['all', 'together', 'eren', 'amy'] as const).map((p) => (
        <Chip key={p} selected={filter === p} onClick={() => setFilter(p)}>
          {p === 'all' ? S.itinerary.filterAll : S.people.participants[p]}
        </Chip>
      ))}
    </ChipGroup>
  );
  const jumpButton = tripToday ? (
    <Button variant="secondary" size="sm" iconStart="clock" onClick={jumpToNow} className={styles.jump}>
      {S.time.jumpToNow}
    </Button>
  ) : null;

  const fullDays = days.map((d) => (
    <section key={d.id} className={styles.fullDay} aria-labelledby={`itin-full-${d.date}`}>
      <h4 id={`itin-full-${d.date}`} className={styles.fullDayHeading}>
        <span>{S.itinerary.dayHeading(d.dayNumber, formatDayLabel(d.date))}</span>
        {d.date === today && <span className={styles.todayText}>{S.time.today}</span>}
        <small>{d.title}</small>
      </h4>
      {renderDay(d.date, false)}
    </section>
  ));

  const footnote = hasExample ? <p className={styles.footnote}>{S.data.exampleNote}</p> : null;

  // List / Route (plan §7.2.7). The day selector picks the day; the whole trip is a button on the map.
  const viewToggle = (
    <SegmentedControl
      label={S.route.viewLabel}
      size="sm"
      value={view}
      onChange={setView}
      options={[
        { value: 'list', label: S.maps.list },
        { value: 'route', label: S.maps.route },
      ]}
    />
  );
  const routeView =
    view === 'route' ? (
      <RouteView
        layout={layout}
        days={days}
        items={live}
        bookings={data.bookings}
        filter={filter}
        tripTz={tz}
        selectedDay={selectedDay}
        nowIds={selectedDay === today ? nowInfo.nowIds : []}
        me={data.me}
        partner={data.partner}
        onSelectDay={(d) => selectDay(d, 'click')}
        onOpenItem={(item) => {
          setView('list');
          setMode('day');
          setShowAllDay(item.date);
          expanded.open(item.id);
          if (item.date !== selectedDay) push({ day: item.date });
          queueScroll(item.date, rowKeyFor(item.date, { item, continuation: false }));
        }}
      />
    ) : null;

  const sheetEl = (
    <ItemSheet
      target={sheet}
      days={days}
      items={live}
      activities={activities}
      resources={liveResources}
      resourceLinks={data.resourceLinks}
      tripTz={tz}
      homeTz={trip.homeTimezone}
      me={data.me}
      partner={data.partner}
      onClose={() => setSheet(null)}
      onSaved={(row) => {
        setSheet(null);
        if (!shownUnder(row, filter)) setFilter('all');
        if (mode !== 'day') return;
        if (row.date !== selectedDay) push({ day: row.date });
        queueScroll(row.date, rowKeyFor(row.date, { item: row, continuation: false }));
      }}
    />
  );

  if (layout === 'board') {
    return (
      <div ref={rootRef} className={styles.board}>
        <DayGrid days={days} info={dayInfo} selected={mode === 'day' ? selectedDay : null} today={today} onSelect={(d) => selectDay(d, 'click')} />
        <div className={styles.timeline}>
          <div className={styles.tlHead}>
            <div>
              <h3 className={styles.tlTitle}>
                {mode === 'full' ? S.itinerary.allDays : S.itinerary.dayHeading(day.dayNumber, formatDayLabel(day.date))}
              </h3>
              {mode === 'day' && <DayTitle day={day} className={styles.tlTheme} />}
            </div>
            <div className={styles.tlControls}>
              {jumpButton}
              {viewToggle}
              {filterChips}
            </div>
          </div>
          {routeView ?? (mode === 'day' ? (
            <div data-day-panel className={styles.panel}>
              {renderDay(selectedDay, true)}
            </div>
          ) : (
            fullDays
          ))}
          {footnote}
        </div>
        {sheetEl}
      </div>
    );
  }

  const mix = mode === 'day' ? mixLabel(live.filter((i) => i.date === selectedDay)) : null;
  return (
    <div ref={rootRef} className={styles.tabs}>
      <DayChips
        days={days}
        selected={mode === 'day' ? selectedDay : null}
        today={tripToday}
        panelId={PANEL_ID}
        reduced={reduced}
        onSelect={selectDay}
      />
      <div className={styles.dayHead}>
        <div className={styles.dayHeadText}>
          {mode === 'full' ? <h3 className={styles.mTitle}>{S.itinerary.allDays}</h3> : <DayTitle day={day} as="h3" className={styles.mTitle} />}
          <p className={styles.mSub}>{mode === 'full' ? S.itinerary.allDaysSub : [formatDayLabel(day.date), mix].filter(Boolean).join(' · ')}</p>
        </div>
        {jumpButton}
      </div>
      <div className={styles.controls}>
        {viewToggle}
        {filterChips}
      </div>
      {routeView ?? (mode === 'day' ? (
        <div id={PANEL_ID} role="tabpanel" aria-labelledby={chipId(selectedDay)} data-day-panel className={styles.listCard}>
          {renderDay(selectedDay, false)}
        </div>
      ) : (
        <div className={styles.listCard}>{fullDays}</div>
      ))}
      {footnote}
      {sheetEl}
    </div>
  );
}
