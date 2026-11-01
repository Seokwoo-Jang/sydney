import type { ReactNode } from 'react';
import type { ProfileKey, Participants } from '@/lib/types';
import { S } from '@/lib/strings';
import styles from './Badge.module.css';

export type BadgeTone =
  | 'today'
  | 'now'
  | 'soft'
  | 'brass'
  | 'neutral'
  | 'example'
  | 'statusIdea'
  | 'statusPlanned'
  | 'statusFixed'
  | 'statusDone';

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={[styles.badge, styles[tone], className ?? ''].join(' ')}>{children}</span>;
}

/** Small marker for rows with isExample=true. */
export function ExampleMark({ className }: { className?: string }) {
  return (
    <span className={[styles.badge, styles.example, className ?? ''].join(' ')} title={S.data.exampleLabel}>
      {S.data.example}
    </span>
  );
}

const INITIAL: Record<ProfileKey, string> = { eren: 'E', amy: 'A' };

/** E / A member markers (Harbour Blue / Brass). `together` shows both. */
export function MemberMarks({ who, size = 'md' }: { who: Participants; size?: 'sm' | 'md' }) {
  const keys: ProfileKey[] = who === 'together' ? ['eren', 'amy'] : [who];
  return (
    <span className={[styles.members, styles[size]].join(' ')} role="img" aria-label={S.people.participants[who]}>
      {keys.map((k) => (
        <i key={k} className={styles[k]} aria-hidden="true">
          {INITIAL[k]}
        </i>
      ))}
    </span>
  );
}
