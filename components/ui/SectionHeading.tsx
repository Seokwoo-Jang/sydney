import type { ReactNode } from 'react';
import type { SectionLayout } from '@/lib/hooks/useLayoutMode';
import styles from './SectionHeading.module.css';

export interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  intro?: string;
  /** In `tabs` the compact cover shows the title, so the heading is screen-reader only. */
  layout: SectionLayout;
  /** Right-aligned controls (segmented views, filters). Stay visible in tabs. */
  actions?: ReactNode;
  /** Heading id for aria-labelledby on the section root. */
  id?: string;
  tone?: 'default' | 'brass';
}

export function SectionHeading({ eyebrow, title, intro, layout, actions, id, tone = 'default' }: SectionHeadingProps) {
  const hidden = layout === 'tabs';
  return (
    <div className={[styles.head, hidden ? styles.tabs : '', tone === 'brass' ? styles.brass : ''].join(' ')}>
      <div className={hidden ? 'sr-only' : styles.text}>
        <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {intro && <p className={styles.intro}>{intro}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
