'use client';
// Leaflet + OpenStreetMap canvas for the route (plan §7.2.7). Loaded only with
// the Route view (RouteView is a next/dynamic chunk), together with Leaflet's CSS.
// Leaflet is driven imperatively; React owns only the container.
// User text reaches Leaflet as DOM nodes (textContent), never as HTML strings.
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useLayoutEffect, useRef } from 'react';
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
  visibleLabels,
  type DayRoute,
  type Lane,
  type LatLng,
  type PinGroup,
} from './routeLogic';
import styles from './route.module.css';

export interface RouteMapCanvasProps {
  /** Everyone's routes. */
  routes: DayRoute[];
  /** Together = everyone at full strength; Eren / Amy = the other person is faded. */
  people: PeopleFilter;
  dayNumbers: Map<string, number>;
  /** 'trip' or the selected date. */
  scope: string;
  focus: { id: string; seq: number } | null;
  nowIds: string[];
  me: Lane | null;
  pinMode: boolean;
  draft: LatLng | null;
  /** Accessible name of the draggable draft pin. */
  draftLabel: string;
  onDraft: (ll: LatLng) => void;
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
/** The other person's lines and pins when one person is chosen: faded, still readable. */
const OTHER = 0.45;

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
  const { routes, people, dayNumbers, scope, focus, nowIds, me, pinMode, draft, ariaLabel } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const lanesRef = useRef<LaneLine[]>([]);
  const labelledRef = useRef<L.Marker[]>([]);
  const draftRef = useRef<L.Marker | null>(null);
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

  const relabel = () => {
    const els = labelledRef.current.map((m) => m.getTooltip()?.getElement() ?? null);
    for (const e of els) e?.classList.remove(styles.labelHidden);
    const boxes = els.map((e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    });
    visibleLabels(boxes).forEach((show, k) => {
      if (!show) els[k]?.classList.add(styles.labelHidden);
    });
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
      relabel();
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (cbRef.current.pinMode) cbRef.current.onDraft({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      const pending = pendingFitRef.current;
      const size = map.getSize();
      if (pending && size.x > 0 && size.y > 0) {
        map.fitBounds(pending, FIT);
        pendingFitRef.current = null;
      }
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      draftRef.current = null;
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

      groupStops(route.stops).forEach((g, k) => {
        const lane = groupLane(g);
        const focused = isFocusLane(lane, people);
        const fade = focused ? 1 : OTHER;
        const idea = g.stops.every((s) => s.item.status === 'idea');
        const done = g.stops.every((s) => s.item.status === 'completed');
        const meet = g.stops.some((s) => s.meetUp);
        const isNow = g.stops.some((s) => now.has(s.item.id));
        const numbered = !trip;
        const cls = [
          numbered ? styles.pin : styles.dot,
          styles[`lane_${lane}`],
          idea ? styles.idea : '',
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
        // The other person's stops keep their pins but no name labels, so the chosen route reads first.
        const label = !focused ? '' : numbered ? placeLabel(g.stops[0].item.place, g.stops[0].item.title) : k === 0 ? S.time.day(dayNumbers.get(route.date) ?? 0) : '';
        if (label) {
          marker.bindTooltip(el('span', undefined, label), {
            permanent: true,
            direction: 'right',
            offset: [numbered ? 10 : 2, 0],
            className: numbered ? styles.label : styles.dayLabel,
            interactive: false,
          });
          labelledRef.current.push(marker);
        }
      });
    };

    // Only the chosen day (or every day on Trip); other days are not drawn.
    for (const r of routes) if (isActive(r)) drawRoute(r);

    // Fit when the day or the person changes (not on every data refresh): the chosen person's
    // stops (plus Together), else every stop of the day.
    const fitKey = `${scope}|${people}`;
    const dayStops = routes.filter(isActive).flatMap((r) => r.stops);
    const pts = dayStops.filter((s) => isFocusLane(s.lane, people));
    if (fittedRef.current !== fitKey) {
      const all = pts.length ? pts : dayStops.length ? dayStops : routes.flatMap((r) => r.stops);
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
  }, [routes, people, scope, nowIds, me, dayNumbers]);

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

  // ── pin mode: draggable draft marker ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().classList.toggle(styles.picking, pinMode);
    if (!pinMode) {
      draftRef.current?.remove();
      draftRef.current = null;
      return;
    }
    if (!draft) {
      const c = map.getCenter();
      cbRef.current.onDraft({ lat: c.lat, lng: c.lng });
      return;
    }
    if (!draftRef.current) {
      const m = L.marker([draft.lat, draft.lng], {
        draggable: true,
        autoPan: true,
        zIndexOffset: 3000,
        icon: L.divIcon({ className: styles.hit, html: `<span class="${styles.draft}"></span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
      }).addTo(map);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        cbRef.current.onDraft({ lat: ll.lat, lng: ll.lng });
      });
      m.getElement()?.setAttribute('aria-label', cbRef.current.draftLabel);
      draftRef.current = m;
      if (!map.getBounds().contains([draft.lat, draft.lng])) map.panTo([draft.lat, draft.lng]);
    } else {
      draftRef.current.setLatLng([draft.lat, draft.lng]);
    }
  }, [pinMode, draft]);

  return <div ref={elRef} className={styles.map} role="region" aria-label={ariaLabel} />;
}
