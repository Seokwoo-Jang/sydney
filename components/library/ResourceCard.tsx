'use client';
// Link card (plan §7.7): title, host, note, linked plans; the card opens the
// detail, "Open website" opens a new tab. No previews are fetched.
import { Badge, Button, ButtonLink } from '@/components/ui';
import type { Resource } from '@/lib/types';
import { S } from '@/lib/strings';
import { hostOf } from './libraryLogic';
import styles from './Library.module.css';

export interface LinkTag {
  id: string;
  label: string;
  onClick: () => void;
}

export function ResourceCard({
  resource,
  tags,
  onOpen,
  onTogglePin,
}: {
  resource: Resource;
  tags: LinkTag[];
  onOpen: (r: Resource) => void;
  onTogglePin: (r: Resource) => void;
}) {
  const host = hostOf(resource.url);
  const pinned = resource.pinnedOrder != null;
  return (
    <article className={[styles.card, pinned ? styles.cardPinned : ''].join(' ')}>
      <button type="button" className={styles.cardMain} onClick={() => onOpen(resource)}>
        <span className={styles.ico} aria-hidden="true">
          {host.charAt(0).toUpperCase()}
        </span>
        <span className={styles.cardText}>
          <span className={styles.cardTitle}>{resource.title}</span>
          <span className={styles.host}>
            {host}
            {pinned && (
              <Badge tone="soft" className={styles.pinBadge}>
                {S.library.pinned}
              </Badge>
            )}
          </span>
          {resource.note && <span className={styles.note}>{resource.note}</span>}
        </span>
      </button>
      {tags.length > 0 && (
        <ul className={styles.tags} aria-label={S.library.linkedTo}>
          {tags.map((t) => (
            <li key={t.id}>
              <button type="button" className={styles.tag} onClick={t.onClick}>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.cardActions}>
        <ButtonLink href={resource.url} external size="sm" variant="link" iconEnd="external">
          {S.actions.openWebsite}
          <span className="sr-only">
            {' '}
            · {resource.title} ({S.ui.externalLink})
          </span>
        </ButtonLink>
        <Button variant="ghost" size="sm" onClick={() => onTogglePin(resource)}>
          {pinned ? S.actions.unpin : S.actions.pin}
          <span className="sr-only"> · {resource.title}</span>
        </Button>
      </div>
    </article>
  );
}
