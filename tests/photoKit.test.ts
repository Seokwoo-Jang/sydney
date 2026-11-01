// Journal photo helpers (plan §7.6.1). Fictional ids only.
import { describe, expect, it } from 'vitest';
import { commentsByPhoto, defaultPhotoId } from '@/components/journal/photoKit';
import type { FileAsset, JournalEntry } from '@/lib/types';

const entry = (id: string, assetId: string | null, createdAt: string, p: Partial<JournalEntry> = {}): JournalEntry =>
  ({ id, assetId, createdAt, body: `note ${id}`, deletedAt: null, authorId: 'm', dayId: 'd', ...p }) as JournalEntry;
const photo = (id: string) => ({ id }) as FileAsset;

describe('journal photo helpers', () => {
  it('the day’s own photo has one id per day, so two devices file one row', () => {
    const day = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(defaultPhotoId(day)).toBe(defaultPhotoId(day));
    expect(defaultPhotoId(day)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(defaultPhotoId(day)).not.toBe(day);
    expect(defaultPhotoId('day-1')).not.toBe(defaultPhotoId('day-1')); // not a UUID: a fresh id
  });

  it('comments by photo: oldest first, none for deleted photos, deleted or empty comments', () => {
    const map = commentsByPhoto(
      [
        entry('b', 'p1', '2030-12-29T02:00:00Z'),
        entry('a', 'p1', '2030-12-29T01:00:00Z'),
        entry('gone', 'p1', '2030-12-29T03:00:00Z', { deletedAt: '2030-12-29T04:00:00Z' }),
        entry('blank', 'p1', '2030-12-29T03:00:00Z', { body: '  ' }),
        entry('day-note', null, '2030-12-29T01:00:00Z'),
        entry('orphan', 'p-deleted', '2030-12-29T01:00:00Z'),
      ],
      [photo('p1'), photo('p2')],
    );
    expect([...map.keys()]).toEqual(['p1']);
    expect(map.get('p1')!.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
