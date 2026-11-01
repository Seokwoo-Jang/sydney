'use client';
// The ONE media-query hook that switches the shell between board and tabs
// (CLAUDE.md §4 responsive table). Everything else adapts with CSS.
import { useSyncExternalStore } from 'react';

export type LayoutMode = 'wide' | 'board' | 'tabs';
/** What sections receive: PC board or mobile/tablet tabs. */
export type SectionLayout = 'board' | 'tabs';

const WIDE = '(min-width: 1440px)';
const BOARD = '(min-width: 1024px)';

function read(): LayoutMode {
  if (window.matchMedia(WIDE).matches) return 'wide';
  if (window.matchMedia(BOARD).matches) return 'board';
  return 'tabs';
}

function subscribe(cb: () => void): () => void {
  const lists = [window.matchMedia(WIDE), window.matchMedia(BOARD)];
  lists.forEach((m) => m.addEventListener('change', cb));
  return () => lists.forEach((m) => m.removeEventListener('change', cb));
}

/** `null` during static render; the shell renders only after the session check, so it is set by then. */
export function useLayoutMode(): LayoutMode | null {
  return useSyncExternalStore<LayoutMode | null>(subscribe, read, () => null);
}

export const sectionLayout = (mode: LayoutMode): SectionLayout => (mode === 'tabs' ? 'tabs' : 'board');
