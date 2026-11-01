// Moving a journal photo one place up or down (plan §7.6.1). The photo swaps
// sortOrder values with its neighbour. Photos sharing a value would not move
// on a swap, so the day is first renumbered 10, 20, 30… in its current order.
// Pure: returns the writes in the order to send them. Each saved prefix of the
// renumber keeps the shown order, so a write that fails part way moves nothing
// but the pair; the two swap writes come last. While the writes go out one by
// one, withWrites() shows the final order instead of each step.

export interface OrderedPhoto {
  id: string;
  sortOrder: number;
}

export interface OrderWrite {
  id: string;
  sortOrder: number;
}

/**
 * `photos` in display order; `dir` -1 = up, 1 = down. Empty when the photo can't move.
 * A renumbered pair is written twice: send each write with the version the previous one returned.
 */
export function moveWrites(photos: OrderedPhoto[], index: number, dir: -1 | 1): OrderWrite[] {
  const other = index + dir;
  if (index < 0 || other < 0 || index >= photos.length || other >= photos.length) return [];
  const distinct = new Set(photos.map((p) => p.sortOrder)).size === photos.length;
  const value = distinct ? photos.map((p) => p.sortOrder) : photos.map((_, i) => (i + 1) * 10);
  const [hi, lo] = index < other ? [index, other] : [other, index];
  return [
    ...(distinct ? [] : renumberWrites(photos)),
    { id: photos[hi].id, sortOrder: value[lo] },
    { id: photos[lo].id, sortOrder: value[hi] },
  ];
}

/**
 * 10, 20, 30… in display order, changed rows only. Rows going up are written
 * from the bottom, then rows going down from the top: every row written lands
 * strictly between its neighbours' current values, so no prefix reorders the list.
 */
function renumberWrites(photos: OrderedPhoto[]): OrderWrite[] {
  const rows = photos.map((p, i) => ({ id: p.id, from: p.sortOrder, sortOrder: (i + 1) * 10 }));
  const up = rows.filter((r) => r.sortOrder > r.from).reverse();
  const down = rows.filter((r) => r.sortOrder < r.from);
  return [...up, ...down].map(({ id, sortOrder }) => ({ id, sortOrder }));
}

/** The order once `writes` have all landed (the last write per row wins), whichever already has. Ties keep the given order. */
export function withWrites<T extends OrderedPhoto>(photos: T[], writes: OrderWrite[]): T[] {
  const to = new Map(writes.map((w) => [w.id, w.sortOrder]));
  return photos
    .map((p, i) => ({ p, i, order: to.get(p.id) ?? p.sortOrder }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((x) => x.p);
}
