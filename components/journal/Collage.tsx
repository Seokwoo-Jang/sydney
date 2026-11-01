'use client';
// Collage for one day (plan §7.6.1). DOM order = photo order (screen readers),
// positions come from collageLayout(); captions double as alt text.
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { FileAsset } from '@/lib/types';
import { S } from '@/lib/strings';
import { collageLayout } from './collageLayout';
import { Photo } from './Photo';
import styles from './Journal.module.css';

export function Collage({ photos, variant, dayNumber }: { photos: FileAsset[]; variant: number; dayNumber: number }) {
  const [all, setAll] = useState(false);
  const layout = collageLayout(photos, variant);
  const byId = new Map(photos.map((p) => [p.id, p]));
  const alt = (p: FileAsset) => p.caption || S.journal.photoAlt(dayNumber);
  const src = (p: FileAsset) => ({
    src: p.url ?? '',
    thumb: p.thumbUrl,
    width: p.width,
    height: p.height,
    focalX: p.focalX,
    focalY: p.focalY,
    zoom: p.zoom,
  });

  return (
    <div className={styles.collageWrap}>
      <ul className={styles.collage} style={{ aspectRatio: `100 / ${layout.height}` }}>
        {layout.slots.map((s) => {
          const p = byId.get(s.id)!;
          return (
            <li
              key={s.id}
              className={[styles.shot, s.polaroid ? styles.polaroid : '', s.tape ? styles.tape : ''].join(' ')}
              style={{
                left: `${s.x}%`,
                top: `${(s.y / layout.height) * 100}%`,
                width: `${s.w}%`,
                height: `${(s.h / layout.height) * 100}%`,
                zIndex: s.z,
                ['--tilt' as string]: `${s.rotate}deg`,
              }}
            >
              <span className={styles.shotFrame}>
                <Photo photo={src(p)} alt={alt(p)} sizes="(min-width: 1024px) 360px, 60vw" className={styles.shotImg} />
              </span>
            </li>
          );
        })}
      </ul>
      {layout.slots.length === 1 && byId.get(layout.slots[0].id)?.caption && (
        <p className={styles.caption} aria-hidden="true">
          {byId.get(layout.slots[0].id)!.caption}
        </p>
      )}
      {layout.more > 0 && (
        <Button variant="link" size="sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? S.journal.showFewer : S.journal.more(layout.more)}
        </Button>
      )}
      {all && (
        <ul className={styles.allPhotos}>
          {photos.map((p) => (
            <li key={p.id}>
              <Photo photo={src(p)} alt={alt(p)} sizes="120px" className={styles.thumb} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
