// Steps shared by the journal's photo sheets (plan §7.6.1): storing a photo's
// files, moving the day cover, the day's own photo and the comments on photos.
import type { useDays, useFiles } from '@/lib/data';
import { newId } from '@/lib/data';
import { makePhotoVariants, variantExt } from '@/lib/files';
import type { FileAsset, JournalEntry, TripDay } from '@/lib/types';

export const ORIGINAL_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

type Files = ReturnType<typeof useFiles>;
type Days = ReturnType<typeof useDays>;

/** The original as given plus a 2048 px display copy and a 480 px thumbnail, in one new private folder. */
export async function storePhoto(files: Files, file: File): Promise<{ paths: string[]; width: number; height: number }> {
  const v = await makePhotoVariants(file);
  const ext = variantExt(v.variantType);
  const paths = await files.upload([
    { name: `original.${ORIGINAL_EXT[file.type] ?? 'jpg'}`, blob: file, contentType: file.type },
    { name: `display.${ext}`, blob: v.display, contentType: v.variantType },
    { name: `thumb.${ext}`, blob: v.thumb, contentType: v.variantType },
  ]);
  return { paths, width: v.width, height: v.height };
}

/**
 * Moves the day cover from `from` to `to`. The day row also holds its title,
 * so a version conflict retries once on the latest row, but only while that
 * row's cover is still `from`: a cover chosen elsewhere is never overwritten.
 * Returns the latest day when that happened.
 */
export async function moveCover(days: Days, day: TripDay, to: string | null, from: string | null): Promise<'ok' | 'error' | TripDay> {
  let version = day.version;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await days.update(day.id, { coverAssetId: to }, version);
    if (r.ok) return 'ok';
    if (r.reason !== 'conflict' || !r.latest) return 'error';
    if (r.latest.coverAssetId === to) return 'ok';
    if (r.latest.coverAssetId !== from) return r.latest;
    version = r.latest.version;
  }
  return 'error';
}

/**
 * The day's own photo always gets the same id (its day id, read backwards), so two
 * devices filing it at once make one row. Ids that are not UUIDs (examples) get a new one.
 */
export function defaultPhotoId(dayId: string): string {
  const hex = dayId.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return newId();
  const r = [...hex].reverse().join('');
  return `${r.slice(0, 8)}-${r.slice(8, 12)}-${r.slice(12, 16)}-${r.slice(16, 20)}-${r.slice(20)}`;
}

/** Live comments by photo, oldest first; comments on deleted photos are left out. */
export function commentsByPhoto(entries: JournalEntry[], photos: FileAsset[]): Map<string, JournalEntry[]> {
  const live = new Set(photos.map((p) => p.id));
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    if (e.deletedAt || !e.assetId || !live.has(e.assetId) || !e.body.trim()) continue;
    map.set(e.assetId, [...(map.get(e.assetId) ?? []), e]);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return map;
}
