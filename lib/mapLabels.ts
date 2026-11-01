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

// ── names around their pins (Route, owner 2026-11-01) ─────────────

export interface Pt {
  x: number;
  y: number;
}

/** Right, left, above, below, then the four diagonals. */
const AROUND: Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 0.7, y: -0.7 },
  { x: -0.7, y: -0.7 },
  { x: 0.7, y: 0.7 },
  { x: -0.7, y: 0.7 },
];
/** Gap between pin edge and name: beside the pin first, then a little and a lot further out. */
const RINGS = [4, 26, 52];

const inside = (b: Box, a: Box) => b.x >= a.x + 2 && b.y >= a.y + 2 && b.x + b.w <= a.x + a.w - 2 && b.y + b.h <= a.y + a.h - 2;

/**
 * Places each name (priority order) around its pin instead of always to its right: the
 * first spot, closest ring first, that lies inside `area` and clear of the names already
 * placed and of every pin. A name never runs off the map or hides another. `away` marks
 * a name placed beyond the first ring (tie it back to its pin with a line).
 */
export function placeAround(
  labels: Array<{ w: number; h: number; pin: Pt } | null>,
  pins: Pt[],
  area: Box,
  pinR = 14,
): Array<{ x: number; y: number; away: boolean } | null> {
  const kept: Box[] = [];
  const pinBoxes = pins.map((p) => ({ x: p.x - pinR, y: p.y - pinR, w: pinR * 2, h: pinR * 2 }));
  return labels.map((l) => {
    if (!l) return null;
    const spot = (dir: Pt, gap: number): Box => {
      const d = pinR + gap;
      const ax = l.pin.x + dir.x * d;
      const ay = l.pin.y + dir.y * d;
      return { x: dir.x > 0 ? ax : dir.x < 0 ? ax - l.w : ax - l.w / 2, y: dir.y > 0 ? ay : dir.y < 0 ? ay - l.h : ay - l.h / 2, w: l.w, h: l.h };
    };
    let pick: { box: Box; ring: number } | null = null;
    let fallback: { box: Box; ring: number } | null = null;
    for (let ring = 0; ring < RINGS.length && !pick; ring++) {
      for (const dir of AROUND) {
        const box = spot(dir, RINGS[ring]);
        if (!inside(box, area)) continue;
        fallback ??= { box, ring };
        if (kept.some((k) => overlaps(box, k)) || pinBoxes.some((p) => overlaps(box, p))) continue;
        pick = { box, ring };
        break;
      }
    }
    const chosen = pick ?? fallback ?? { box: spot(AROUND[0], RINGS[0]), ring: 0 };
    kept.push(chosen.box);
    return { x: chosen.box.x, y: chosen.box.y, away: chosen.ring > 0 };
  });
}

/**
 * Applies placeAround to Leaflet tooltips (priority order) inside `container`, moving each
 * by margin on top of Leaflet's own positioning. A name placed away from its pin gets
 * `awayClass` and --lx / --ly / --len / --ang: a line from the name's edge to its pin.
 * Names whose pin is out of view keep Leaflet's place.
 */
export function arrangeLabels(
  entries: Array<{ label: HTMLElement | null | undefined; pin: HTMLElement | null | undefined }>,
  container: HTMLElement,
  awayClass?: string,
): void {
  const live = entries.filter((e): e is { label: HTMLElement; pin: HTMLElement } => !!e.label && !!e.pin);
  for (const { label } of live) {
    label.style.marginLeft = '';
    label.style.marginTop = '';
    if (awayClass) label.classList.remove(awayClass);
  }
  const a = container.getBoundingClientRect();
  const area = { x: a.left, y: a.top, w: a.width, h: a.height };
  const centre = (el: Element): Pt => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const pins = [...container.querySelectorAll('.leaflet-marker-icon')].map(centre);
  const measured = live.map(({ label, pin }) => {
    const r = label.getBoundingClientRect();
    const p = centre(pin);
    const inView = p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h;
    return r.width && inView ? { w: r.width, h: r.height, pin: p, rect: r } : null;
  });
  const base = live.map(({ label }) => {
    const cs = getComputedStyle(label);
    return { left: parseFloat(cs.marginLeft) || 0, top: parseFloat(cs.marginTop) || 0 };
  });
  placeAround(measured, pins, area).forEach((spot, k) => {
    const m = measured[k];
    if (!spot || !m) return;
    const { label } = live[k];
    label.style.marginLeft = `${base[k].left + spot.x - m.rect.left}px`;
    label.style.marginTop = `${base[k].top + spot.y - m.rect.top}px`;
    if (!spot.away || !awayClass) return;
    // The line starts at the name's edge nearest the pin and stops at the pin's rim.
    const lx = Math.min(Math.max(m.pin.x - spot.x, 0), m.w);
    const ly = Math.min(Math.max(m.pin.y - spot.y, 0), m.h);
    const vx = m.pin.x - (spot.x + lx);
    const vy = m.pin.y - (spot.y + ly);
    label.classList.add(awayClass);
    label.style.setProperty('--lx', `${lx}px`);
    label.style.setProperty('--ly', `${ly}px`);
    label.style.setProperty('--len', `${Math.max(0, Math.hypot(vx, vy) - 14)}px`);
    label.style.setProperty('--ang', `${Math.atan2(vy, vx)}rad`);
  });
}
