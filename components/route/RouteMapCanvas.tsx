'use client';
// Leaflet + OpenStreetMap canvas for the route (plan §7.2.7). Loaded only with
// the Route view (RouteView is a next/dynamic chunk), together with Leaflet's CSS.
// Leaflet is driven imperatively; React owns only the container.
// User text reaches Leaflet as DOM nodes (textContent), never as HTML strings.
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { addLocateControl } from '@/components/location/locate';
import { arrangeLabels } from '@/lib/mapLabels';
import { S } from '@/lib/strings';
import type { PeopleFilter } from '@/components/itinerary/logic';
import type { ItineraryItem } from '@/lib/types';
import {
  LANE_OFFSET_PX,
  boundsOf,
  type Bounds,
  directionsUrl,
  groupLane,
  isFocusLane,
  routeNumber,
  groupStops,
  incomingSegment,
  lineStyle,
  offsetSegment,
  pinText,
  stopLabel,
  stopTime,
  type DayRoute,
  type Lane,
  type PinGroup,
} from './routeLogic';
import styles from './route.module.css';

export interface RouteMapCanvasProps {
  /** Everyone's routes. */
  routes: DayRoute[];
  /** The lane at full strength and framed (Together / Eren / Amy, each on its own); the rest faded. */
  people: PeopleFilter;
  dayNumbers: Map<string, number>;
  /** 'trip' or the selected date. */
  scope: string;
  /** The trip's own zone: the Trip view frames it, leaving the flights home out of the frame. */
  tripTz: string;
  focus: { id: string; seq: number } | null;
  nowIds: string[];
  me: Lane | null;
  onOpenItem: (item: ItineraryItem) => void;
  onSelectDay: (date: string) => void;
  ariaLabel: string;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const DEFAULT_CENTER: [number, number] = [-33.8688, 151.2093]; // Sydney CBD
// Labels sit to the right of pins: keep extra room on that side.
const FIT: L.FitBoundsOptions = { paddingTopLeft: [36, 36], paddingBottomRight: [120, 36], maxZoom: 15, animate: false };
/** The other people's pins when one person is chosen: faded, still findable. */
const OTHER = 0.4;
/** The other people's lines when one person is chosen: clearly in the background (owner, 2026-11-01). */
const OTHER_LINE = 0.15;
/** Their names: still legible, plainly not the chosen route. */
const OTHER_LABEL = 0.4;

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

interface LaneLine {
  line: L.Polyline;
  a: L.LatLng;
  b: L.LatLng;
  px: number;
}

export default function RouteMapCanvas(props: RouteMapCanvasProps) {
  const { routes, people, dayNumbers, scope, tripTz, focus, nowIds, me, ariaLabel } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const lanesRef = useRef<LaneLine[]>([]);
  const labelledRef = useRef<Array<{ marker: L.Marker; faded: boolean }>>([]);
  const fittedRef = useRef<string | null>(null);
  const pendingFitRef = useRef<Bounds | null>(null);
  const focusDoneRef = useRef(-1);
  // Leaflet handlers read the latest callbacks without re-binding.
  const cbRef = useRef(props);
  useLayoutEffect(() => {
    cbRef.current = props;
  });

  const reoffset = () => {
    const map = mapRef.current;
    if (!map) return;
    for (const l of lanesRef.current) {
      if (!l.px) continue;
      const [a, b] = offsetSegment(map.latLngToLayerPoint(l.a), map.latLngToLayerPoint(l.b), l.px);
      l.line.setLatLngs([map.layerPointToLatLng(L.point(a.x, a.y)), map.layerPointToLatLng(L.point(b.x, b.y))]);
    }
  };

  // Every name stays visible: overlapping labels stack, the chosen person's first.
  const relabel = () => {
    const map = mapRef.current;
    if (!map) return;
    const ordered = [...labelledRef.current].sort((a, b) => Number(a.faded) - Number(b.faded));
    // Each name finds a free spot around its pin (right, left, above, below, diagonals), inside the map.
    arrangeLabels(
      ordered.map((l) => ({ label: l.marker.getTooltip()?.getElement(), pin: l.marker.getElement() })),
      map.getContainer(),
      styles.labelShifted,
    );
  };

  // ── map, once ────────────────────────────────────────────────
  useEffect(() => {
    const node = elRef.current;
    if (!node) return;
    const map = L.map(node, { center: DEFAULT_CENTER, zoom: 11, zoomSnap: 0.5, scrollWheelZoom: true });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    // Tiles come straight from OSM; nothing here (or in a service worker) caches them.
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    // The mouse wheel zooms the map straight away (owner, 2026-11-01).
    map.on('zoomend', reoffset);
    // After any move (zoom, pan, focus, popup autopan): labels near the edge restack against the new view.
    map.on('moveend', relabel);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const removeLocate = addLocateControl(map);
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      const pending = pendingFitRef.current;
      const size = map.getSize();
      if (pending && size.x > 0 && size.y > 0) {
        map.fitBounds(pending, FIT);
        pendingFitRef.current = null;
      }
      // Labels drawn while the map was hidden (0 size) could not be measured.
      if (size.x > 0 && size.y > 0) relabel();
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
      removeLocate();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // ── routes ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    lanesRef.current = [];
    labelledRef.current = [];
    const trip = scope === 'trip';
    const isActive = (r: DayRoute) => trip || r.date === scope;
    const now = new Set(trip ? [] : nowIds);

    const popupFor = (g: PinGroup, route: DayRoute): HTMLElement => {
      const root = el('div', styles.popup);
      if (trip) root.append(el('p', styles.popDay, S.time.day(dayNumbers.get(route.date) ?? 0)));
      // What this place is, and Directions (owner, 2026-11-01): no times or plan list here,
      // the stops list under the map opens the plans. The chosen person's number leads.
      const mine = g.stops.filter((s) => routeNumber(s, people) != null);
      const shown = mine.length ? mine : g.stops;
      const first = shown[0];
      const head = el('p', styles.popHead);
      if (mine.length && !trip) head.append(el('span', styles.popNum, pinText(mine.map((s) => routeNumber(s, people)!))));
      head.append(el('span', styles.popTitle, stopLabel(first.item)));
      root.append(head);
      const place = first.item.place.trim();
      if (place && place !== stopLabel(first.item)) root.append(el('p', styles.popPlace, place));
      const seg = incomingSegment(route, first.item.id, me);
      const dir = el('a', styles.popLink, S.maps.directions);
      dir.href = directionsUrl(first, seg ? seg.from : null);
      dir.target = '_blank';
      dir.rel = 'noopener noreferrer';
      root.append(dir);
      if (trip) {
        const open = el('button', styles.popButton, S.route.openDay(dayNumbers.get(route.date) ?? 0));
        open.type = 'button';
        open.addEventListener('click', () => cbRef.current.onSelectDay(route.date));
        root.append(open);
      }
      return root;
    };

    /** Every stretch looks the same but for its person's colour; Together's has a paper casing over busy tiles. */
    const drawLine = (a: L.LatLng, b: L.LatLng, lane: Lane, focused: boolean, interactive: boolean): L.Polyline => {
      const st = lineStyle(lane);
      if (lane === 'together') {
        L.polyline([a, b], { color: '#FFFDF9', weight: st.weight + 4, opacity: 0.7 * st.opacity * (focused ? 1 : OTHER_LINE), interactive: false }).addTo(layer);
      }
      return L.polyline([a, b], {
        color: st.color,
        weight: st.weight,
        opacity: st.opacity * (focused ? 1 : OTHER_LINE),
        dashArray: st.dashArray ?? undefined,
        lineCap: 'round',
        interactive,
      }).addTo(layer);
    };

    const drawRoute = (route: DayRoute) => {
      // Lines run pin to pin, so a line never ends beside its pin or crosses one place.
      const groups = groupStops(route.stops);
      const pinOf = new Map(groups.flatMap((g) => g.stops.map((s) => [s.item.id, g] as const)));
      for (const seg of route.segments) {
        const ga = pinOf.get(seg.from.item.id);
        const gb = pinOf.get(seg.to.item.id);
        if (!ga || !gb || ga === gb) continue;
        const a = L.latLng(ga.lat, ga.lng);
        const b = L.latLng(gb.lat, gb.lng);
        const line = drawLine(a, b, seg.lane, isFocusLane(seg.lane, people), true);
        const pop = el('div', styles.popup);
        pop.append(el('p', styles.popTitle, `${stopLabel(seg.from.item)} → ${stopLabel(seg.to.item)}`));
        const dir = el('a', styles.popLink, S.maps.directions);
        dir.href = directionsUrl(seg.to, seg.from);
        dir.target = '_blank';
        dir.rel = 'noopener noreferrer';
        pop.append(dir);
        line.bindPopup(pop);
        lanesRef.current.push({ line, a, b, px: LANE_OFFSET_PX[seg.lane] });
      }

      // A flight with nothing after it at the arrival airport: a line there and a small end mark.
      for (const f of route.flights) {
        const focused = isFocusLane(f.lane, people);
        const from = pinOf.get(f.item.id) ?? f.from;
        const b = L.latLng(f.to.lat, f.to.lng);
        drawLine(L.latLng(from.lat, from.lng), b, f.lane, focused, false);
        const end = L.marker(b, {
          icon: L.divIcon({ className: styles.hit, html: `<span class="${styles.dot} ${styles[`lane_${f.lane}`]}" style="opacity:${focused ? 1 : OTHER}"></span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: focused ? 900 : 400,
        }).addTo(layer);
        end.bindTooltip(el('span', undefined, f.to.code), {
          permanent: true,
          direction: 'auto', // right of the pin, left of it past the middle: never cut off at the edge
          offset: [6, 0],
          className: styles.label,
          opacity: focused ? 0.9 : OTHER_LABEL,
          interactive: false,
        });
        labelledRef.current.push({ marker: end, faded: !focused });
      }

      // Day view: the chosen person's places are numbered pins; everyone else's are faded dots.
      // The Trip view labels each day once, on its first stop of the chosen person.
      // On the chosen route: its own plans and, on Eren's / Amy's, the Together plans
      // where we split up and meet again (numbered on that route).
      const firstFocused = groups.findIndex((g) => g.stops.some((s) => routeNumber(s, people) != null));
      groups.forEach((g, k) => {
        const mine = g.stops.filter((s) => routeNumber(s, people) != null);
        const focused = mine.length > 0;
        const shown = focused ? mine : g.stops;
        const lane = focused && people !== 'all' ? people : groupLane(g);
        const fade = focused ? 1 : OTHER;
        const done = shown.every((s) => s.item.status === 'completed');
        const meet = mine.some((s) => s.meetUp);
        const isNow = g.stops.some((s) => now.has(s.item.id));
        const numbered = !trip && focused;
        const meetPin = numbered && mine.every((s) => routeNumber(s, people)! < 0);
        const cls = [
          numbered ? styles.pin : styles.dot,
          meetPin ? styles.meet : '',
          styles[`lane_${lane}`],
          done ? styles.done : '',
          isNow ? styles.now : '',
        ]
          .filter(Boolean)
          .join(' ');
        const text = numbered ? pinText(mine.map((s) => routeNumber(s, people)!)) : '';
        const html = `<span class="${cls}" style="opacity:${fade}">${text ? `<span>${text}</span>` : ''}${numbered && done ? CHECK_SVG : ''}</span>`;
        const size = 44;
        const marker = L.marker([g.lat, g.lng], {
          icon: L.divIcon({ className: styles.hit, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -12] }),
          interactive: true,
          keyboard: numbered,
          // Overlapping pins (zoomed out): the chosen person's on top, and of those the earlier place,
          // so the name beside it is its own and a later one steps aside with its number.
          zIndexOffset: (focused ? 20000 : 10000) - k * 100,
        }).addTo(layer);
        // Several plans at one pin (Day 3's 2·4·6) scroll inside the popup, which never grows past the map.
        marker.bindPopup(popupFor(g, route), { maxWidth: 280, minWidth: 200, maxHeight: Math.max(160, map.getSize().y - 96), keepInView: true });
        const name = g.stops.map((s) => s.item.title).join(', ');
        marker.getElement()?.setAttribute('aria-label', text ? S.route.stopLabel(text, name) : name);
        for (const s of g.stops) markersRef.current.set(s.item.id, marker);
        // Every place is named after its first plan, the others' faded like their pins.
        // Meet up rides in the name, so it never covers a pin next door. A name moved off
        // its pin (see relabel) is tied back to it by a dotted line, never by a number.
        const label = !trip ? stopLabel(shown[0].item) : focused && k === firstFocused ? S.time.day(dayNumbers.get(route.date) ?? 0) : '';
        if (label) {
          const content = el('span');
          if (numbered && meet) content.append(el('span', styles.labelMeet, S.maps.meetUp));
          content.append(label);
          marker.bindTooltip(content, {
            permanent: true,
            direction: 'auto', // right of the pin, left of it past the middle: never cut off at the edge
            offset: [numbered ? 10 : 2, 0],
            className: trip ? styles.dayLabel : styles.label,
            // Leaflet sets the tooltip opacity inline, so the fade goes through its option.
            opacity: focused ? 0.9 : OTHER_LABEL,
            interactive: false,
          });
          labelledRef.current.push({ marker, faded: !focused });
        }
      });
    };

    // Only the chosen day (or every day on Trip); other days are not drawn.
    for (const r of routes) if (isActive(r)) drawRoute(r);

    // Fit when the day or the lane changes (not on every data refresh): zoom in on the chosen
    // lane's stops; without any, on the whole day. The Trip view frames Sydney only: the
    // legs at home on Day 1 and Day 9 are drawn but would zoom the whole trip out to Korea.
    const fitKey = `${scope}|${people}`;
    const dayStops = routes
      .filter(isActive)
      .flatMap((r) => r.stops)
      .filter((s) => !trip || s.item.timezone === tripTz);
    // A day's flight frames its arrival airport too.
    const arrivals = trip ? [] : routes.filter(isActive).flatMap((r) => r.flights.map((f) => ({ lane: f.lane, lat: f.to.lat, lng: f.to.lng })));
    if (fittedRef.current !== fitKey) {
      const chosen = [...dayStops, ...arrivals].filter((s) => isFocusLane(s.lane, people));
      const all = chosen.length ? chosen : dayStops.length ? [...dayStops, ...arrivals] : routes.flatMap((r) => r.stops);
      const b = boundsOf(all);
      if (b) {
        // A map that has no size yet (just shown) cannot fit; the resize observer fits it then.
        const size = map.getSize();
        if (size.x > 0 && size.y > 0) {
          map.fitBounds(b, FIT);
          pendingFitRef.current = null;
        } else {
          pendingFitRef.current = b;
        }
        fittedRef.current = fitKey;
      }
    }
    reoffset();
    const raf = requestAnimationFrame(relabel);
    return () => cancelAnimationFrame(raf);
  }, [routes, people, scope, tripTz, nowIds, me, dayNumbers]);

  // ── focus a stop (from the list or after saving a spot) ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || focusDoneRef.current === focus.seq) return;
    const marker = markersRef.current.get(focus.id);
    if (!marker) return;
    focusDoneRef.current = focus.seq;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14), { animate: false });
    marker.openPopup();
  }, [focus, routes, scope]);

  return <div ref={elRef} className={styles.map} role="region" aria-label={ariaLabel} />;
}
