// URL state (plan §4.5): one root page, state in the query string.
//   ?section=days&day=2030-12-29   ?section=ready&view=bookings&item=<id>   ?section=prelude
//   ?section=ready&view=task&mark=<id>  (a Library tag: show that row with a ring, no sheet)
// Clicks push history; scroll-spy and programmatic changes replace it.
// Only the search string changes, so the basePath in location.pathname is kept.

import { useCallback, useMemo, useSyncExternalStore } from 'react';

export const SECTION_KEYS = ['ready', 'days', 'wallet', 'links', 'journal', 'prelude'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
/** Sections rendered on the board, in TOC order. `overview` has no URL key. */
export type BoardSectionKey = 'overview' | SectionKey;

export interface UrlState {
  section: SectionKey | null;
  day: string | null; // 'YYYY-MM-DD'
  view: string | null; // section-specific sub-view, e.g. 'bookings'
  item: string | null; // record id whose detail panel/sheet is open
  mark: string | null; // record id to show with a ring for a moment (Library tags)
}

/** `undefined` keeps the current value, `null` removes the param. */
export type UrlPatch = Partial<{ [K in keyof UrlState]: UrlState[K] | null }>;

export type NavKind = 'initial' | 'push' | 'replace' | 'pop';

const KEYS: Array<keyof UrlState> = ['section', 'day', 'view', 'item', 'mark'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isSectionKey = (v: unknown): v is SectionKey =>
  typeof v === 'string' && (SECTION_KEYS as readonly string[]).includes(v);

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const section = p.get('section');
  const day = p.get('day');
  return {
    section: isSectionKey(section) ? section : null,
    day: day && DATE_RE.test(day) ? day : null,
    view: p.get('view') || null,
    item: p.get('item') || null,
    mark: p.get('mark') || null,
  };
}

/** Applies a patch to a search string; unknown params (e.g. dev `now`) are kept. */
export function patchSearch(search: string, patch: UrlPatch): string {
  const p = new URLSearchParams(search);
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null || v === '') p.delete(key);
    else p.set(key, v);
  }
  // Stable order: known keys first, in KEYS order.
  const ordered = new URLSearchParams();
  for (const key of KEYS) {
    const v = p.get(key);
    if (v != null) ordered.set(key, v);
  }
  p.forEach((v, k) => {
    if (!(KEYS as string[]).includes(k)) ordered.append(k, v);
  });
  const s = ordered.toString();
  return s ? `?${s}` : '';
}

/** Relative href for links (`?section=days`); resolves against the current path, so basePath-safe. */
export function hrefFor(patch: UrlPatch, search = typeof window === 'undefined' ? '' : window.location.search): string {
  return patchSearch(search, patch) || '?';
}

// ── store over history ─────────────────────────────────────────
const EVENT = 'sydney:urlchange';
let lastNav: { kind: NavKind; seq: number } = { kind: 'initial', seq: 0 };

let popInstalled = false;
function installPopListener(): void {
  if (popInstalled) return;
  popInstalled = true;
  window.addEventListener('popstate', () => {
    lastNav = { kind: 'pop', seq: lastNav.seq + 1 };
    window.dispatchEvent(new Event(EVENT));
  });
}

function subscribe(cb: () => void): () => void {
  installPopListener();
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

const getSearch = () => window.location.search;
const getServerSearch = () => '';
const getNav = () => lastNav;
const getServerNav = () => lastNav;

export function navigate(patch: UrlPatch, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const next = patchSearch(window.location.search, patch);
  if (next === window.location.search) return;
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  if (mode === 'push') window.history.pushState(window.history.state, '', url);
  else window.history.replaceState(window.history.state, '', url);
  lastNav = { kind: mode, seq: lastNav.seq + 1 };
  window.dispatchEvent(new Event(EVENT));
}

export interface UrlStateApi {
  state: UrlState;
  /** Kind + sequence number of the navigation that produced `state`. */
  nav: { kind: NavKind; seq: number };
  /** User click: adds a history entry. */
  push: (patch: UrlPatch) => void;
  /** Scroll-spy / programmatic: replaces the current entry. */
  replace: (patch: UrlPatch) => void;
}

export function useUrlState(): UrlStateApi {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const nav = useSyncExternalStore(subscribe, getNav, getServerNav);
  const state = useMemo(() => parseUrlState(search), [search]);
  const push = useCallback((patch: UrlPatch) => navigate(patch, 'push'), []);
  const replace = useCallback((patch: UrlPatch) => navigate(patch, 'replace'), []);
  return { state, nav, push, replace };
}

// ── basePath-aware public assets ───────────────────────────────
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** '/images/x.webp' → '/sydney/images/x.webp' (static export does not rewrite raw URLs). */
export function publicAsset(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${clean}`;
}

/** Default Nine Notes photo for a day (plan §6.4), 720×960 and 240×320 thumb. */
export function defaultDayPhoto(dayNumber: number): { src: string; thumb: string; width: number; height: number } {
  return {
    src: publicAsset(`/images/nine-notes/day-${dayNumber}.webp`),
    thumb: publicAsset(`/images/nine-notes/day-${dayNumber}-thumb.webp`),
    width: 720,
    height: 960,
  };
}

export const PIANO_IMAGE = { path: '/images/prelude/grand-piano.webp', width: 960, height: 480 } as const;
