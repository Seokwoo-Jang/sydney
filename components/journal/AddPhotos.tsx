'use client';
// Adds photos to one day (plan §7.6.1). Chosen photos wait in a list where
// each can get its text; Upload sends them one by one. The original is kept as
// uploaded, plus a 2048 px display copy and a 480 px thumbnail made in the
// browser. The three files share one private `<trip_id>/<uuid>/` folder and one
// file_assets row; the text is its caption. The repository records who added it.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { newId, useAssets, useFiles } from '@/lib/data';
import { PHOTO_MIME, fileProblem, makePhotoVariants, variantExt } from '@/lib/files';
import type { FileAsset, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { AddPhotosSheet, type PendingPhoto } from './AddPhotosSheet';
import styles from './Journal.module.css';

export const ORIGINAL_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Files already in storage for a listed photo, so a retry only creates the row. */
interface Stored {
  paths: string[];
  width: number;
  height: number;
}

export function AddPhotos({
  day,
  photos,
  notify,
  autoFocus,
}: {
  day: TripDay;
  photos: FileAsset[];
  notify: (message: string) => void;
  /** Takes focus as the day sheet opens (Sheet keeps a focus already inside it). */
  autoFocus?: boolean;
}) {
  const files = useFiles();
  const assets = useAssets();
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
      let variants;
      try {
        variants = await makePhotoVariants(file);
      } catch {
        return false;
      }
      const ext = variantExt(variants.variantType);
      try {
        const paths = await files.upload([
          { name: `original.${ORIGINAL_EXT[file.type]}`, blob: file, contentType: file.type },
          { name: `display.${ext}`, blob: variants.display, contentType: variants.variantType },
          { name: `thumb.${ext}`, blob: variants.thumb, contentType: variants.variantType },
        ]);
        done = { paths, width: variants.width, height: variants.height };
      } catch {
        return false;
      }
      stored.current.set(key, done);
    }
    // The list key is the row id: if an earlier try reached the server after
    // all, create returns that row instead of adding the photo twice.
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
      dayId: day.id,
      bookingId: null,
      documentId: null,
      caption: item.note.trim(),
      sortOrder,
    });
    // A failed create keeps the files for the retry: the row may exist anyway.
    // A photo then dropped from the list leaves them to the cleanup rule (plan §8.2-8).
    if (res.ok) stored.current.delete(key);
    return res.ok;
  }

  function choose(list: File[]) {
    const problems = list.map((f) => fileProblem(f, 'photo'));
    setError(problems.find(Boolean) ?? null);
    const ok = list.filter((_, i) => !problems[i]);
    if (!ok.length) return;
    setPending((all) => [...all, ...ok.map((file) => ({ key: newId(), file, url: URL.createObjectURL(file), note: '', failed: false }))]);
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
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      setProgress({ n: i + 1, total: list.length });
      order += 10;
      if (await addOne(item, order)) {
        added++;
        drop(item.key);
      } else {
        setPending((all) => all.map((p) => (p.key === item.key ? { ...p, failed: true } : p)));
      }
    }
    setProgress(null);
    if (added) notify(S.files.photosAdded(added));
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
        onRemove={drop}
        onUpload={() => void upload()}
        onClose={cancel}
      />
    </>
  );
}
