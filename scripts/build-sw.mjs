// Writes public/sw.js from scripts/sw.template.js with a per-build version, so a
// deploy installs a new worker and the app can offer "Refresh" (plan §11.3).
// Runs before `next build` (npm "prebuild"). public/sw.js is not committed.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.env.GITHUB_SHA || `local-${Date.now().toString(36)}`).slice(0, 12);
const template = readFileSync(path.join(root, 'scripts', 'sw.template.js'), 'utf8');
writeFileSync(path.join(root, 'public', 'sw.js'), template.replace('__VERSION__', version));
console.log(`public/sw.js (${version})`);
