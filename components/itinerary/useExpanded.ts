'use client';
// Expanded rows: local UI state per browser session, restored by item id across
// day switches and reloads (plan §7.2.4). Never synced to the other person.
import { useCallback, useState } from 'react';

const KEY = 'sydney.itinerary.expanded';

function read(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Storage blocked: state lasts for this page only.
  }
}

export interface ExpandedApi {
  isOpen(id: string): boolean;
  toggle(id: string): void;
  open(id: string): void;
}

export function useExpanded(): ExpandedApi {
  // Sections render only after the client session check, so sessionStorage is available here.
  const [ids, setIds] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : read()));
  const update = useCallback((fn: (next: Set<string>) => void) => {
    setIds((prev) => {
      const next = new Set(prev);
      fn(next);
      write(next);
      return next;
    });
  }, []);
  const isOpen = useCallback((id: string) => ids.has(id), [ids]);
  const toggle = useCallback((id: string) => update((s) => (s.has(id) ? s.delete(id) : s.add(id))), [update]);
  const open = useCallback((id: string) => update((s) => void s.add(id)), [update]);
  return { isOpen, toggle, open };
}
