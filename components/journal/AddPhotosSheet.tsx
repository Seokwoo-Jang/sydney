'use client';
// Photos chosen for upload (plan §7.6.1): a preview and a note for each, then
// one Upload. A photo that failed stays listed with an error so it can be retried.
// Closing with notes typed (or several photos chosen) asks before discarding.
import { useId, useState } from 'react';
import { ConfirmDiscard } from '@/components/checklist/FormBits';
import { Button, IconButton, Sheet, TextArea } from '@/components/ui';
import { S } from '@/lib/strings';
import styles from './Journal.module.css';
import form from '@/components/checklist/Form.module.css';

export interface PendingPhoto {
  key: string;
  file: File;
  /** Object URL for the preview; revoked when the photo leaves the list. */
  url: string;
  note: string;
  failed: boolean;
}

export function AddPhotosSheet({
  items,
  progress,
  notice,
  onNote,
  onRemove,
  onUpload,
  onClose,
}: {
  items: PendingPhoto[];
  progress: { n: number; total: number } | null;
  /** Why some chosen files were left out (type or size). */
  notice: string | null;
  onNote: (key: string, note: string) => void;
  onRemove: (key: string) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const busy = progress !== null;
  const [asking, setAsking] = useState(false);
  if (!items.length && asking) setAsking(false);
  const worthKeeping = items.length > 1 || items.some((p) => p.note.trim());

  const requestClose = () => {
    if (busy) return;
    if (worthKeeping && !asking) {
      setAsking(true);
      return;
    }
    setAsking(false);
    onClose();
  };

  return (
    <Sheet
      open={items.length > 0}
      onClose={requestClose}
      title={S.journal.addPhotos}
      description={S.journal.addPhotosHint}
      footer={
        asking ? (
          <ConfirmDiscard question={S.files.discardUpload(items.length)} onKeep={() => setAsking(false)} onDiscard={requestClose} />
        ) : (
          <div className={form.footerEnd}>
            <Button variant="ghost" disabled={busy} onClick={requestClose}>
              {S.actions.cancel}
            </Button>
            <Button variant="primary" busy={busy} onClick={onUpload}>
              {progress ? S.files.uploadingCount(progress.n, progress.total) : S.files.uploadPhotos(items.length)}
            </Button>
          </div>
        )
      }
    >
      {notice && (
        <p className={form.error} role="alert">
          {notice}
        </p>
      )}
      <ol role="list" className={styles.pending}>
        {items.map((p, i) => (
          <li key={p.key} className={styles.pendingItem}>
            <img src={p.url} alt={S.files.previewAlt(i + 1)} className={styles.pendingImg} decoding="async" draggable={false} />
            <div className={styles.pendingBody}>
              <label htmlFor={`${id}-${p.key}`} className={styles.pendingLabel}>
                {S.journal.note}
              </label>
              <TextArea
                id={`${id}-${p.key}`}
                rows={3}
                className={styles.noteField}
                placeholder={S.journal.notePrompt}
                value={p.note}
                disabled={busy}
                onChange={(e) => onNote(p.key, e.target.value)}
              />
              {p.failed && (
                <p className={form.error} role="alert">
                  {S.files.failed}
                </p>
              )}
            </div>
            <IconButton icon="close" label={S.files.removeFromUpload(i + 1)} disabled={busy} onClick={() => onRemove(p.key)} />
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
