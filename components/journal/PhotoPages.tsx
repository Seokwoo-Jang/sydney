'use client';
// Photos of one day with their notes (plan §7.6.1). Rows come from
// photoLayout(); DOM order = photo order. Each photo is printed whole (natural
// ratio, paper border, tape, slight tilt); its note is the figcaption.
import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui';
import type { FileAsset } from '@/lib/types';
import { S } from '@/lib/strings';
import { photoLayout, type PhotoRow, type PlacedPhoto } from './photoLayout';
import { Photo } from './Photo';
import styles from './Journal.module.css';

const SIZES = {
  portrait: '(min-width: 1024px) 320px, (min-width: 768px) 40vw, 72vw',
  landscape: '(min-width: 1024px) 640px, 92vw',
  pair: '(min-width: 1024px) 280px, 46vw',
};

export function PhotoPages({
  photos,
  dayNumber,
  coverId,
  onEdit,
}: {
  photos: FileAsset[];
  dayNumber: number;
  coverId: string | null;
  onEdit: (asset: FileAsset) => void;
}) {
  const rows = photoLayout(photos);
  const byId = new Map(photos.map((p, i) => [p.id, { asset: p, n: i + 1 }]));

  const figure = (placed: PlacedPhoto, sizes: string) => {
    const { asset, n } = byId.get(placed.id)!;
    const note = asset.caption.trim();
    return (
      <figure
        key={placed.id}
        className={styles.entry}
        data-shape={placed.shape}
        style={{ '--tilt': `${placed.tilt}deg`, '--ratio': placed.ratio.toFixed(4) } as CSSProperties}
      >
        <div className={[styles.print, placed.tape ? styles.tape : ''].join(' ')}>
          <Photo
            photo={{ src: asset.url ?? '', thumb: asset.thumbUrl, width: asset.width, height: asset.height }}
            alt={S.journal.photoAlt(dayNumber, n)}
            sizes={sizes}
            className={styles.printImg}
          />
          {asset.id === coverId && <span className={styles.coverTag}>{S.journal.cover}</span>}
          <button
            type="button"
            className={styles.editPhoto}
            aria-label={S.journal.editPhoto(n)}
            title={S.journal.editPhoto(n)}
            data-edit={asset.id}
            onClick={() => onEdit(asset)}
          >
            <span className={styles.editPlate}>
              <Icon name="edit" size={18} />
            </span>
          </button>
        </div>
        {note && <figcaption className={styles.photoNote}>{note}</figcaption>}
      </figure>
    );
  };

  const row = (r: PhotoRow) =>
    r.kind === 'pair' ? (
      <li key={r.photos[0].id} className={styles.row} data-kind="pair">
        {r.photos.map((p) => figure(p, SIZES.pair))}
      </li>
    ) : (
      <li
        key={r.photo.id}
        className={styles.row}
        data-kind={r.kind}
        data-side={r.side}
        data-note={byId.get(r.photo.id)!.asset.caption.trim() ? '' : undefined}
      >
        {figure(r.photo, SIZES[r.photo.shape])}
      </li>
    );

  return (
    <ol role="list" className={styles.story}>
      {rows.map(row)}
    </ol>
  );
}
