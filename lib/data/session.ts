// Pure helpers shared by every repository.
import type { ProfileKey } from '../types';

export const ENTRY_NAMES = { eren: 'Eren', amy: 'Amy' } as const satisfies Record<ProfileKey, 'Eren' | 'Amy'>;

/** ' amy ' → 'amy'; anything else → null. Trim + case-insensitive (plan §8.1-2). */
export function normalizeEntryName(raw: string): ProfileKey | null {
  const v = raw.trim().toLowerCase();
  return v === 'eren' || v === 'amy' ? v : null;
}

/**
 * Client-generated id for idempotent creates. Always an RFC 4122 v4 UUID (the
 * server rejects anything else). `randomUUID` needs a secure context, so plain
 * http (e.g. a phone on the LAN dev server) falls back to getRandomValues.
 */
export function newId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
