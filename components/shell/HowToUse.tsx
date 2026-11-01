'use client';
// How to Use: one plain line per section, in TOC order. A centred card on PC
// (from the TOC / section links), a bottom sheet on phones (from the bottom of
// the main screen).
import { Icon, Sheet, type IconName } from '@/components/ui';
import { S } from '@/lib/strings';
import type { BoardSectionKey } from '@/lib/url';
import { BOARD_ORDER, TAB_ICON, menuLabel } from './sections';
import styles from './HowToUse.module.css';

const ICON: Record<BoardSectionKey, IconName> = { ...TAB_ICON, overview: 'clock', prelude: 'note' };

export function HowToUseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={S.guide.title} description={S.guide.intro} size="center">
      <ol role="list" className={styles.list}>
        {BOARD_ORDER.map((key) => (
          <li key={key} className={styles.item} data-prelude={key === 'prelude' || undefined}>
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
      <p className={styles.note}>{S.guide.note}</p>
    </Sheet>
  );
}

/** Phones: the quiet card at the bottom of the main screen that opens the guide. */
export function HowToUseCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={styles.cardIcon} aria-hidden="true">
        <Icon name="note" size={18} />
      </span>
      <span className={styles.cardText}>
        <b className={styles.cardTitle}>{S.guide.title}</b>
        <span className={styles.cardSub}>{S.guide.cardSub}</span>
      </span>
      <Icon name="arrow" size={18} className={styles.cardArrow} />
    </button>
  );
}
