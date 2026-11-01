// Wide Day cover for the short PC cover (220px) and the compact tab covers.
// The source is a 3:2 close-up, so a wide box can show the whole Opera House
// (sail tops to the harbour wall with the gulls) only at a fraction of its
// width. This keeps that part of the photo untouched on the right and extends
// the sky / shoreline / water to the left from the photo's own left-edge
// colours, feathered into the photo. The left side sits under the text overlay.
//
//   node scripts/make-wide-cover.mjs [source.jpg]
import sharp from 'sharp';

const SRC = process.argv[2] ?? '../docs/references/sydney-opera-house-day.jpg';
const OUT = 'public/images/cover/day-wide';
const H = 560; // ~2.5x the 220px cover
const W = 2920; // wider than any cover box (≈5.2:1), so it is always fitted by height
const CROP = { top: 0.035, bottom: 0.9 }; // sail tops … gulls on the harbour wall
const SAMPLE = 0.05; // left-edge band the extension colours come from
const FEATHER = 0.14; // photo fade-in, as a share of the photo width

const meta = await sharp(SRC).metadata();
const top = Math.round(meta.height * CROP.top);
const photo = await sharp(SRC)
  .extract({ left: 0, top, width: meta.width, height: Math.round(meta.height * CROP.bottom) - top })
  .resize({ height: H })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const pw = photo.info.width;
const px = photo.data;
const E = W - pw;

// Clean sky → haze → water gradient from the photo's own left-edge colours.
// Rows are in the cropped photo: shoreline buildings sit at ~63–80%, so they
// are bridged by a light haze instead of being smeared across the extension.
const band = Math.max(1, Math.round(pw * SAMPLE));
const mean = (from, to) => {
  const c = [0, 0, 0];
  let n = 0;
  for (let y = Math.round(H * from); y < Math.round(H * to); y++)
    for (let x = 0; x < band; x++, n++) for (let k = 0; k < 3; k++) c[k] += px[(y * pw + x) * 3 + k];
  return c.map((v) => v / n);
};
const mix = (p, q, t) => p.map((v, k) => v + (q[k] - v) * t);
const STOPS = [
  [0, mean(0, 0.08)], // sky, top
  [0.4, mean(0.08, 0.16)], // sky
  [0.62, mix(mean(0.52, 0.6), [255, 253, 249], 0.35)], // haze at the horizon
  [0.8, mean(0.82, 0.86)], // water
  [1, mean(0.94, 1)], // water, bottom
];
const edge = Array.from({ length: H }, (_, y) => {
  const t = y / (H - 1);
  const i = Math.max(0, STOPS.findIndex(([at]) => at >= t) - 1);
  const [a0, c0] = STOPS[i];
  const [a1, c1] = STOPS[Math.min(STOPS.length - 1, i + 1)];
  const u = a1 === a0 ? 0 : (t - a0) / (a1 - a0);
  return mix(c0, c1, u * u * (3 - 2 * u));
});

const out = Buffer.alloc(W * H * 3);
const feather = Math.round(pw * FEATHER);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    if (x < E) {
      for (let k = 0; k < 3; k++) out[o + k] = edge[y][k];
      continue;
    }
    const a = Math.min(1, (x - E) / feather);
    const t = a * a * (3 - 2 * a); // smoothstep
    const p = (y * pw + (x - E)) * 3;
    for (let k = 0; k < 3; k++) out[o + k] = edge[y][k] * (1 - t) + px[p + k] * t;
  }
}

const img = sharp(out, { raw: { width: W, height: H, channels: 3 } });
await img.clone().webp({ quality: 82 }).toFile(`${OUT}.webp`);
await img.clone().avif({ quality: 55 }).toFile(`${OUT}.avif`);
console.log(`${OUT}.{webp,avif} ${W}x${H}, photo ${pw}px wide on the right`);
