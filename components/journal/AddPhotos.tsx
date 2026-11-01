'use client';
// Adds photos to one day (plan §7.6.1): the original is kept as uploaded, plus
// a 2048 px display copy and a 480 px thumbnail made in the browser. The three
// files share one private `<trip_id>/<uuid>/` folder and one file_assets row.
import { useRef, useState } from 'react';
import { Button, useToast } from '@/components/ui';
import { useAssets, useFiles } from '@/lib/data';
import { PHOTO_MIME, fileProblem, makePhotoVariants, variantExt } from '@/lib/files';
import type { FileAsset, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import styles from './Journal.module.css';

const ORIGINAL_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function AddPhotos({ day, photos }: { day: TripDay; photos: FileAsset[] }) {
  const files = useFiles();
  const assets = useAssets();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addOne(file: File, sortOrder: number): Promise<boolean> {
    let variants;
    try {
      variants = await makePhotoVariants(file);
    } catch {
      return false;
    }
    const ext = variantExt(variants.variantType);
    let paths: string[];
    try {
      paths = await files.upload([
        { name: `original.${ORIGINAL_EXT[file.type]}`, blob: file, contentType: file.type },
        { name: `display.${ext}`, blob: variants.display, contentType: variants.variantType },
        { name: `thumb.${ext}`, blob: variants.thumb, contentType: variants.variantType },
      ]);
    } catch {
      return false;
    }
    const res = await assets.create({
      storagePath: paths[0],
      displayPath: paths[1],
      thumbPath: paths[2],
      width: variants.width,
      height: variants.height,
      focalX: 0.5,
      focalY: 0.4,
      zoom: 1,
      mime: file.type,
      bytes: file.size,
      kind: 'photo',
      dayId: day.id,
      bookingId: null,
      documentId: null,
      caption: '',
      sortOrder,
    });
    if (!res.ok) await files.remove(paths);
    return res.ok;
  }

  async function add(list: File[]) {
    const problems = list.map((f) => fileProblem(f, 'photo'));
    const ok = list.filter((_, i) => !problems[i]);
    setError(problems.find(Boolean) ?? null);
    if (!ok.length) return;
    let order = Math.max(0, ...photos.map((p) => p.sortOrder));
    let added = 0;
    for (let i = 0; i < ok.length; i++) {
      setProgress({ n: i + 1, total: ok.length });
      order += 10;
      if (await addOne(ok[i], order)) added++;
    }
    setProgress(null);
    if (added) toast.show(S.files.photosAdded(added));
    if (added < ok.length) setError(S.files.failed);
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
          if (list.length) void add(list);
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        iconStart="plus"
        disabled={!files.available || progress !== null}
        busy={progress !== null}
        aria-describedby="journal-upload-note"
        onClick={() => input.current?.click()}
      >
        {progress ? S.files.uploadingCount(progress.n, progress.total) : S.journal.addPhotos}
      </Button>
      <p id="journal-upload-note" className={styles.hint}>
        {files.available ? S.files.photoTypes : S.files.unavailable}
      </p>
      {error && (
        <p className={styles.hint} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
