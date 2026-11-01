'use client';
// One React tree for every viewport (plan §4.5). The layout mode comes from a
// single media-query hook; sections stay mounted across board ↔ tabs so drafts,
// selected day and subscriptions are never duplicated or lost.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import BudgetSection from '@/components/sections/BudgetSection';
import ChecklistSection from '@/components/sections/ChecklistSection';
import ItinerarySection from '@/components/sections/ItinerarySection';
import JournalSection from '@/components/sections/JournalSection';
import LibrarySection from '@/components/sections/LibrarySection';
import OverviewSection from '@/components/sections/OverviewSection';
import PreludeSection from '@/components/sections/PreludeSection';
import type { SectionProps } from '@/components/sections/types';
import { Button, ErrorState } from '@/components/ui';
import { useSession, useTrip, type DataError } from '@/lib/data';
import { sectionLayout, useLayoutMode, type LayoutMode } from '@/lib/hooks/useLayoutMode';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { S } from '@/lib/strings';
import { useUrlState, type BoardSectionKey, type SectionKey } from '@/lib/url';
import { HowToUseSheet } from './HowToUse';
import { CompactCover } from './Overview';
import { usePreludeDotToday } from './overviewData';
import { BottomNav, ItinerarySubnav, SectionLinks, Toc } from './SectionNav';
import { ShellNavContext, type ShellNavApi } from './ShellNav';
import { sectionId, tabOf, type TabKey } from './sections';
import { TimeOfDayBackdrop } from './TimeOfDayBackdrop';
import { Brand, CountdownChip, ProfileMenu } from './TopBar';
import styles from './Shell.module.css';

const SECTION_COMPONENTS: Record<SectionKey, ComponentType<SectionProps>> = {
  days: ItinerarySection,
  prelude: PreludeSection,
  ready: ChecklistSection,
  wallet: BudgetSection,
  journal: JournalSection,
  links: LibrarySection,
};

/** DOM / TOC order of the board slots. */
const SLOTS: SectionKey[] = ['days', 'prelude', 'ready', 'wallet', 'journal', 'links'];

/** Scroll-spy order: row by row, main column before aside (ties go to the main column). */
const SPY_ORDER: BoardSectionKey[] = ['overview', 'days', 'ready', 'wallet', 'prelude', 'journal', 'links'];

function computeActive(): BoardSectionKey {
  const line = window.innerHeight * 0.3;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  let best: { key: BoardSectionKey; top: number } | null = null;
  for (const key of SPY_ORDER) {
    const el = document.getElementById(sectionId(key));
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    const reached = top <= line || (atBottom && top < window.innerHeight);
    if (reached && (!best || top > best.top + 1)) best = { key, top };
  }
  return best?.key ?? 'overview';
}

export function Shell() {
  const mode = useLayoutMode();
  if (!mode) return null;
  return <ShellLayout mode={mode} />;
}

function ShellLayout({ mode }: { mode: LayoutMode }) {
  const layout = sectionLayout(mode);
  const { state: url, nav, push, replace } = useUrlState();
  const trip = useTrip();
  const session = useSession();
  const reduced = useReducedMotion();
  const preludeDot = usePreludeDotToday();

  // Phones open on the landing page (hero, Prelude, shortcuts to each list) with no tab
  // chosen; the logo comes back to it (owner, 2026-11-01).
  const landing = url.section === null;
  const activeTab: TabKey | null = url.section ? tabOf(url.section) : null;
  const itineraryView: 'days' | 'prelude' = url.section === 'prelude' ? 'prelude' : 'days';
  const lastItineraryView = useRef<'days' | 'prelude'>('days');
  if (url.section === 'days' || url.section === 'prelude') lastItineraryView.current = url.section;

  // ── board: scroll-to + scroll-spy ───────────────────────────────
  const [activeBoard, setActiveBoard] = useState<BoardSectionKey>(url.section ?? 'overview');
  const [guideOpen, setGuideOpen] = useState(false);
  const openGuide = useCallback(() => setGuideOpen(true), []);
  const spy = useRef<{ pinned: boolean; baseline: BoardSectionKey | null; ready: boolean }>({
    pinned: false,
    baseline: null,
    ready: false,
  });
  const lastSection = useRef<SectionKey | null | undefined>(undefined);
  const handledSeq = useRef(-1);

  // Baseline = section under the reading line once the programmatic scroll settles.
  const settleTimer = useRef(0);
  const settle = useCallback((ms: number) => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      spy.current.baseline = computeActive();
    }, ms);
  }, []);

  const scrollToKey = useCallback(
    (key: BoardSectionKey) => {
      const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
      const el = document.getElementById(sectionId(key));
      if (key === 'overview' || !el) window.scrollTo({ top: 0, behavior });
      else el.scrollIntoView({ behavior, block: 'start' });
      setActiveBoard(key);
      // Keep the clicked entry highlighted until the user scrolls elsewhere.
      spy.current.pinned = true;
      spy.current.baseline = null;
      settle(reduced ? 50 : 600);
    },
    [reduced, settle],
  );

  useEffect(() => {
    if (layout !== 'board' || handledSeq.current === nav.seq) return;
    if (nav.kind === 'initial' && trip.status === 'loading') return; // wait for real heights
    const prev = lastSection.current;
    handledSeq.current = nav.seq;
    lastSection.current = url.section;
    spy.current.ready = true;
    if (nav.kind === 'replace') return;
    if (nav.kind === 'initial') {
      if (url.section) requestAnimationFrame(() => scrollToKey(url.section!));
      return;
    }
    // push/pop: only when the section changed (opening an item keeps the scroll).
    if (url.section !== prev) scrollToKey(url.section ?? 'overview');
  }, [layout, nav, url.section, trip.status, scrollToKey]);

  useEffect(() => {
    if (layout !== 'board') return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = spy.current;
        const computed = computeActive();
        if (s.pinned) {
          if (s.baseline === null) {
            settle(180); // still moving: wait until the scroll is idle
            return;
          }
          if (computed === s.baseline) return;
          s.pinned = false;
        }
        setActiveBoard((prev) => (prev === computed ? prev : computed));
        if (s.ready) {
          const section = computed === 'overview' ? null : computed;
          lastSection.current = section;
          replace({ section }); // position only: no history entry
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [layout, replace, settle]);

  // ── tabs: remember scroll per tab/sub-view ──────────────────────
  const viewKey = layout === 'tabs' ? `${landing ? 'landing' : 'tab'}:${activeTab}:${activeTab === 'days' ? itineraryView : ''}` : 'board';
  const scrollMemory = useRef(new Map<string, number>());
  const currentViewKey = useRef(viewKey);

  useEffect(() => {
    if (layout !== 'tabs') return;
    const onScroll = () => scrollMemory.current.set(currentViewKey.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [layout]);

  useLayoutEffect(() => {
    if (currentViewKey.current === viewKey) return;
    currentViewKey.current = viewKey;
    if (layout !== 'tabs') return;
    window.scrollTo({ top: scrollMemory.current.get(viewKey) ?? 0, behavior: 'instant' });
  }, [viewKey, layout]);

  // ── navigation API for sections ─────────────────────────────────
  const goToSection = useCallback<ShellNavApi['goToSection']>(
    (section, extra = {}) => {
      const patch = { view: null, item: null, mark: null, ...extra, section };
      if (layout === 'board') {
        lastSection.current = section;
        push(patch);
        scrollToKey(section ?? 'overview');
      } else {
        push(patch);
      }
    },
    [layout, push, scrollToKey],
  );
  const navApi = useMemo<ShellNavApi>(() => ({ layout, goToSection, openGuide }), [layout, goToSection, openGuide]);

  const onSelectTab = (tab: TabKey) => {
    if (tab === activeTab && !landing) {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    goToSection(tab === 'days' ? lastItineraryView.current : tab);
  };

  const dataError: DataError | null = trip.status === 'error' ? trip.error : null;
  const tabs = layout === 'tabs';
  const visibleInTabs = (key: SectionKey) =>
    activeTab !== null && tabOf(key) === activeTab && (activeTab !== 'days' || key === itineraryView);

  return (
    <ShellNavContext.Provider value={navApi}>
      <div className={styles.shell} data-layout={layout} data-mode={mode}>
        <div className={styles.page}>
          <header className={styles.topbar}>
            <Brand onClick={() => goToSection(null, { day: null })} />
            <CountdownChip layout={layout} />
            <ProfileMenu layout={layout} />
          </header>

          {dataError ? (
            <DataErrorView error={dataError} onRetry={trip.retry} onLeave={session.leave} />
          ) : (
            <main id="main" className={styles.main}>
              {tabs && !landing ? <h1 className="sr-only">{S.brand.title}</h1> : null}
              {!tabs || landing ? (
                <div className={styles.overview}>
                  <OverviewSection layout={layout} />
                </div>
              ) : null}
              {tabs && !landing && activeTab ? <CompactCover tab={activeTab} /> : null}
              {tabs && activeTab === 'days' ? (
                <ItinerarySubnav value={itineraryView} onChange={(v) => goToSection(v)} preludeDot={preludeDot} />
              ) : null}
              {mode === 'board' ? <SectionLinks active={activeBoard} onNavigate={(k) => goToSection(k === 'overview' ? null : k)} onGuide={openGuide} /> : null}
              <div className={styles.board}>
                {mode === 'wide' ? <Toc active={activeBoard} onNavigate={(k) => goToSection(k === 'overview' ? null : k)} onGuide={openGuide} /> : null}
                <div className={styles.grid}>
                  {SLOTS.map((key) => {
                    const Section = SECTION_COMPONENTS[key];
                    return (
                      <div key={key} className={styles.slot} data-slot={key} hidden={tabs && !visibleInTabs(key)}>
                        <Section layout={layout} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </main>
          )}
        </div>
        {tabs && !dataError ? <BottomNav active={activeTab} onSelect={onSelectTab} /> : null}
      </div>
      <HowToUseSheet open={guideOpen} onClose={() => setGuideOpen(false)} />
    </ShellNavContext.Provider>
  );
}

function DataErrorView({ error, onRetry, onLeave }: { error: DataError; onRetry: () => void; onLeave: () => Promise<void> }) {
  const notConnected = error.code === 'not_connected';
  return (
    <main id="main" className={styles.errorView}>
      <TimeOfDayBackdrop variant="compact" className={styles.errorCover}>
        <div className={styles.errorCoverInner}>
          <p className="eyebrow">{S.brand.subtitle}</p>
          <h1 className={styles.errorTitle}>{S.brand.title}</h1>
        </div>
      </TimeOfDayBackdrop>
      <ErrorState
        title={notConnected ? S.data.notConnectedTitle : undefined}
        message={notConnected ? S.data.notConnectedBody : S.data.loadFailed}
        onRetry={onRetry}
      >
        <Button variant="ghost" size="sm" onClick={() => void onLeave()}>
          {S.profile.leave}
        </Button>
      </ErrorState>
    </main>
  );
}
