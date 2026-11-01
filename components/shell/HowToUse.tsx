'use client';
// How to Use: one plain line per section. PC: a centred card from the TOC /
// section links, in TOC order. Phones: written out at the bottom of the main
// screen, in the bottom-tab order (Amy's Prelude sits under Itinerary there).
import { Icon, Sheet, type IconName } from '@/components/ui';
import { S } from '@/lib/strings';
import type { BoardSectionKey } from '@/lib/url';
import { BOARD_ORDER, TAB_ICON, menuLabel } from './sections';
import styles from './HowToUse.module.css';

const ICON: Record<BoardSectionKey, IconName> = { ...TAB_ICON, overview: 'clock', prelude: 'note' };

/** Phones: the bottom tabs' order, with Amy's Prelude inside Itinerary. No Overview (this is it). */
const MOBILE_ORDER: BoardSectionKey[] = ['ready', 'days', 'prelude', 'wallet', 'links', 'journal'];

function GuideList({ order, nested }: { order: BoardSectionKey[]; nested?: boolean }) {
  return (
    <ol role="list" className={styles.list}>
      {order.map((key) => (
        <li
          key={key}
          className={styles.item}
          data-prelude={key === 'prelude' || undefined}
          data-nested={(nested && key === 'prelude') || undefined}
        >
          <span className={styles.icon} aria-hidden="true">
            <Icon name={ICON[key]} size={18} />
          </span>
          <span className={styles.text}>
            <b className={styles.name}>{menuLabel(key)}</b>
            <span className={styles.line}>{S.guide.lines[key]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** PC: the centred card opened from the TOC / section links. */
export function HowToUseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={S.guide.title} description={S.guide.intro} size="center">
      <GuideList order={BOARD_ORDER} />
      <p className={styles.note}>{S.guide.note}</p>
    </Sheet>
  );
}

/** Phones: written out at the bottom of the main screen. */
export function HowToUseInline() {
  return (
    <section className={styles.inline} aria-labelledby="how-to-use-title">
      <h2 id="how-to-use-title" className={styles.inlineTitle}>
        {S.guide.title}
      </h2>
      <GuideList order={MOBILE_ORDER} nested />
      <p className={styles.note}>{S.guide.note}</p>
    </section>
  );
}
