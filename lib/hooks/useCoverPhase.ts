'use client';
// Cover phase from server-corrected Sydney time (plan §6.1): re-checked every
// 30s and on visibilitychange (useServerNow does both).
import { useMemo } from 'react';
import { coverPhase, formatSydneyClock, nextCoverBoundary, nextCoverPhase, type CoverPhase } from '../time/cover';
import { useServerNow } from '../data/hooks';

const PRELOAD_LEAD_MS = 10 * 60 * 1000;

export interface CoverPhaseState {
  /** null in static HTML → Paper placeholder. */
  phase: CoverPhase | null;
  /** Phase to preload during the 10 minutes before the next boundary. */
  preload: CoverPhase | null;
  /** '7:42 pm' */
  clock: string | null;
}

export function useCoverPhase(): CoverPhaseState {
  const now = useServerNow(30_000);
  return useMemo(() => {
    if (!now) return { phase: null, preload: null, clock: null };
    const phase = coverPhase(now);
    const lead = nextCoverBoundary(now).getTime() - now.getTime();
    return {
      phase,
      preload: lead <= PRELOAD_LEAD_MS ? nextCoverPhase(now) : null,
      clock: formatSydneyClock(now),
    };
  }, [now]);
}
