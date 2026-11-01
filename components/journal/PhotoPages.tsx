'use client';
// Photo posts of one day (plan §7.6.1): each post is a photo, its text and the
// circled mark of whoever added it. Rows come from photoLayout(); DOM order =
// photo order. Each photo is printed whole (natural ratio, paper border, tape,
// slight tilt); its text is the figcaption, led by the mark. A post without
// text keeps the mark on the frame corner. Reorder mode lists the posts flat
// with Move up / Move down.
import type { CSSProperties } from 'react';
import { Icon, MemberMarks } from '@/components/ui';
import type { FileAsset, Member } from '@/lib/types';
import { S } from '@/lib/strings';
import { photoLayout, type PhotoRow, type PlacedPhoto } from './photoLayout';
import { Photo } from './Photo';
import styles from './Journal.module.css';

const SIZES = {
  portrait: '(min-width: 1024px) 320px, (min-width: 768px) 40vw, 72vw',
  landscape: '(min-width: 1024px) 640px, 92vw',
  pair: '(min-width: 1024px) 280px, 46vw',
};

const source = (a: FileAsset) => ({ src: a.url ?? '', thumb: a.thumbUrl, width: a.width, height: a.height });

/** The author's circled mark; nothing when the row has no known author. */
function AuthorMark({ author, className }: { author: Member | null; className: string }) {
  if (!author) return null;
  return (
    <span role="img" aria-label={S.journal.addedBy(author.displayName)} className={className}>
      <span aria-hidden="true">
        <MemberMarks who={author.profileKey} size="sm" />
      </span>
    </span>
  );
}

export function PhotoPages({
  photos,
  dayNumber,
  coverId,
  members,
  reordering,
  onEdit,
  onMove,
}: {
  photos: FileAsset[];
  dayNumber: number;
  coverId: string | null;
  members: Member[];
  reordering: boolean;
  onEdit: (asset: FileAsset) => void;
  /** Moves photos[index] one place up (-1) or down (1). */
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const authorOf = (a: FileAsset) => members.find((m) => m.id === a.createdBy) ?? null;

  if (reordering) {
    return (
      <ol role="list" className={styles.reorder}>
        {photos.map((asset, i) => {
          const n = i + 1;
          const text = asset.caption.trim();
          return (
            <li key={asset.id} className={styles.reorderItem}>
              <span className={styles.reorderThumb}>
                <Photo photo={source(asset)} alt={S.journal.photoAlt(dayNumber, n)} sizes="80px" className={styles.reorderImg} />
              </span>
              <span className={styles.reorderBody}>
                <span className={styles.reorderHead}>
                  <AuthorMark author={authorOf(asset)} className={styles.mark} />
                  {asset.id === coverId && <span className={styles.coverInline}>{S.journal.cover}</span>}
                </span>
                {text && <span className={styles.reorderText}>{text}</span>}
              </span>
              <span className={styles.moveButtons}>
                <button
                  type="button"
                  className={styles.move}
                  aria-label={S.journal.moveUp(n)}
                  title={S.journal.moveUp(n)}
                  disabled={i === 0}
                  data-move={`${asset.id}:-1`}
                  onClick={() => onMove(i, -1)}
                >
                  <Icon name="arrow" rotate={270} />
                </button>
                <button
                  type="button"
                  className={styles.move}
                  aria-label={S.journal.moveDown(n)}
                  title={S.journal.moveDown(n)}
                  disabled={i === photos.length - 1}
                  data-move={`${asset.id}:1`}
                  onClick={() => onMove(i, 1)}
                >
                  <Icon name="arrow" rotate={90} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  const rows = photoLayout(photos);
  const byId = new Map(photos.map((p, i) => [p.id, { asset: p, n: i + 1 }]));

  const figure = (placed: PlacedPhoto, sizes: string) => {
    const { asset, n } = byId.get(placed.id)!;
    const text = asset.caption.trim();
    const author = authorOf(asset);
    return (
      <figure
        key={placed.id}
        className={styles.entry}
        data-shape={placed.shape}
        style={{ '--tilt': `${placed.tilt}deg`, '--ratio': placed.ratio.toFixed(4) } as CSSProperties}
      >
        <div className={[styles.print, placed.tape ? styles.tape : ''].join(' ')}>
          <Photo photo={source(asset)} alt={S.journal.photoAlt(dayNumber, n)} sizes={sizes} className={styles.printImg} />
          {asset.id === coverId && <span className={styles.coverTag}>{S.journal.cover}</span>}
          {!text && <AuthorMark author={author} className={styles.cornerMark} />}
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
        {text && (
          <figcaption className={styles.photoNote}>
            <span className={styles.noteHead}>
              <AuthorMark author={author} className={styles.mark} />
            </span>
            {text}
          </figcaption>
        )}
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
