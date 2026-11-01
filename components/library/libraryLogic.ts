// Library rules (plan §7.7). Pure, unit tested.
import type { Resource } from '@/lib/types';

export const MAX_PINNED = 4;

/** http(s) only, with a host. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** Comparable form: lower-case scheme/host, no trailing slash on the path. Query and hash are kept. */
export function urlKey(raw: string): string | null {
  if (!isHttpUrl(raw)) return null;
  const u = new URL(raw.trim());
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.host.toLowerCase()}${path}${u.search}${u.hash}`;
}

export function findDuplicate(url: string, resources: Resource[], exceptId: string | null): Resource | null {
  const key = urlKey(url);
  if (!key) return null;
  return resources.find((r) => r.id !== exceptId && urlKey(r.url) === key) ?? null;
}

/** 'transportnsw.info' — host without a leading www. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

/** Lowest free pin slot 1..4, or null when four are pinned. */
export function nextPinSlot(resources: Resource[]): number | null {
  const used = new Set(resources.map((r) => r.pinnedOrder).filter((n): n is number => n != null));
  for (let i = 1; i <= MAX_PINNED; i++) if (!used.has(i)) return i;
  return null;
}
