'use client';
// Route view of the itinerary (plan §7.2.7). Loaded lazily by ItineraryBody
// (next/dynamic, no SSR) the first time "Route" is chosen, with Leaflet inside.
// The List view stays the primary accessible representation; here the stops
// list under the map repeats the pin order as buttons.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { conflictSource, useSaveFlow } from '@/components/checklist/useSaveFlow';
import type { PeopleFilter } from '@/components/itinerary/logic';
import { Badge, Button, Chip, ChipGroup, ConflictNotice, Field, MemberMarks, SaveStatus, TextInput } from '@/components/ui';
import { useEntityOps } from '@/lib/data';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { S } from '@/lib/strings';
import type { ItineraryItem, MapSource, Member, TripDay } from '@/lib/types';
import { searchPlaces } from './nominatim';
import RouteMapCanvas from './RouteMapCanvas';
import { buildTripRoutes, narrowRoute, placeLabel, stopTime, type LatLng, type PlaceCandidate } from './routeLogic';
import styles from './route.module.css';

export interface RouteViewProps {
  layout: 'board' | 'tabs';
  days: TripDay[];
  /** Live items, all people; the filter is applied here. */
  items: ItineraryItem[];
  filter: PeopleFilter;
  tripTz: string;
  scope: 'trip' | 'day';
  selectedDay: string;
  /** Now ids for the selected day (empty unless it is Sydney today). */
  nowIds: string[];
  me: Member | null;
  partner: Member | null;
  onTrip: () => void;
  onSelectDay: (date: string) => void;
  onOpenItem: (item: ItineraryItem) => void;
}

interface Edit {
  id: string;
  mode: 'pin' | 'find';
  /** Version the edit started from; a newer row means a conflict. */
  baseVersion: number;
}

type SearchState = 'idle' | 'searching' | 'done' | 'error';

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export default function RouteView({
  layout,
  days,
  items,
  filter,
  tripTz,
  scope,
  selectedDay,
  nowIds,
  me,
  partner,
  onTrip,
  onSelectDay,
  onOpenItem,
}: RouteViewProps) {
  const reduced = useReducedMotion();
  const ops = useEntityOps('itinerary');
  const flow = useSaveFlow<ItineraryItem>();
  const headingId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const searchAbort = useRef<AbortController | null>(null);

  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);

  useEffect(() => () => searchAbort.current?.abort(), []);

  // The map always draws everyone (the other person is faded); lists show the filtered view with the same numbers.
  const mapRoutes = useMemo(() => buildTripRoutes(items, days, 'together', tripTz), [items, days, tripTz]);
  const routes = useMemo(() => mapRoutes.map((r) => narrowRoute(r, filter)), [mapRoutes, filter]);
  // The clock re-renders the parent every 30 s; redraw the map only when the Now set itself changes.
  const nowKey = nowIds.join('|');
  const stableNowIds = useMemo(() => (nowKey ? nowKey.split('|') : []), [nowKey]);
  const dayNumbers = useMemo(() => new Map(days.map((d) => [d.date, d.dayNumber])), [days]);
  const mapScope = scope === 'trip' ? 'trip' : selectedDay;
  const active = scope === 'trip' ? routes : routes.filter((r) => r.date === selectedDay);
  const dayRoute = scope === 'day' ? active[0] : null;
  const notOnMap = active.flatMap((r) => r.notOnMap);
  const editItem = edit ? (items.find((i) => i.id === edit.id && !i.deletedAt) ?? null) : null;
  const meLane = me?.profileKey ?? null;
  const day = days.find((d) => d.date === selectedDay);
  const scopeName = scope === 'trip' ? S.maps.trip : day ? S.itinerary.dayHeading(day.dayNumber, day.title) : '';

  const scrollToMap = () => boxRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });

  const focusStop = (id: string) => {
    setFocus({ id, seq: Date.now() });
    scrollToMap();
  };

  const stopEdit = () => {
    searchAbort.current?.abort();
    setEdit(null);
    setDraft(null);
    setCandidates([]);
    setSearchState('idle');
  };

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    searchAbort.current?.abort();
    const ctrl = new AbortController();
    searchAbort.current = ctrl;
    setSearchState('searching');
    setCandidates([]);
    try {
      const found = await searchPlaces(q, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setCandidates(found);
      setSearchState('done');
    } catch {
      if (!ctrl.signal.aborted) setSearchState('error');
    }
  };

  const startFind = (item: ItineraryItem) => {
    if (edit?.id === item.id && edit.mode === 'find') return stopEdit();
    flow.reset();
    setDraft(null);
    setEdit({ id: item.id, mode: 'find', baseVersion: item.version });
    const q = placeLabel(item.place, item.title);
    setQuery(q);
    void runSearch(q); // one request per press
  };

  const startPin = (item: ItineraryItem) => {
    searchAbort.current?.abort();
    flow.reset();
    setCandidates([]);
    setSearchState('idle');
    setDraft(null);
    setEdit({ id: item.id, mode: 'pin', baseVersion: item.version });
    scrollToMap();
  };

  const saveSpot = async (ll: LatLng, source: MapSource) => {
    if (!edit || !editItem) return;
    const res = await flow.run(() =>
      ops.update(editItem.id, { mapLat: round6(ll.lat), mapLng: round6(ll.lng), mapSource: source }, edit.baseVersion),
    );
    if (res.ok) {
      stopEdit();
      focusStop(res.row.id);
    }
  };

  const reviewLatest = () => {
    const latest = flow.conflict?.latest;
    if (!latest) return stopEdit(); // removed elsewhere
    setEdit((e) => (e ? { ...e, baseVersion: latest.version } : e));
    flow.clearConflict();
  };

  const conflict = flow.conflict ? (
    <ConflictNotice
      source={conflictSource(flow.conflict.latest?.updatedBy, me?.id)}
      partnerName={partner?.displayName}
      onReview={reviewLatest}
      onDismiss={flow.clearConflict}
    />
  ) : null;

  return (
    <div className={styles.route} data-layout={layout}>
      <ChipGroup label={S.route.scopeLabel} className={styles.scope}>
        <Chip selected={scope === 'trip'} onClick={onTrip}>
          {S.maps.trip}
        </Chip>
        {days.map((d) => (
          <Chip key={d.id} selected={scope === 'day' && d.date === selectedDay} onClick={() => onSelectDay(d.date)}>
            {S.time.day(d.dayNumber)}
          </Chip>
        ))}
      </ChipGroup>

      <div ref={boxRef} className={styles.mapArea}>
        {edit?.mode === 'pin' && editItem && (
          <div className={styles.pinBar}>
            <p className={styles.pinPrompt}>{S.route.pinPrompt(editItem.title)}</p>
            <div className={styles.pinActions}>
              <Button variant="primary" size="sm" busy={flow.busy} disabled={!draft} onClick={() => draft && saveSpot(draft, 'pin')}>
                {S.route.saveLocation}
              </Button>
              <Button variant="ghost" size="sm" onClick={stopEdit}>
                {S.actions.cancel}
              </Button>
            </div>
          </div>
        )}
        <div className={styles.mapBox}>
          <RouteMapCanvas
            routes={mapRoutes}
            people={filter}
            dayNumbers={dayNumbers}
            scope={mapScope}
            focus={focus}
            nowIds={stableNowIds}
            me={meLane}
            pinMode={edit?.mode === 'pin' && !!editItem}
            draft={draft}
            draftLabel={editItem ? S.route.pinFor(editItem.title) : ''}
            onDraft={setDraft}
            onOpenItem={onOpenItem}
            onSelectDay={onSelectDay}
            ariaLabel={S.route.mapLabel(scopeName)}
          />
        </div>
        <div className={styles.statusRow}>
          <SaveStatus state={flow.state} />
        </div>
        {conflict}
      </div>

      <div className={styles.legend} aria-label={S.route.legendLabel} role="group">
        <ul className={styles.legendKeys}>
          <li>
            <i className={styles.swatch} aria-hidden="true" />
            {S.people.participants.together}
          </li>
          <li>
            <i className={[styles.swatch, styles.erenSwatch].join(' ')} aria-hidden="true" />
            {S.people.participants.eren}
          </li>
          <li>
            <i className={[styles.swatch, styles.amySwatch].join(' ')} aria-hidden="true" />
            {S.people.participants.amy}
          </li>
        </ul>
      </div>

      {dayRoute ? (
        dayRoute.stops.length ? (
          <ol className={styles.stops} aria-label={S.route.stopsLabel}>
            {dayRoute.stops.map((s) => (
              <li key={s.item.id}>
                <button type="button" className={styles.stop} onClick={() => focusStop(s.item.id)} aria-label={S.route.showOnMap(s.item.title)}>
                  <span className={[styles.num, styles[`lane_${s.lane}`], s.item.status === 'idea' ? styles.idea : ''].join(' ')} aria-hidden="true">
                    {s.n}
                  </span>
                  <span className={styles.stopTime}>{stopTime(s.item)}</span>
                  <span className={styles.stopText}>
                    <span className={styles.stopTitle}>{s.item.title}</span>
                    {s.item.place.trim() && <span className={styles.stopPlace}>{s.item.place}</span>}
                  </span>
                  <span className={styles.stopMarks}>
                    {s.meetUp && <Badge tone="soft">{S.maps.meetUp}</Badge>}
                    {s.lane !== 'together' && <MemberMarks who={s.lane} size="sm" />}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>{S.route.noStops}</p>
        )
      ) : (
        <ul className={styles.days} aria-label={S.route.daysLabel}>
          {days.map((d) => {
            const r = routes.find((x) => x.date === d.date);
            return (
              <li key={d.id}>
                <button type="button" className={styles.dayRow} onClick={() => onSelectDay(d.date)}>
                  <span className={styles.dayNum}>{S.time.day(d.dayNumber)}</span>
                  <span className={styles.dayTitle}>{d.title}</span>
                  <span className={styles.dayCount}>{S.route.stopCount(r?.stops.length ?? 0)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {notOnMap.length > 0 && (
        <section className={styles.missing} aria-labelledby={headingId}>
          <h4 id={headingId} className={styles.missingHeading}>
            {S.maps.notOnMap} · {S.maps.addToMap}
          </h4>
          <p className={styles.hint}>{S.route.notOnMapHint}</p>
          <ul className={styles.missingList}>
            {notOnMap.map((i) => {
              const finding = edit?.id === i.id && edit.mode === 'find';
              const meta = [scope === 'trip' ? S.time.day(dayNumbers.get(i.date) ?? 0) : null, stopTime(i), i.place.trim() || null]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={i.id} className={styles.missingItem}>
                  <div className={styles.missingText}>
                    <span className={styles.stopTitle}>{i.title}</span>
                    <span className={styles.stopPlace}>{meta}</span>
                  </div>
                  <div className={styles.missingActions}>
                    <Button variant="secondary" size="sm" aria-expanded={finding} onClick={() => startFind(i)}>
                      {S.maps.findOnMap}
                    </Button>
                    <Button variant="secondary" size="sm" aria-pressed={edit?.id === i.id && edit.mode === 'pin'} onClick={() => startPin(i)}>
                      {S.maps.pinOnMap}
                    </Button>
                  </div>
                  {finding && (
                    <form
                      className={styles.find}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void runSearch(query);
                      }}
                    >
                      <div className={styles.findRow}>
                        <Field label={S.route.searchLabel} className={styles.findField}>
                          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" enterKeyHint="search" />
                        </Field>
                        <Button type="submit" variant="secondary" size="sm" busy={searchState === 'searching'}>
                          {S.route.search}
                        </Button>
                      </div>
                      <p className={styles.findStatus} role="status" aria-live="polite">
                        {searchState === 'searching'
                          ? S.route.searching
                          : searchState === 'error'
                            ? S.route.searchFailed
                            : searchState === 'done' && !candidates.length
                              ? S.route.noResults
                              : ''}
                      </p>
                      {candidates.length > 0 && (
                        <ul className={styles.candidates} aria-label={S.route.candidatesLabel(query)}>
                          {candidates.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                className={styles.candidate}
                                disabled={flow.busy}
                                aria-label={S.route.useThis(c.address)}
                                onClick={() => saveSpot(c, 'search')}
                              >
                                <span className={styles.stopTitle}>{c.name}</span>
                                <span className={styles.stopPlace}>{c.address}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className={styles.credit}>{S.route.searchCredit}</p>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
