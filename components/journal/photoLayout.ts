// Photo pages for one day (plan §7.6.1): each photo sits with its own note.
// Pure and deterministic: the same photos give the same layout on both phones
// and after a reload. Rows, in photo order:
// - side: a portrait or square photo with its note beside it; the photo side
//   alternates left / right from one side row to the next.
// - wide: a landscape photo with its note below.
// - pair: two portraits in a row when neither has a note (no empty note column).
// Photos of unknown size count as portrait. Tilt stays within ±2.5°.

export interface LayoutPhoto {
  id: string;
  width: number | null;
  height: number | null;
  caption: string;
}

export type Side = 'left' | 'right';

export interface PlacedPhoto {
  id: string;
  shape: 'portrait' | 'landscape';
  /** width / height; 3:4 when the size is unknown. */
  ratio: number;
  /** Degrees, 0.6–2.5 either way. */
  tilt: number;
  tape: boolean;
}

export type PhotoRow =
  | { kind: 'side'; side: Side; photo: PlacedPhoto }
  | { kind: 'wide'; side: Side; photo: PlacedPhoto }
  | { kind: 'pair'; photos: [PlacedPhoto, PlacedPhoto] };

export const MAX_TILT = 2.5;
const MIN_TILT = 0.6;

/** FNV-1a, 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const known = (p: LayoutPhoto) => !!p.width && !!p.height;
export const isPortrait = (p: LayoutPhoto) => !known(p) || p.height! >= 0.9 * p.width!;
const hasNote = (p: LayoutPhoto) => !!p.caption.trim();

function place(p: LayoutPhoto): PlacedPhoto {
  const h = hash(p.id);
  const size = MIN_TILT + (((h >>> 8) % 1000) / 1000) * (MAX_TILT - MIN_TILT);
  const tilt = Math.round((h & 1 ? size : -size) * 10) / 10;
  return {
    id: p.id,
    shape: isPortrait(p) ? 'portrait' : 'landscape',
    ratio: known(p) ? p.width! / p.height! : 3 / 4,
    tilt,
    tape: (h >>> 4) % 4 !== 0, // about three in four
  };
}

export function photoLayout(photos: LayoutPhoto[]): PhotoRow[] {
  const rows: PhotoRow[] = [];
  let side: Side = 'left';
  let lean: Side = 'right';
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const next = photos[i + 1];
    if (!isPortrait(p)) {
      rows.push({ kind: 'wide', side: lean, photo: place(p) });
      lean = lean === 'left' ? 'right' : 'left';
    } else if (!hasNote(p) && next && isPortrait(next) && !hasNote(next)) {
      rows.push({ kind: 'pair', photos: [place(p), place(next)] });
      i++;
    } else {
      rows.push({ kind: 'side', side, photo: place(p) });
      side = side === 'left' ? 'right' : 'left';
    }
  }
  return rows;
}
