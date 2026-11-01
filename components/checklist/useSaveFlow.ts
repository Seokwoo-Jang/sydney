'use client';
// Save feedback for edit sheets (plan §8.2): "Saved" only after the repository
// returns ok; a version conflict keeps the draft and exposes the latest row.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveState } from '@/components/ui';
import type { SaveResult } from '@/lib/types';

export interface Conflict<T> {
  latest: T | null;
}

export function useSaveFlow<T>() {
  const [state, setState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<Conflict<T> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (write: () => Promise<SaveResult<T>>): Promise<SaveResult<T>> => {
    setState('saving');
    setConflict(null);
    const result = await write();
    if (!alive.current) return result;
    if (result.ok) setState('saved');
    else if (result.reason === 'conflict') {
      setState('dirty'); // the conflict notice explains; the draft is still unsaved
      setConflict({ latest: result.latest });
    } else setState('error');
    return result;
  }, []);

  const markDirty = useCallback(() => setState((s) => (s === 'saving' ? s : 'dirty')), []);
  const reset = useCallback(() => {
    setState('idle');
    setConflict(null);
  }, []);
  const clearConflict = useCallback(() => setConflict(null), []);

  return { state, conflict, run, markDirty, reset, clearConflict, busy: state === 'saving' };
}

/** Who saved first: the same profile on another device, or the partner. */
export function conflictSource(latestUpdatedBy: string | null | undefined, meId: string | null | undefined): 'ownDevice' | 'partner' {
  return latestUpdatedBy && meId && latestUpdatedBy === meId ? 'ownDevice' : 'partner';
}
