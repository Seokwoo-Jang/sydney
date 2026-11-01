// Home-screen icons (plan §11.3): a few Opera House sail lines in Ink on Paper.
// Paths only, no text, so the result does not depend on installed fonts.
//
//   node scripts/make-icons.mjs   → public/icons/*.png
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

const PAPER = '#F7F4EE';
const INK = '#172F3B';
const BRASS = '#A98248';

/** `inset` shrinks the drawing toward the centre (maskable icons keep a safe zone). */
const svg = (inset) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${PAPER}"/>
  <g transform="translate(256 256) scale(${1 - inset}) translate(-256 -256)">
    <g fill="${INK}">
      <path d="M118 340 C 140 254, 206 184, 304 160 C 278 222, 266 284, 264 340 Z"/>
      <path d="M244 340 C 268 272, 324 222, 396 204 C 372 252, 362 298, 360 340 Z"/>
      <path d="M346 340 C 358 304, 380 280, 412 270 C 400 294, 396 318, 396 340 Z"/>
    </g>
    <line x1="98" y1="360" x2="420" y2="360" stroke="${BRASS}" stroke-width="14" stroke-linecap="round"/>
  </g>
</svg>`;

const jobs = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['maskable-512.png', 512, 0.2],
  ['apple-touch-icon.png', 180, 0.08],
  ['favicon-32.png', 32, 0],
];
for (const [name, size, inset] of jobs) {
  await sharp(Buffer.from(svg(inset))).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  console.log(name);
}
