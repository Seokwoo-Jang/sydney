'use client';
// Route view of the itinerary (plan §7.2.7). Loaded lazily by ItineraryBody
// (next/dynamic, no SSR) the first time "Route" is chosen, with Leaflet inside.
// The List view stays the primary accessible representation; here the stops
// list under the map repeats the pin order as buttons.
import { useId, useMemo, useRef, useState } from 'react';
import { conflictSource, useSaveFlow } from '@/components/checklist/useSaveFlow';
import type { PeopleFilter } from '@/components/itinerary/logic';
import { Badge, Button, Chip, ChipGroup, ConflictNotice, Field, MemberMarks, SaveStatus, TextInput } from '@/components/ui';
import { useEntityOps, useMapLinkResolver } from '@/lib/data';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { needsLookup, parseMapUrl } from '@/lib/maps';
import { S } from '@/lib/strings';
import type { ItineraryItem, Member, TripDay } from '@/lib/types';
import RouteMapCanvas from './RouteMapCanvas';
import { buildTripRoutes, narrowRoute, stopTime } from './routeLogic';
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

/** Add Google Maps link for one unplaced item. */
interface Edit {
  id: string;
  /** Version the edit started from; a newer row means a conflict. */
  baseVersion: number;
}

type LinkState = 'idle' | 'locating' | 'invalid' | 'noLocation';

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
  const resolveLink = useMapLinkResolver();
  /** Bumped whenever the open form changes, so a late lookup never saves into another item. */
  const editSeq = useRef(0);

  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [link, setLink] = useState('');
  const [linkState, setLinkState] = useState<LinkState>('idle');

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
    editSeq.current++;
    setEdit(null);
    setLink('');
    setLinkState('idle');
  };

  const startAdd = (item: ItineraryItem) => {
    if (edit?.id === item.id) return stopEdit();
    editSeq.current++;
    flow.reset();
    setEdit({ id: item.id, baseVersion: item.version });
    setLink('');
    setLinkState('idle');
  };

  /** Spot from the link itself, else the server reads it from a share link (as in the item sheet). */
  const saveLink = async () => {
    if (!edit || !editItem || linkState === 'locating' || flow.busy) return;
    const parsed = parseMapUrl(link);
    if (!parsed.ok) return setLinkState('invalid');
    const seq = editSeq.current;
    let spot = parsed.lat !== null && parsed.lng !== null ? { lat: parsed.lat, lng: parsed.lng, name: parsed.name } : null;
    if (!spot && needsLookup(parsed)) {
      setLinkState('locating');
      const r = await resolveLink(parsed.url);
      if (seq !== editSeq.current) return; // closed or moved on meanwhile
      spot = r ? { lat: r.lat, lng: r.lng, name: r.name ?? parsed.name } : null;
    }
    if (!spot) return setLinkState('noLocation');
    setLinkState('idle');
    const { lat, lng, name } = spot;
    const place = editItem.place.trim() || name || editItem.place;
    const res = await flow.run(() =>
      ops.update(editItem.id, { mapUrl: parsed.url, mapLat: round6(lat), mapLng: round6(lng), mapSource: 'link', place }, edit.baseVersion),
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
      {/* Trip on the first row; Day 1–9 share the second row in equal cells and never wrap. */}
      <ChipGroup label={S.route.scopeLabel} className={styles.scope}>
        <Chip selected={scope === 'trip'} onClick={onTrip} className={styles.tripChip}>
          {S.maps.trip}
        </Chip>
        {days.map((d) => (
          <Chip key={d.id} selected={scope === 'day' && d.date === selectedDay} onClick={() => onSelectDay(d.date)} className={styles.dayChip}>
            <span className={styles.dayWord}>{S.time.dayWord} </span>
            {d.dayNumber}
          </Chip>
        ))}
      </ChipGroup>

      <div ref={boxRef} className={styles.mapArea}>
        <div className={styles.mapBox}>
          <RouteMapCanvas
            routes={mapRoutes}
            people={filter}
            dayNumbers={dayNumbers}
            scope={mapScope}
            tripTz={tripTz}
            focus={focus}
            nowIds={stableNowIds}
            me={meLane}
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
              const adding = edit?.id === i.id;
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
                    <Button variant="secondary" size="sm" aria-expanded={adding} onClick={() => startAdd(i)}>
                      {S.maps.addMapLink}
                    </Button>
                  </div>
                  {adding && (
                    <form
                      className={styles.find}
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveLink();
                      }}
                    >
                      <div className={styles.findRow}>
                        <Field label={S.maps.link} className={styles.findField}>
                          <TextInput
                            type="url"
                            inputMode="url"
                            value={link}
                            autoComplete="off"
                            spellCheck={false}
                            enterKeyHint="done"
                            onChange={(e) => {
                              setLink(e.target.value);
                              if (linkState !== 'locating') setLinkState('idle');
                            }}
                          />
                        </Field>
                        <Button type="submit" variant="secondary" size="sm" disabled={!link.trim()} busy={linkState === 'locating' || flow.busy}>
                          {S.route.saveLink}
                        </Button>
                      </div>
                      <p className={styles.findStatus} role="status" aria-live="polite">
                        {linkState === 'locating'
                          ? S.maps.locating
                          : linkState === 'invalid'
                            ? S.maps.notAMapLink
                            : linkState === 'noLocation'
                              ? S.maps.noLocation
                              : ''}
                      </p>
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
