// "Show my location" button for the Leaflet maps (Where We Are, Route), bottom
// left like most map apps. Each press reads the device position once, centres
// the map on it and marks it with a dot. Nothing is stored or sent.
import * as L from 'leaflet';
import { S } from '@/lib/strings';
import styles from './Locate.module.css';

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>' +
  '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>';
const MESSAGE_MS = 4000;

/** Adds the button; `onLocated` runs after the map moved to the device. Returns a cleanup. */
export function addLocateControl(map: L.Map, onLocated?: () => void): () => void {
  const layer = L.layerGroup().addTo(map);
  let timer: number | undefined;
  let pending = false;
  let disposed = false; // a position can arrive after the map is gone

  const control = new L.Control({ position: 'bottomleft' });
  control.onAdd = () => {
    const root = L.DomUtil.create('div', styles.locate);
    const button = L.DomUtil.create('button', styles.button, root);
    button.type = 'button';
    button.title = S.maps.showMyLocation;
    button.setAttribute('aria-label', S.maps.showMyLocation);
    button.innerHTML = ICON;
    const note = L.DomUtil.create('p', styles.note, root);
    note.setAttribute('role', 'status');
    // Clicks here never reach the map (no popup closing, no wheel zoom).
    L.DomEvent.disableClickPropagation(root);
    L.DomEvent.disableScrollPropagation(root);

    // Results fade after a few seconds; "Finding you…" stays until the answer.
    const say = (text: string, keep = false) => {
      note.textContent = text;
      window.clearTimeout(timer);
      if (text && !keep) timer = window.setTimeout(() => (note.textContent = ''), MESSAGE_MS);
    };
    const done = () => {
      pending = false;
      button.removeAttribute('aria-busy');
    };

    button.addEventListener('click', () => {
      if (pending) return;
      if (!('geolocation' in navigator)) return say(S.maps.locateFailed);
      pending = true;
      button.setAttribute('aria-busy', 'true');
      say(S.maps.findingYou, true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (disposed) return;
          done();
          say(S.maps.youAreHere);
          const here = L.latLng(pos.coords.latitude, pos.coords.longitude);
          layer.clearLayers();
          if (pos.coords.accuracy > 15) {
            L.circle(here, { radius: Math.min(pos.coords.accuracy, 2000), color: '#2f6fb5', weight: 1, opacity: 0.35, fillOpacity: 0.08, interactive: false }).addTo(layer);
          }
          L.circleMarker(here, { radius: 7, color: '#fff', weight: 2.5, fillColor: '#2f6fb5', fillOpacity: 1, interactive: false }).addTo(layer);
          map.setView(here, Math.max(map.getZoom(), 16), { animate: false });
          onLocated?.();
        },
        (err) => {
          if (disposed) return;
          done();
          say(err.code === err.PERMISSION_DENIED ? S.maps.locateDenied : S.maps.locateFailed);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
    return root;
  };
  control.addTo(map);

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    control.remove();
    layer.remove();
  };
}
