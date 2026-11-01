'use client';
// Where We Are map (plan §7.8): E / A markers with a faint accuracy circle.
// Fits both people while nobody touches the map; after a pan or zoom it stays
// put and offers "Fit both". Names never cover each other (two people at one
// spot get stacked labels). "Show my location" sits bottom left. Loaded only
// when the card is opened.
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { restackLabels } from '@/lib/mapLabels';
import type { ProfileKey } from '@/lib/types';
import { S } from '@/lib/strings';
import { addLocateControl } from './locate';
import styles from './LiveMap.module.css';

export interface LivePerson {
  key: ProfileKey;
  name: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** live = sharing and fresh; stale / off are drawn faded. */
  state: 'live' | 'stale' | 'off';
  seen: string;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const INITIAL: Record<ProfileKey, string> = { eren: 'E', amy: 'A' };
const COLOR: Record<ProfileKey, string> = { eren: '#286A82', amy: '#A98248' };
const FIT: L.FitBoundsOptions = { padding: [48, 48], maxZoom: 16, animate: false };

export default function LiveMapCanvas({
  people,
  ariaLabel,
  focus,
}: {
  people: LivePerson[];
  ariaLabel: string;
  /** Centre on this person once (e.g. right after "Share my location"); `seq` repeats it. */
  focus?: { key: ProfileKey; seq: number } | null;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const labelsRef = useRef<L.Marker[]>([]);
  const autoRef = useRef(true);
  const programmatic = useRef(false);
  const [auto, setAuto] = useState(true);

  const fit = () => {
    const map = mapRef.current;
    if (!map || !people.length) return;
    const size = map.getSize();
    if (!size.x || !size.y) return;
    programmatic.current = true;
    if (people.length === 1) map.setView([people[0].lat, people[0].lng], 15, { animate: false });
    else map.fitBounds(L.latLngBounds(people.map((p) => [p.lat, p.lng] as [number, number])), FIT);
    programmatic.current = false;
  };

  // Live first, so a sharing person's name keeps its place next to the pin.
  const relabel = () => {
    const map = mapRef.current;
    if (map) restackLabels(labelsRef.current.map((m) => m.getTooltip()?.getElement()), map.getContainer());
  };

  // ── map, once ──
  useEffect(() => {
    const node = elRef.current;
    if (!node) return;
    // The first view is set before the move listeners exist, so it is not taken for a person's pan.
    const map = L.map(node, { zoomSnap: 0.5, scrollWheelZoom: false, attributionControl: true, center: [-33.8688, 151.2093], zoom: 12 });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    // Tiles straight from OSM; never cached by the service worker.
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.on('click focus', () => map.scrollWheelZoom.enable());
    map.on('blur mouseout', () => map.scrollWheelZoom.disable());
    // A pan or zoom by the person stops the automatic fitting.
    map.on('dragstart zoomstart', () => {
      if (programmatic.current) return;
      autoRef.current = false;
      setAuto(false);
    });
    map.on('moveend', relabel);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Moving to the device is a choice like a pan: automatic fitting stops ("Fit both" returns).
    const removeLocate = addLocateControl(map, () => {
      autoRef.current = false;
      setAuto(false);
    });
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (autoRef.current) fit();
      relabel();
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
      removeLocate();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── markers ──
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    labelsRef.current = [];
    // The faded person first, so a live marker sits on top.
    const ordered = [...people].sort((a, b) => Number(a.state === 'live') - Number(b.state === 'live'));
    for (const p of ordered) {
      const faded = p.state !== 'live';
      if (!faded && p.accuracyM && p.accuracyM > 15) {
        L.circle([p.lat, p.lng], {
          radius: Math.min(p.accuracyM, 2000),
          color: COLOR[p.key],
          weight: 1,
          opacity: 0.4,
          fillColor: COLOR[p.key],
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(layer);
      }
      const html = `<span class="${[styles.marker, styles[p.key], faded ? styles.faded : ''].join(' ')}">${INITIAL[p.key]}</span>`;
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: styles.hit, html, iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14] }),
        keyboard: true,
        zIndexOffset: faded ? 0 : 500,
        title: `${p.name} · ${p.seen}`,
      }).addTo(layer);
      marker.bindTooltip(`${p.name} · ${p.seen}`, { permanent: true, direction: 'bottom', offset: [0, 16], className: styles.label });
      labelsRef.current.unshift(marker);
    }
    if (autoRef.current) fit();
    const raf = requestAnimationFrame(relabel);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  // ── centre on one person (after sharing) ──
  const focusDone = useRef(-1);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || focusDone.current === focus.seq) return;
    const p = people.find((x) => x.key === focus.key);
    if (!p) return; // the new position has not arrived yet; runs again when it does
    focusDone.current = focus.seq;
    programmatic.current = true;
    map.setView([p.lat, p.lng], 16, { animate: false });
    programmatic.current = false;
    // Stay on this person; "Fit both" brings the other one back into view.
    autoRef.current = false;
    setAuto(false);
  }, [focus, people]);

  return (
    <div className={styles.wrap}>
      <div ref={elRef} className={styles.map} role="region" aria-label={ariaLabel} />
      {!auto && people.length > 1 && (
        <button
          type="button"
          className={styles.fitButton}
          onClick={() => {
            autoRef.current = true;
            setAuto(true);
            fit();
          }}
        >
          {S.location.fitBoth}
        </button>
      )}
    </div>
  );
}
