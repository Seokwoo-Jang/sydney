'use client';
// Private file for a travel document (plan §7.4 C, §8.3): one upload into a new
// `<trip_id>/<uuid>/` folder, a file_assets row, then the document points at it.
// Opening uses a short-lived signed URL that is never stored.
import { useRef, useState } from 'react';
import { Button, useToast } from '@/components/ui';
import { useAssets, useEntityOps, useFiles } from '@/lib/data';
import { DOC_MIME, fileProblem } from '@/lib/files';
import type { TripDocument } from '@/lib/types';
import { S } from '@/lib/strings';
import form from './Form.module.css';

/** Opens a link fetched after the click without tripping popup blockers. */
export async function openSigned(getUrl: () => Promise<string>): Promise<boolean> {
  const w = window.open('', '_blank');
  try {
    const url = await getUrl();
    if (w) {
      w.opener = null;
      w.location.href = url;
    } else {
      window.location.assign(url);
    }
    return true;
  } catch {
    w?.close();
    return false;
  }
}

export function DocumentFile({
  doc,
  version,
  onSaved,
}: {
  /** null while the document is not saved yet. */
  doc: TripDocument | null;
  /** The sheet's current base version of the document. */
  version: number;
  onSaved: (row: TripDocument) => void;
}) {
  const files = useFiles();
  const assets = useAssets();
  const docOps = useEntityOps('documents');
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'open' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const asset = doc?.assetId && assets.status === 'ready' ? (assets.data.find((a) => a.id === doc.assetId) ?? null) : null;

  /** Points the document at `assetId`, retrying once on a version conflict. */
  async function setAsset(assetId: string | null): Promise<TripDocument | null> {
    if (!doc) return null;
    let res = await docOps.update(doc.id, { assetId }, version);
    if (!res.ok && res.reason === 'conflict' && res.latest) res = await docOps.update(doc.id, { assetId }, res.latest.version);
    if (!res.ok) return null;
    onSaved(res.row);
    return res.row;
  }

  async function attach(file: File) {
    if (!doc) return;
    const problem = fileProblem(file, 'document');
    if (problem) return setError(problem);
    setError(null);
    setBusy('upload');
    try {
      let paths: string[];
      try {
        paths = await files.upload([{ name: file.name, blob: file, contentType: file.type }]);
      } catch {
        return setError(S.files.failed);
      }
      const created = await assets.create({
        storagePath: paths[0],
        displayPath: null,
        thumbPath: null,
        width: null,
        height: null,
        focalX: 0.5,
        focalY: 0.4,
        zoom: 1,
        mime: file.type,
        bytes: file.size,
        kind: 'document',
      isDefault: false,
        dayId: null,
        bookingId: null,
        documentId: doc.id,
        caption: '',
        sortOrder: 0,
      });
      if (!created.ok) {
        await files.remove(paths);
        return setError(S.files.failed);
      }
      const previous = asset;
      if (!(await setAsset(created.row.id))) return setError(S.files.failed);
      if (previous) await assets.remove(previous.id, previous.version);
      toast.show(S.files.attached);
    } finally {
      setBusy(null);
    }
  }

  async function open() {
    if (!asset) return;
    setBusy('open');
    const ok = await openSigned(() => files.signedUrl(asset.storagePath));
    setBusy(null);
    if (!ok) toast.show(S.files.openFailed);
  }

  async function remove() {
    if (!asset) return;
    setBusy('remove');
    const saved = await setAsset(null);
    if (saved) await assets.remove(asset.id, asset.version);
    setBusy(null);
    if (saved) toast.show(S.files.removed);
    else setError(S.files.failed);
  }

  const canAttach = !!doc && files.available;
  const note = !files.available ? S.files.unavailable : !doc ? S.files.saveFirst : asset ? S.files.docTypes : `${S.files.noFile} ${S.files.docTypes}`;

  return (
    <div className={form.fieldset}>
      <div className={form.disabledNote}>
        <input
          ref={input}
          type="file"
          accept={DOC_MIME.join(',')}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void attach(file);
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          iconStart="plus"
          disabled={!canAttach || busy !== null}
          busy={busy === 'upload'}
          aria-describedby="doc-file-note"
          onClick={() => input.current?.click()}
        >
          {busy === 'upload' ? S.files.uploading : S.files.attach}
        </Button>
        {asset && (
          <>
            <Button variant="ghost" size="sm" iconStart="external" busy={busy === 'open'} disabled={busy !== null} onClick={() => void open()}>
              {S.actions.openDocument}
            </Button>
            <Button variant="ghost" size="sm" busy={busy === 'remove'} disabled={busy !== null} onClick={() => void remove()}>
              {S.files.remove}
            </Button>
          </>
        )}
      </div>
      <p id="doc-file-note" className={form.hint}>
        {note}
      </p>
      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
