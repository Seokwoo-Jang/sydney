// Where We Are (plan §7.8): location actions + the one geolocation watch per
// page. The watch runs only while (a) the page is visible and (b) the database
// says THIS browser session is the profile's sharing device. Turning sharing on
// elsewhere, off anywhere, leaving or clearing stops it through the same rule.
import { MIN_INTERVAL_MS, shouldSend, type TimedPoint } from '../location';
import type { LiveLocation } from '../types';
import type { LocationFix } from './repository';
import { applyLocation, type LocationDeviceError, type LocationState, type TripStore } from './store';

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: false, maximumAge: 10_000, timeout: 30_000 };
const FIRST_FIX_OPTIONS: PositionOptions = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 };

export interface LocationActions {
  reloadLocations(): Promise<void>;
  /** Turn on, or take over from the profile's other device. Resolves false on failure (see `device.error`). */
  shareLocation(): Promise<boolean>;
  /** Off for the whole profile; the last position stays. */
  stopSharing(): Promise<boolean>;
  /** Deletes the profile's last position. */
  clearLocation(): Promise<boolean>;
}

function geolocation(): Geolocation | null {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null;
}

function readPosition(g: Geolocation, options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => g.getCurrentPosition(resolve, reject, options));
}

function geoError(e: unknown): LocationDeviceError {
  const code = typeof e === 'object' && e && 'code' in e ? (e as GeolocationPositionError).code : 0;
  return code === 1 ? 'denied' : 'unavailable';
}

export function createLocationController(store: TripStore): { actions: LocationActions; start(): () => void } {
  let last: TimedPoint | null = null;

  const setLocation = (fn: (l: LocationState) => LocationState) => store.set((s) => ({ ...s, location: fn(s.location) }));
  const setDevice = (patch: Partial<LocationState['device']>) =>
    setLocation((l) => ({ ...l, device: { ...l.device, ...patch } }));
  const applyMine = (row: LiveLocation | null) => {
    const me = store.get().session.member;
    if (me) setLocation((l) => ({ ...l, list: applyLocation(l.list, me.id, row) }));
  };
  /** Device timestamp → server-corrected instant (the server rejects readings from the future). */
  const toPoint = (p: GeolocationPosition): TimedPoint => ({
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    at: p.timestamp + store.get().time.offsetMs,
  });
  const toFix = (pt: TimedPoint, accuracy: number | null): LocationFix => ({
    lat: pt.lat,
    lng: pt.lng,
    accuracyM: accuracy != null && Number.isFinite(accuracy) ? Math.max(0, accuracy) : null,
    measuredAt: new Date(pt.at).toISOString(),
  });

  async function run(work: () => Promise<void>): Promise<boolean> {
    setDevice({ busy: true, error: null });
    try {
      await work();
      setDevice({ busy: false });
      return true;
    } catch (e) {
      setDevice({ busy: false, error: (e as { geo?: LocationDeviceError }).geo ?? 'failed' });
      return false;
    }
  }

  const actions: LocationActions = {
    async reloadLocations() {
      const s = store.get();
      if (!s.repo || s.session.status !== 'signed_in') return;
      if (s.location.status === 'idle') setLocation((l) => ({ ...l, status: 'loading' }));
      try {
        const snap = await s.repo.loadLocations();
        if (store.get().session.status !== 'signed_in') return;
        setLocation((l) => ({ ...l, status: 'ready', list: snap.locations, mySessionId: snap.mySessionId }));
      } catch {
        setLocation((l) => (l.status === 'ready' ? l : { ...l, status: 'error' }));
      }
    },
    shareLocation: () =>
      run(async () => {
        const repo = store.get().repo;
        const g = geolocation();
        if (!g || !repo) throw { geo: 'unsupported' };
        let pos: GeolocationPosition;
        try {
          pos = await readPosition(g, FIRST_FIX_OPTIONS);
        } catch (e) {
          throw { geo: geoError(e) };
        }
        const point = toPoint(pos);
        const res = await repo.shareLocation(toFix(point, pos.coords.accuracy), true);
        last = point;
        applyMine(res.row);
        // The session id may not be known yet on a fresh entry.
        if (!store.get().location.mySessionId || res.row?.sharingSessionId !== store.get().location.mySessionId) {
          await actions.reloadLocations();
        }
      }),
    stopSharing: () =>
      run(async () => {
        const repo = store.get().repo;
        if (!repo) throw new Error('not ready');
        applyMine(await repo.stopSharing());
      }),
    clearLocation: () =>
      run(async () => {
        const repo = store.get().repo;
        if (!repo) throw new Error('not ready');
        await repo.clearMyLocation();
        applyMine(null);
        last = null;
      }),
  };

  /** Starts the watch controller; returns a stop function. */
  function start(): () => void {
    const g = geolocation();
    if (!g) return () => {};
    let watchId: number | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let sending = false;

    const wanted = (): boolean => {
      const s = store.get();
      const me = s.session.member;
      if (s.session.status !== 'signed_in' || !me || !s.repo) return false;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
      if (s.location.device.error === 'denied') return false;
      const mine = s.location.list.find((l) => l.memberId === me.id);
      return !!mine?.isSharing && !!s.location.mySessionId && mine.sharingSessionId === s.location.mySessionId;
    };

    const onPosition = async (pos: GeolocationPosition) => {
      const repo = store.get().repo;
      const point = toPoint(pos);
      if (!repo || sending || !wanted() || !shouldSend(last, point)) return;
      sending = true;
      try {
        const res = await repo.shareLocation(toFix(point, pos.coords.accuracy), false);
        if (res.status === 'ok') {
          last = point;
          applyMine(res.row);
        } else if (res.status === 'not_sharing_device') {
          applyMine(res.row); // taken over elsewhere or turned off → the watch stops via `wanted()`
        }
      } catch {
        // Transient: the next reading tries again.
      } finally {
        sending = false;
      }
    };

    const onError = (e: GeolocationPositionError) => {
      if (e.code === 1) setDevice({ error: 'denied' });
    };

    const begin = () => {
      watchId = g.watchPosition((p) => void onPosition(p), onError, WATCH_OPTIONS);
      // Standing still produces no new readings on some phones: ask at least every 30 s.
      heartbeat = setInterval(() => {
        const now = Date.now() + store.get().time.offsetMs;
        if (!last || now - last.at >= MIN_INTERVAL_MS) g.getCurrentPosition((p) => void onPosition(p), onError, WATCH_OPTIONS);
      }, MIN_INTERVAL_MS);
      setDevice({ watching: true });
    };
    const end = () => {
      if (watchId !== null) g.clearWatch(watchId);
      if (heartbeat) clearInterval(heartbeat);
      watchId = null;
      heartbeat = null;
      if (store.get().location.device.watching) setDevice({ watching: false });
    };
    const sync = () => {
      const want = wanted();
      if (want && watchId === null) begin();
      else if (!want && watchId !== null) end();
    };

    const unsubscribe = store.subscribe(sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', sync);
      end();
      last = null;
    };
  }

  return { actions, start };
}
