// Scrapbook collage (plan §7.6.1). Pure and deterministic: the same photo ids
// and variant give the same layout on both phones and after a reload.
// Units: container width = 100, height = `height`; slot boxes use the same units.
// Rules: tilt within ±3°, each photo covered by others ≤ 10% of its area,
// at most 6 photos placed (the rest are counted in `more`).

export interface CollagePhoto {
  id: string;
  width: number | null;
  height: number | null;
}

export interface CollageSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  z: number;
  polaroid: boolean;
  tape: boolean;
}

export interface CollageLayout {
  height: number;
  slots: CollageSlot[];
  more: number;
}

type Box = { x: number; y: number; w: number; h: number; o: 'L' | 'P' };

const L = (x: number, y: number, w: number): Box => ({ x, y, w, h: (w * 3) / 4, o: 'L' });
const P = (x: number, y: number, w: number): Box => ({ x, y, w, h: (w * 4) / 3, o: 'P' });

/** Templates by photo count; [landscape-led, portrait-led]. */
const TEMPLATES: Record<number, [Box[], Box[]]> = {
  1: [[L(8, 4, 84)], [P(20, 3, 60)]],
  2: [
    [L(4, 3, 58), L(56, 36, 40)],
    [P(4, 3, 50), P(50, 40, 40)],
  ],
  3: [
    [L(3, 3, 60), L(60, 8, 36), L(36, 46, 40)],
    [P(3, 3, 44), P(52, 2, 30), L(42, 44, 40)],
  ],
};

/** 4–6 photos: a diagonal flow; the first n boxes are used. */
const FLOW: Box[] = [L(2, 3, 40), P(41, 8, 24), L(63, 2, 35), P(6, 34, 26), L(30, 42, 38), P(68, 30, 26)];

/** FNV-1a, 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const isPortrait = (p: CollagePhoto) => !!p.width && !!p.height && p.height > p.width;

export function collageLayout(photos: CollagePhoto[], variant = 0): CollageLayout {
  const placed = photos.slice(0, 6);
  const n = placed.length;
  if (!n) return { height: 0, slots: [], more: 0 };
  const seed = hash(placed.map((p) => p.id).join('|'));
  const portraitLed = placed.filter(isPortrait).length * 2 > n;

  let boxes: Box[] = n <= 3 ? TEMPLATES[n][portraitLed ? 1 : 0] : FLOW.slice(0, n);
  // Shuffle layout: mirror on odd variants, rotate slot order by the variant.
  const v = Math.abs(variant | 0);
  if ((seed + v) % 2 === 1 && n > 1) boxes = boxes.map((b) => ({ ...b, x: 100 - b.x - b.w }));
  const order = boxes.map((_, i) => (i + v + (seed % n)) % n);

  // Assign photos to slots in photo order, preferring a slot of the same orientation.
  const free = new Set(order);
  const assignment: Array<{ photo: CollagePhoto; box: Box; slot: number }> = [];
  for (const photo of placed) {
    const want = isPortrait(photo) ? 'P' : 'L';
    const pick = [...free].find((i) => boxes[i].o === want) ?? [...free][0];
    free.delete(pick);
    assignment.push({ photo, box: boxes[pick], slot: pick });
  }

  const slots = assignment.map(({ photo, box, slot }, i) => {
    const r = hash(`${photo.id}:${v}`);
    const rotate = n === 1 ? -1.5 : Math.round((((r % 1000) / 1000) * 6 - 3) * 10) / 10;
    return {
      id: photo.id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotate: Math.max(-3, Math.min(3, rotate)),
      z: i + 1,
      polaroid: n >= 4 && slot === 3,
      tape: n >= 2 && slot === 0,
    };
  });
  const height = Math.ceil(Math.max(...slots.map((s) => s.y + s.h)) + 3);
  return { height, slots, more: Math.max(0, photos.length - 6) };
}

/** Largest share of any photo's area covered by the others (ignores tilt). */
export function maxOverlapShare(layout: CollageLayout): number {
  let worst = 0;
  for (const a of layout.slots) {
    let covered = 0;
    for (const b of layout.slots) {
      if (a === b) continue;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) covered += w * h;
    }
    worst = Math.max(worst, covered / (a.w * a.h));
  }
  return worst;
}
