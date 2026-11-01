'use client';
// Overview pieces: PC short cover + Prelude mini card + summary strip;
// mobile hero + Prelude card + shortcuts; compact per-tab cover.
import { Button, Icon } from '@/components/ui';
import { useTrip } from '@/lib/data';
import { useCountdown } from '@/lib/hooks/useCountdown';
import { S, formatTripRange } from '@/lib/strings';
import { diffDays } from '@/lib/time/zone';
import { PIANO_IMAGE, hrefFor, publicAsset, type SectionKey } from '@/lib/url';
import { countdownText } from './countdownText';
import { useNextPlan, useOverviewSummary, type SummaryCell } from './overviewData';
import { useShellNav } from './ShellNav';
import { TAB_ICON, menuLabel, type TabKey } from './sections';
import { TimeOfDayBackdrop } from './TimeOfDayBackdrop';
import styles from './Overview.module.css';

function useTripFacts() {
  const trip = useTrip();
  if (trip.status !== 'ready') return null;
  const t = trip.data.trip;
  const total = diffDays(t.endDate, t.startDate) + 1;
  return {
    range: formatTripRange(t.startDate, t.endDate),
    days: S.brand.days(total),
    // Day 1 is the overnight flight; the last day flies home.
    nights: S.brand.nightsInSydney(Math.max(0, total - 2)),
  };
}

function Title({ as: Tag = 'h1', className }: { as?: 'h1' | 'p'; className?: string }) {
  return (
    <Tag className={className}>
      {S.brand.titleLead} <em>{S.brand.titleAccent}</em>
    </Tag>
  );
}

/** PC: 180–220px panorama with title, intro and the trip date line. */
export function TripCover() {
  const facts = useTripFacts();
  return (
    <TimeOfDayBackdrop variant="cover" className={styles.cover}>
      <div className={styles.coverInner}>
        <div>
          <p className={`eyebrow ${styles.coverEyebrow}`}>{S.brand.subtitle}</p>
          <Title className={styles.coverTitle} />
          <p className={styles.tagline}>{S.brand.intro}</p>
        </div>
        {facts && (
          <p className={styles.coverFoot}>
            <span>{facts.range}</span>
            <span className={styles.dot} aria-hidden="true" />
            <span>{facts.days}</span>
            <span className={styles.dot} aria-hidden="true" />
            <span>{facts.nights}</span>
          </p>
        )}
      </div>
    </TimeOfDayBackdrop>
  );
}

/** Mobile overview hero (landing). */
export function MobileHero() {
  const facts = useTripFacts();
  const countdown = useCountdown();
  const t = countdown ? countdownText(countdown) : null;
  return (
    <TimeOfDayBackdrop variant="hero" className={styles.hero}>
      <div className={styles.heroInner}>
        <p className={`eyebrow ${styles.coverEyebrow}`}>{S.brand.subtitle}</p>
        <Title className={styles.heroTitle} />
        <p className={styles.heroIntro}>{S.brand.intro}</p>
        {facts && <p className={styles.heroDates}>{facts.range}</p>}
        {t && (
          <p className={styles.heroCountdown}>
            <b>{t.value}</b>
            {t.label && <span>{t.label}</span>}
          </p>
        )}
      </div>
    </TimeOfDayBackdrop>
  );
}

/** Tabs: the cover shrinks to a title area for the active tab. */
export function CompactCover({ tab }: { tab: TabKey }) {
  const s = S.sections[tab];
  return (
    <TimeOfDayBackdrop variant="compact" className={styles.compact}>
      <div className={styles.compactInner}>
        <p className={`eyebrow ${styles.coverEyebrow}`} aria-hidden="true">
          {s.menu}
        </p>
        <div aria-hidden="true">
          <p className={styles.compactTitle}>{s.title}</p>
          <p className={styles.compactIntro}>{s.intro}</p>
        </div>
      </div>
    </TimeOfDayBackdrop>
  );
}

/** PC cover-row card: piano image + Amy's Prelude shortcut. */
export function PreludeMini() {
  const { goToSection } = useShellNav();
  return (
    <a
      href={hrefFor({ section: 'prelude', view: null, item: null })}
      className={styles.preludeMini}
      onClick={(e) => {
        e.preventDefault();
        goToSection('prelude');
      }}
    >
      <img className={styles.preludeImg} src={publicAsset(PIANO_IMAGE.path)} width={PIANO_IMAGE.width} height={PIANO_IMAGE.height} alt="" decoding="async" />
      <span className={styles.preludeShade} aria-hidden="true" />
      <span className={styles.preludeText}>
        <span className={`eyebrow ${styles.preludeEyebrow}`}>{S.sections.prelude.menu}</span>
        <span className={styles.preludeTitle}>{S.sections.prelude.tagline}</span>
        <span className={styles.preludeIntro}>{S.sections.prelude.intro}</span>
      </span>
    </a>
  );
}

/** Mobile overview card under the hero (plan §4.4). */
export function PreludeCard() {
  const { goToSection } = useShellNav();
  const next = useNextPlan();
  return (
    <section className={styles.preludeCard} aria-labelledby="prelude-card-title">
      <img className={styles.preludeThumb} src={publicAsset(PIANO_IMAGE.path)} width={96} height={96} alt="" decoding="async" />
      <div className={styles.preludeCardBody}>
        <p className={`eyebrow ${styles.preludeCardEyebrow}`}>{S.sections.prelude.menu}</p>
        <h2 id="prelude-card-title" className={styles.preludeCardTitle}>
          {S.sections.prelude.tagline}
        </h2>
        {next === undefined ? null : next ? (
          <p className={styles.preludeNext}>
            <span className={styles.preludeNextLabel}>{S.overview.nextPlan}</span>
            <span className={styles.preludeNextTitle}>{next.activity.title}</span>
            {next.when && <span className={styles.preludeNextWhen}>{next.when}</span>}
          </p>
        ) : (
          <p className={styles.preludeNext}>{S.overview.noPlanYet}</p>
        )}
        <Button variant="secondary" size="sm" iconEnd="arrow" onClick={() => goToSection('prelude')}>
          {S.overview.openPrelude}
        </Button>
      </div>
    </section>
  );
}

const STRIP: Array<{ key: Exclude<SectionKey, 'prelude'>; aside: string }> = [
  { key: 'ready', aside: S.sections.ready.short },
  { key: 'days', aside: S.sections.days.short },
  { key: 'wallet', aside: S.sections.wallet.short },
  { key: 'links', aside: S.sections.links.short },
  { key: 'journal', aside: S.sections.journal.short },
];

function StripValue({ cell }: { cell: SummaryCell | null }) {
  if (!cell) {
    return (
      <>
        <span className={[styles.stripValue, styles.bone].join(' ')} aria-hidden="true" />
        <span className={[styles.stripSub, styles.bone, styles.boneSub].join(' ')} aria-hidden="true" />
      </>
    );
  }
  return (
    <>
      <span className={styles.stripValue}>{cell.value}</span>
      <span className={styles.stripSub}>{cell.sub}</span>
    </>
  );
}

/** Five short summaries linking to their sections (PC). */
export function SummaryStrip() {
  const summary = useOverviewSummary();
  const { goToSection } = useShellNav();
  return (
    <nav className={styles.strip} aria-label={S.overview.stripLabel}>
      {STRIP.map(({ key, aside }) => (
        <a
          key={key}
          href={hrefFor({ section: key, view: null, item: null })}
          className={styles.stripCell}
          onClick={(e) => {
            e.preventDefault();
            goToSection(key);
          }}
        >
          <span className={styles.stripLabel}>
            <span>{menuLabel(key)}</span>
            <span className={styles.stripAside}>{aside}</span>
          </span>
          <StripValue cell={summary[key]} />
        </a>
      ))}
    </nav>
  );
}

/** Phone landing: the same five summaries as cards that open each list. */
export function MobileShortcuts() {
  const summary = useOverviewSummary();
  const { goToSection } = useShellNav();
  return (
    <nav className={styles.shortcuts} aria-label={S.overview.stripLabel}>
      {STRIP.map(({ key }) => (
        <a
          key={key}
          href={hrefFor({ section: key, view: null, item: null })}
          className={styles.shortcut}
          onClick={(e) => {
            e.preventDefault();
            goToSection(key);
          }}
        >
          <span className={styles.shortcutHead}>
            <Icon name={TAB_ICON[key]} size={18} className={styles.shortcutIcon} />
            <span className={styles.shortcutLabel}>{menuLabel(key)}</span>
          </span>
          <StripValue cell={summary[key]} />
        </a>
      ))}
    </nav>
  );
}
