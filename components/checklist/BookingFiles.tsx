'use client';
// Private files for a booking (e-ticket, voucher, rental agreement; plan §7.4 C, §8.3):
// each upload goes into a new `<trip_id>/<uuid>/` folder with a file_assets row that
// points at the booking. The file name is kept as the caption. Opening uses a
// short-lived signed URL that is never stored.
import { useRef, useState } from 'react';
import { Button, useToast } from '@/components/ui';
import { useAssets, useFiles } from '@/lib/data';
import { DOC_MIME, fileProblem } from '@/lib/files';
import type { Booking, FileAsset } from '@/lib/types';
import { S } from '@/lib/strings';
import { openSigned } from './DocumentFile';
import form from './Form.module.css';
import styles from './Bookings.module.css';

export function BookingFiles({ booking }: { booking: Booking }) {
  const files = useFiles();
  const assets = useAssets();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'upload' or the asset id being opened / removed
  const [error, setError] = useState<string | null>(null);

  const attached =
    assets.status === 'ready'
      ? assets.data.filter((a) => a.bookingId === booking.id && !a.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : [];

  async function attach(file: File) {
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
        bookingId: booking.id,
        documentId: null,
        caption: file.name,
        sortOrder: attached.length,
      });
      if (!created.ok) {
        await files.remove(paths);
        return setError(S.files.failed);
      }
      toast.show(S.files.attached);
    } finally {
      setBusy(null);
    }
  }

  async function open(a: FileAsset) {
    setBusy(a.id);
    const ok = await openSigned(() => files.signedUrl(a.storagePath));
    setBusy(null);
    if (!ok) toast.show(S.files.openFailed);
  }

  async function remove(a: FileAsset) {
    setBusy(a.id);
    const res = await assets.remove(a.id, a.version);
    setBusy(null);
    if (res.ok) toast.show(S.files.removed);
    else setError(S.files.failed);
  }

  const note = !files.available ? S.files.unavailable : attached.length ? S.files.docTypes : `${S.files.noFile} ${S.files.docTypes}`;

  return (
    <section className={styles.sheetBlock} aria-label={S.checklist.bookingFiles}>
      <h3 className={form.subhead}>{S.checklist.bookingFiles}</h3>
      {attached.length > 0 && (
        <ul className={styles.expenseList}>
          {attached.map((a) => (
            <li key={a.id} className={styles.fileRow}>
              <button type="button" className={styles.fileOpen} disabled={busy !== null} onClick={() => void open(a)}>
                {a.caption || S.files.untitled}
                <span className="sr-only"> ({S.ui.externalLink})</span>
              </button>
              <Button variant="ghost" size="sm" busy={busy === a.id} disabled={busy !== null} onClick={() => void remove(a)}>
                {S.files.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
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
          disabled={!files.available || busy !== null}
          busy={busy === 'upload'}
          aria-describedby="booking-file-note"
          onClick={() => input.current?.click()}
        >
          {busy === 'upload' ? S.files.uploading : S.files.attach}
        </Button>
      </div>
      <p id="booking-file-note" className={form.hint}>
        {note}
      </p>
      {error && (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
