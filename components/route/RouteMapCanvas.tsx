'use client';
// Leaflet + OpenStreetMap canvas for the route (plan §7.2.7). Loaded only with
// the Route view (RouteView is a next/dynamic chunk), together with Leaflet's CSS.
// Leaflet is driven imperatively; React owns only the container.
// User text reaches Leaflet as DOM nodes (textContent), never as HTML strings.
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addLocateControl } from '@/components/location/locate';
import { restackLabels } from '@/lib/mapLabels';
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
  groupStops,
  incomingSegment,
  lineStyle,
  offsetSegment,
  pinText,
  placeLabel,
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

/** Which stops share each pin at a zoom ('a+b|c'): a change means the pins must be redrawn. */
const groupSignature = (routes: DayRoute[], zoom: number) =>
  routes.map((r) => groupStops(r.stops, zoom).map((g) => g.stops.map((s) => s.item.id).join('+')).join('|')).join('/');

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const DEFAULT_CENTER: [number, number] = [-33.8688, 151.2093]; // Sydney CBD
// Labels sit to the right of pins: keep extra room on that side.
const FIT: L.FitBoundsOptions = { paddingTopLeft: [36, 36], paddingBottomRight: [120, 36], maxZoom: 15, animate: false };
/** The other person's lines, pins and names when one person is chosen: faded, still readable. */
const OTHER = 0.5;

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
  // Day view: which stops share a pin at the drawn zoom; a zoom that changes it redraws.
  const groupSigRef = useRef('');
  const [regroup, setRegroup] = useState(0);
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
    restackLabels(
      ordered.map((l) => l.marker.getTooltip()?.getElement()),
      map.getContainer(),
      styles.labelShifted,
    );
  };

  // ── map, once ────────────────────────────────────────────────
  useEffect(() => {
    const node = elRef.current;
    if (!node) return;
    const map = L.map(node, { center: DEFAULT_CENTER, zoom: 11, zoomSnap: 0.5, scrollWheelZoom: false });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    // Tiles come straight from OSM; nothing here (or in a service worker) caches them.
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    // Wheel zoom only after the map is clicked or focused, so the page keeps scrolling.
    map.on('click focus', () => map.scrollWheelZoom.enable());
    map.on('blur mouseout', () => map.scrollWheelZoom.disable());
    map.on('zoomend', () => {
      reoffset();
      const p = cbRef.current;
      if (p.scope !== 'trip' && groupSignature(p.routes.filter((r) => r.date === p.scope), map.getZoom()) !== groupSigRef.current) {
        setRegroup((n) => n + 1);
      }
    });
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
    // Day view groups by what overlaps at this zoom; the Trip view keeps each place's dot.
    const zoom = trip ? null : map.getZoom();

    const popupFor = (g: PinGroup, route: DayRoute): HTMLElement => {
      const root = el('div', styles.popup);
      if (trip) root.append(el('p', styles.popDay, S.time.day(dayNumbers.get(route.date) ?? 0)));
      for (const s of g.stops) {
        const block = el('div', styles.popStop);
        const head = el('p', styles.popHead);
        head.append(el('span', styles.popNum, String(s.n)), el('span', undefined, stopTime(s.item)));
        if (s.meetUp) head.append(el('span', styles.popMeet, S.maps.meetUp));
        block.append(head, el('p', styles.popTitle, s.item.title));
        if (s.item.place.trim()) block.append(el('p', styles.popPlace, s.item.place));
        const actions = el('div', styles.popActions);
        const seg = incomingSegment(route, s.item.id, me);
        const dir = el('a', styles.popLink, S.maps.directions);
        dir.href = directionsUrl(s, seg ? seg.from : null, seg?.mode ?? s.item.travelMode ?? 'walk');
        dir.target = '_blank';
        dir.rel = 'noopener noreferrer';
        const more = el('button', styles.popButton, S.actions.viewDetails);
        more.type = 'button';
        more.addEventListener('click', () => cbRef.current.onOpenItem(s.item));
        actions.append(dir, more);
        block.append(actions);
        root.append(block);
      }
      if (trip) {
        const open = el('button', styles.popButton, S.route.openDay(dayNumbers.get(route.date) ?? 0));
        open.type = 'button';
        open.addEventListener('click', () => cbRef.current.onSelectDay(route.date));
        root.append(open);
      }
      return root;
    };

    const drawRoute = (route: DayRoute) => {
      for (const seg of route.segments) {
        const fade = isFocusLane(seg.lane, people) ? 1 : OTHER;
        const st = lineStyle(seg.lane, seg.mode, seg.idea);
        const a = L.latLng(seg.from.lat, seg.from.lng);
        const b = L.latLng(seg.to.lat, seg.to.lng);
        if (seg.lane === 'together') {
          // Paper casing keeps the Ink line readable over busy tiles.
          L.polyline([a, b], { color: '#FFFDF9', weight: st.weight + 4, opacity: 0.7 * st.opacity, interactive: false }).addTo(layer);
        }
        const line = L.polyline([a, b], {
          color: st.color,
          weight: st.weight,
          opacity: st.opacity * fade,
          dashArray: st.dashArray ?? undefined,
          lineCap: 'round',
          interactive: true,
        }).addTo(layer);
        {
          const pop = el('div', styles.popup);
          pop.append(el('p', styles.popTitle, `${seg.from.n} → ${seg.to.n}`), el('p', styles.popPlace, `${seg.from.item.title} → ${seg.to.item.title}`));
          const dir = el('a', styles.popLink, S.maps.directions);
          dir.href = directionsUrl(seg.to, seg.from, seg.mode);
          dir.target = '_blank';
          dir.rel = 'noopener noreferrer';
          pop.append(dir);
          line.bindPopup(pop);
        }
        lanesRef.current.push({ line, a, b, px: LANE_OFFSET_PX[seg.lane] });
      }

      // Flights: a line from the departure airport (where the item's pin is) to the arrival
      // airport, which gets a small end mark named by its code ('SYD T1').
      for (const f of route.flights) {
        const focused = isFocusLane(f.lane, people);
        const st = lineStyle(f.lane);
        const a = L.latLng(f.from.lat, f.from.lng);
        const b = L.latLng(f.to.lat, f.to.lng);
        L.polyline([a, b], { color: st.color, weight: st.weight, opacity: st.opacity * (focused ? 1 : OTHER), lineCap: 'round', interactive: false }).addTo(layer);
        const end = L.marker(b, {
          icon: L.divIcon({ className: styles.hit, html: `<span class="${styles.dot} ${styles[`lane_${f.lane}`]}" style="opacity:${focused ? 1 : OTHER}"></span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: focused ? 900 : 400,
        }).addTo(layer);
        end.bindTooltip(el('span', undefined, f.to.code), {
          permanent: true,
          direction: 'right',
          offset: [6, 0],
          className: styles.label,
          opacity: focused ? 0.9 : 0.55,
          interactive: false,
        });
        labelledRef.current.push({ marker: end, faded: !focused });
      }

      // Trip view labels each day once, on its first stop of the chosen person.
      const groups = groupStops(route.stops, zoom);
      const firstFocused = groups.findIndex((g) => isFocusLane(groupLane(g), people));
      groups.forEach((g, k) => {
        const lane = groupLane(g);
        const focused = isFocusLane(lane, people);
        const fade = focused ? 1 : OTHER;
        const done = g.stops.every((s) => s.item.status === 'completed');
        const meet = g.stops.some((s) => s.meetUp);
        const isNow = g.stops.some((s) => now.has(s.item.id));
        const numbered = !trip;
        const cls = [
          numbered ? styles.pin : styles.dot,
          styles[`lane_${lane}`],
          done ? styles.done : '',
          isNow ? styles.now : '',
        ]
          .filter(Boolean)
          .join(' ');
        const text = numbered ? pinText(g.stops.map((s) => s.n)) : '';
        const html =
          `<span class="${cls}" style="opacity:${fade}">${text ? `<span>${text}</span>` : ''}${numbered && done ? CHECK_SVG : ''}</span>` +
          (numbered && meet ? `<span class="${styles.meet}">${S.maps.meetUp}</span>` : '');
        const size = 44;
        const marker = L.marker([g.lat, g.lng], {
          icon: L.divIcon({ className: styles.hit, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -12] }),
          interactive: true,
          keyboard: numbered,
          zIndexOffset: (focused ? 1000 : 500) + (meet ? 200 : 0),
        }).addTo(layer);
        marker.bindPopup(popupFor(g, route), { maxWidth: 280, minWidth: 200 });
        const name = g.stops.map((s) => s.item.title).join(', ');
        marker.getElement()?.setAttribute('aria-label', S.route.stopLabel(pinText(g.stops.map((s) => s.n)), name));
        for (const s of g.stops) markersRef.current.set(s.item.id, marker);
        // Every stop is named; the other person's names are faded like their pins. A shared pin
        // lists each place once. A label moved off its pin (see relabel) shows the pin number.
        const label = numbered
          ? [...new Set(g.stops.map((s) => placeLabel(s.item.place, s.item.title)))].join(' · ')
          : focused && k === firstFocused
            ? S.time.day(dayNumbers.get(route.date) ?? 0)
            : '';
        if (label) {
          const content = el('span');
          if (numbered) content.append(el('b', styles.labelNum, text));
          content.append(label);
          marker.bindTooltip(content, {
            permanent: true,
            direction: 'right',
            offset: [numbered ? 10 : 2, 0],
            className: numbered ? styles.label : styles.dayLabel,
            // Leaflet sets the tooltip opacity inline, so the fade goes through its option.
            opacity: focused ? 0.9 : 0.55,
            interactive: false,
          });
          labelledRef.current.push({ marker, faded: !focused });
        }
      });
    };

    // Only the chosen day (or every day on Trip); other days are not drawn.
    for (const r of routes) if (isActive(r)) drawRoute(r);
    groupSigRef.current = zoom === null ? '' : groupSignature(routes.filter(isActive), zoom);

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
    // `regroup` only asks for a redraw; the zoom itself is read from the map.
  }, [routes, people, scope, tripTz, nowIds, me, dayNumbers, regroup]);

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
