// OpenStreetMap place search, only when the user presses "Find on map" (plan §7.2.7).
// One gate for the whole page keeps requests ≥ 1 s apart (Nominatim usage policy).
import { createRateGate, nominatimUrl, parseNominatim, type PlaceCandidate } from './routeLogic';

const gate = createRateGate(1000);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceCandidate[]> {
  await sleep(gate.reserve(), signal);
  const res = await fetch(nominatimUrl(query), { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return parseNominatim(await res.json());
}
