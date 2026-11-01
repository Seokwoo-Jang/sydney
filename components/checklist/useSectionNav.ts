'use client';
// URL sync for a section's sub-view and open detail (plan §4.5), shared by the
// Checklist, Budget, Library and Journal sections.
// - Local state is the source of truth for what is open; the URL mirrors it.
// - URL `view`/`item` are read only while `section` is this section (the
//   scroll-spy rewrites `section` but keeps other params).
// - Opening from the board when the scroll-spy points at a neighbouring section
//   first records this section with `replace`, then pushes the click, so the
//   shell does not scroll the page behind the sheet.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShellNav } from '@/components/shell/ShellNav';
import { useUrlState, type SectionKey, type UrlPatch } from '@/lib/url';

export function useSectionNav<V extends string>(section: SectionKey, views: readonly V[], defaultView: V) {
  const { state, nav, push, replace } = useUrlState();
  const { layout } = useShellNav();
  const mine = state.section === section;
  const urlView = mine && state.view && (views as readonly string[]).includes(state.view) ? (state.view as V) : null;
  const urlItem = mine ? state.item : null;

  const [view, setViewState] = useState<V>(urlView ?? defaultView);
  const [item, setItem] = useState<string | null>(urlItem);
  const pending = useRef(false);

  // URL → local (deep links, back/forward). Only while the URL points here.
  useEffect(() => {
    if (!mine || pending.current) return;
    if (urlView) setViewState(urlView);
    setItem(urlItem);
  }, [mine, urlView, urlItem, nav.seq]);

  const go = useCallback(
    (patch: Omit<UrlPatch, 'section'>) => {
      if (mine) {
        push({ section, ...patch });
        return;
      }
      if (layout !== 'board') return; // mobile landing: keep it local, no layout jump
      pending.current = true;
      replace({ section });
      requestAnimationFrame(() => {
        pending.current = false;
        push({ section, ...patch });
      });
    },
    [mine, layout, section, push, replace],
  );

  const setView = useCallback(
    (v: V) => {
      setViewState(v);
      go({ view: v, item: null });
    },
    [go],
  );

  const openItem = useCallback(
    (id: string, extra: Omit<UrlPatch, 'section' | 'item'> = {}) => {
      setItem(id);
      go({ ...extra, item: id });
    },
    [go],
  );

  const closeItem = useCallback(() => {
    setItem(null);
    if (mine && state.item) replace({ item: null });
  }, [mine, state.item, replace]);

  return { view, setView, item, openItem, closeItem, layout };
}
