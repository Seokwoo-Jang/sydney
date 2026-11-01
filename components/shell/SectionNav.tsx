'use client';
// PC TOC (≥1440), sticky section links (1024–1439), bottom tabs (≤1023),
// and the mobile Itinerary sub-switch. All are anchor links that push history.
import { Icon, SegmentedControl } from '@/components/ui';
import { S } from '@/lib/strings';
import { hrefFor, type BoardSectionKey, type SectionKey } from '@/lib/url';
import { BOARD_ORDER, TAB_ICON, TAB_ORDER, menuLabel, type TabKey } from './sections';
import styles from './SectionNav.module.css';

interface BoardNavProps {
  active: BoardSectionKey;
  onNavigate: (key: BoardSectionKey) => void;
  /** Opens How to Use (a button after the section links, not a section). */
  onGuide: () => void;
}

function hrefOf(key: BoardSectionKey) {
  return hrefFor({ section: key === 'overview' ? null : key, view: null, item: null });
}

function BoardLinks({ active, onNavigate, onGuide, variant }: BoardNavProps & { variant: 'toc' | 'links' }) {
  return (
    <ul role="list" className={variant === 'toc' ? styles.tocList : styles.linksList}>
      {BOARD_ORDER.map((key) => (
        <li key={key}>
          <a
            href={hrefOf(key)}
            className={[styles.link, key === 'prelude' ? styles.prelude : ''].join(' ')}
            aria-current={key === active ? 'location' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(key);
            }}
          >
            {key === 'prelude' && <Icon name="note" size={14} className={styles.noteMark} />}
            {menuLabel(key)}
          </a>
        </li>
      ))}
      <li className={styles.guideItem}>
        <button type="button" className={styles.guide} onClick={onGuide}>
          <Icon name="help" size={16} />
          {S.guide.title}
        </button>
      </li>
    </ul>
  );
}

/** ≥1440: sticky left table of contents (~160px). */
export function Toc(props: BoardNavProps) {
  return (
    <nav className={styles.toc} aria-label={S.nav.toc}>
      <BoardLinks {...props} variant="toc" />
    </nav>
  );
}

/** 1024–1439: sticky top section links. */
export function SectionLinks(props: BoardNavProps) {
  return (
    <nav className={styles.links} aria-label={S.nav.toc}>
      <BoardLinks {...props} variant="links" />
    </nav>
  );
}

/** ≤1023: five equal tabs, icon + label, safe-area aware. */
export function BottomNav({ active, onSelect }: { active: TabKey | null; onSelect: (tab: TabKey) => void }) {
  return (
    <nav className={styles.bottom} aria-label={S.nav.tabs}>
      <ul role="list" className={styles.bottomList}>
        {TAB_ORDER.map((tab) => (
          <li key={tab}>
            <a
              href={hrefFor({ section: tab, view: null, item: null })}
              className={styles.tab}
              aria-current={tab === active ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onSelect(tab);
              }}
            >
              <span className={styles.tabIcon}>
                <Icon name={TAB_ICON[tab]} size={22} />
              </span>
              <span className={styles.tabLabel}>{menuLabel(tab)}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Mobile Itinerary: Day by Day / Amy's Prelude (dot when today has a Planned activity). */
export function ItinerarySubnav({
  value,
  onChange,
  preludeDot,
}: {
  value: Extract<SectionKey, 'days' | 'prelude'>;
  onChange: (v: Extract<SectionKey, 'days' | 'prelude'>) => void;
  preludeDot: boolean;
}) {
  return (
    <SegmentedControl
      className={styles.subnav}
      label={S.nav.itineraryViews}
      fill
      value={value}
      onChange={onChange}
      options={[
        { value: 'days', label: S.nav.dayByDay },
        { value: 'prelude', label: S.sections.prelude.menu, dot: preludeDot, dotLabel: S.nav.preludeHasPlanned },
      ]}
    />
  );
}
