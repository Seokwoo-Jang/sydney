'use client';
// Adds photos to one day (plan §7.6.1). Chosen photos wait in a list where
// each can get the uploader's comment and one can be picked as the day cover;
// Upload sends them one by one. The original is kept as uploaded, plus a
// 2048 px display copy and a 480 px thumbnail made in the browser. The three
// files share one private `<trip_id>/<uuid>/` folder and one file_assets row;
// the comment is a journal entry of whoever uploads (the server records who).
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { newId, useAssets, useDays, useFiles, useJournal } from '@/lib/data';
import { PHOTO_MIME, fileProblem } from '@/lib/files';
import type { FileAsset, Member, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { AddPhotosSheet, type PendingPhoto } from './AddPhotosSheet';
import { moveCover, storePhoto } from './photoKit';
import styles from './Journal.module.css';

export { ORIGINAL_EXT } from './photoKit';

/** Files already in storage for a listed photo, so a retry only creates the rows. */
interface Stored {
  paths: string[];
  width: number;
  height: number;
}

export function AddPhotos({
  day,
  photos,
  me,
  notify,
  autoFocus,
}: {
  day: TripDay;
  photos: FileAsset[];
  me: Member | null;
  notify: (message: string, tone?: 'error') => void;
  /** Takes focus as the day sheet opens (Sheet keeps a focus already inside it). */
  autoFocus?: boolean;
}) {
  const files = useFiles();
  const assets = useAssets();
  const journal = useJournal();
  const days = useDays();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stored = useRef(new Map<string, Stored>());

  // Previews are object URLs: release whatever is still listed on unmount.
  const listed = useRef(pending);
  listed.current = pending;
  useEffect(() => () => listed.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function addOne(item: PendingPhoto, sortOrder: number): Promise<boolean> {
    const { key, file } = item;
    let done = stored.current.get(key);
    if (!done) {
      try {
        done = await storePhoto(files, file);
      } catch {
        return false;
      }
      stored.current.set(key, done);
    }
    // The list keys are the row ids: if an earlier try reached the server after
    // all, create returns that row instead of adding the photo (or comment) twice.
    const res = await assets.create({
      id: key,
      storagePath: done.paths[0],
      displayPath: done.paths[1],
      thumbPath: done.paths[2],
      width: done.width,
      height: done.height,
      focalX: 0.5,
      focalY: 0.4,
      zoom: 1,
      mime: file.type,
      bytes: file.size,
      kind: 'photo',
      isDefault: false,
      dayId: day.id,
      bookingId: null,
      documentId: null,
      caption: '',
      sortOrder,
    });
    // A failed create keeps the files for the retry: the row may exist anyway.
    // A photo then dropped from the list leaves them to the cleanup rule (plan §8.2-8).
    if (!res.ok) return false;
    const note = item.note.trim();
    if (note && me) {
      const c = await journal.create({ id: item.commentKey, dayId: day.id, assetId: key, authorId: me.id, body: note });
      if (!c.ok) return false;
    }
    stored.current.delete(key);
    return true;
  }

  function choose(list: File[]) {
    const problems = list.map((f) => fileProblem(f, 'photo'));
    setError(problems.find(Boolean) ?? null);
    const ok = list.filter((_, i) => !problems[i]);
    if (!ok.length) return;
    setPending((all) => [
      ...all,
      ...ok.map((file) => ({ key: newId(), commentKey: newId(), file, url: URL.createObjectURL(file), note: '', cover: false, failed: false })),
    ]);
  }

  function drop(key: string) {
    const gone = listed.current.find((p) => p.key === key);
    if (gone) URL.revokeObjectURL(gone.url);
    stored.current.delete(key);
    // The file-check notice belongs to the list: it goes when the list empties.
    if (listed.current.length <= 1) setError(null);
    setPending((all) => all.filter((p) => p.key !== key));
  }

  function cancel() {
    if (progress) return; // uploads in flight finish first
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    stored.current.clear();
    setPending([]);
    setError(null);
  }

  async function upload() {
    const list = pending;
    let order = Math.max(0, ...photos.map((p) => p.sortOrder));
    let added = 0;
    let cover: string | null = null;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      setProgress({ n: i + 1, total: list.length });
      order += 10;
      if (await addOne(item, order)) {
        added++;
        if (item.cover) cover = item.key;
        drop(item.key);
      } else {
        setPending((all) => all.map((p) => (p.key === item.key ? { ...p, failed: true } : p)));
      }
    }
    setProgress(null);
    if (added) notify(S.files.photosAdded(added));
    // The photo picked as cover becomes the day's cover (a cover chosen meanwhile elsewhere stays).
    if (cover && (await moveCover(days, day, cover, day.coverAssetId)) !== 'ok') notify(S.journal.coverNotSet, 'error');
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PHOTO_MIME.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (list.length) choose(list);
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        iconStart="plus"
        disabled={!files.available || progress !== null}
        aria-describedby="journal-upload-note"
        data-add-photos=""
        autoFocus={autoFocus}
        onClick={() => input.current?.click()}
      >
        {S.journal.addPhotos}
      </Button>
      <p id="journal-upload-note" className={styles.hint}>
        {files.available ? S.files.photoTypes : S.files.unavailable}
      </p>
      {/* With photos listed, the notice shows in the list sheet instead. */}
      {error && !pending.length && (
        <p className={styles.hint} role="alert">
          {error}
        </p>
      )}
      <AddPhotosSheet
        items={pending}
        progress={progress}
        notice={error}
        onNote={(key, note) => setPending((all) => all.map((p) => (p.key === key ? { ...p, note } : p)))}
        onCover={(key, on) => setPending((all) => all.map((p) => ({ ...p, cover: p.key === key ? on : on ? false : p.cover })))}
        onRemove={drop}
        onUpload={() => void upload()}
        onClose={cancel}
      />
    </>
  );
}
