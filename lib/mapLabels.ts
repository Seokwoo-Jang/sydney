// Permanent map labels (Route stops, Where We Are names) that never hide one
// another (owner, 2026-11-01): when pins overlap, later labels step down (then
// up) by one label height until they are free, so every name stays readable.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 2;
const MAX_STEPS = 8;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * Vertical shift (px) for each label, in priority order: earlier labels keep
 * their place. Down first, then up, staying inside `area` when given. A label
 * with no free slot stays in place; null for labels that were not measured.
 */
export function stackLabels(boxes: Array<Box | null>, area?: Box): Array<number | null> {
  const kept: Box[] = [];
  return boxes.map((b) => {
    if (!b) return null;
    const step = b.h + GAP;
    const shifts = [0, ...Array.from({ length: MAX_STEPS }, (_, i) => (i + 1) * step), ...Array.from({ length: MAX_STEPS }, (_, i) => -(i + 1) * step)];
    // Keep a moved label in view only when its pin's label starts in view (off-screen pins stack freely).
    const inside = (c: Box) => !area || b.y < area.y || b.y + b.h > area.y + area.h || (c.y >= area.y && c.y + c.h <= area.y + area.h);
    const dy = shifts.find((s) => {
      const c = { ...b, y: b.y + s };
      return (s === 0 || inside(c)) && !kept.some((k) => overlaps(c, k));
    });
    kept.push({ ...b, y: b.y + (dy ?? 0) });
    return dy ?? 0;
  });
}

/**
 * Applies stackLabels to Leaflet tooltip elements (priority order) inside `container`.
 * The shift is a margin on top of Leaflet's own, so Leaflet's positioning is untouched.
 * `shiftedClass` marks labels moved away from their pin; `--lead-top` / `--lead-h` give
 * the span between the label's middle and its pin's level, for a line back to the pin.
 */
export function restackLabels(els: Array<HTMLElement | null | undefined>, container: HTMLElement, shiftedClass?: string): void {
  const live = els.filter((e): e is HTMLElement => !!e);
  // Measure every label as if moved (a moved label is wider: it shows its pin number).
  for (const e of live) {
    e.style.marginTop = '';
    e.style.removeProperty('--lead-top');
    e.style.removeProperty('--lead-h');
    if (shiftedClass) e.classList.add(shiftedClass);
  }
  const base = live.map((e) => parseFloat(getComputedStyle(e).marginTop) || 0);
  const a = container.getBoundingClientRect();
  const boxes = live.map((e) => {
    const r = e.getBoundingClientRect();
    return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  });
  stackLabels(boxes, { x: a.left, y: a.top, w: a.width, h: a.height }).forEach((dy, k) => {
    if (dy) {
      live[k].style.marginTop = `${base[k] + dy}px`;
      live[k].style.setProperty('--lead-top', dy > 0 ? `calc(50% - ${dy}px)` : '50%');
      live[k].style.setProperty('--lead-h', `${Math.abs(dy)}px`);
    } else if (shiftedClass) live[k].classList.remove(shiftedClass);
  });
}
