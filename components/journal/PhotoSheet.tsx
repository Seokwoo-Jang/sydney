'use client';
// Edit one journal photo (plan §7.6.1): its note, whether it is the day's
// cover, and delete. The note saves with the usual version check; the cover
// is a field of the day. Mounted per photo, so every open starts fresh.
import { useState, type CSSProperties } from 'react';
import { CheckField, ConfirmDelete, ConfirmDiscard, ConflictBlock } from '@/components/checklist/FormBits';
import { conflictSource, useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, ConflictNotice, Field, SaveStatus, Sheet, TextArea, useToast } from '@/components/ui';
import { useAssets, useDays, useFiles } from '@/lib/data';
import type { FileAsset, Member, SaveResult, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { Photo } from './Photo';
import styles from './Journal.module.css';
import form from '@/components/checklist/Form.module.css';

interface Draft {
  version: number;
  caption: string;
  captionTouched: boolean;
  cover: boolean;
  coverTouched: boolean;
}

export function PhotoSheet({
  asset,
  index,
  day,
  coverId,
  me,
  partner,
  onDeleted,
  onClose,
}: {
  asset: FileAsset;
  /** 1-based position on the day, for the alt text. */
  index: number;
  day: TripDay;
  /** The photo the day card shows (chosen cover, else the first photo). */
  coverId: string | null;
  me: Member | null;
  partner: Member | null;
  /** The row is gone: the day sheet says so and moves focus (this sheet closes). */
  onDeleted: () => void;
  onClose: () => void;
}) {
  const assets = useAssets();
  const days = useDays();
  const files = useFiles();
  const toast = useToast();
  const save = useSaveFlow<FileAsset>();
  const isCover = asset.id === coverId;
  const chosen = day.coverAssetId === asset.id;
  const [draft, setDraft] = useState<Draft>(() => ({
    version: asset.version,
    caption: asset.caption,
    captionTouched: false,
    cover: isCover,
    coverTouched: false,
  }));
  /** The day's cover changed elsewhere before ours saved (the day row now shows it). */
  const [coverClash, setCoverClash] = useState<TripDay | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const edit = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    save.markDirty();
  };
  const dirty = (draft.captionTouched && draft.caption.trim() !== asset.caption) || (draft.coverTouched && draft.cover !== isCover);

  const requestClose = () => {
    if (dirty && !discarding) {
      setDiscarding(true);
      return;
    }
    onClose();
  };

  /**
   * Moves the day cover from `from` to `to`. The day row also holds its title,
   * so a version conflict retries once on the latest row, but only while that
   * row's cover is still `from`: a cover chosen elsewhere is never overwritten.
   * Returns the latest day when that happened.
   */
  const setCover = async (to: string | null, from: string | null): Promise<'ok' | 'error' | TripDay> => {
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
  };

  const submit = async () => {
    const caption = draft.caption.trim();
    setCoverClash(null);
    const result = await save.run(async (): Promise<SaveResult<FileAsset>> => {
      let row = asset;
      if (draft.captionTouched && caption !== asset.caption) {
        const r = await assets.update(asset.id, { caption }, draft.version);
        if (!r.ok) return r;
        row = r.row;
        setDraft((d) => ({ ...d, version: r.row.version, captionTouched: false }));
      }
      if (draft.coverTouched && draft.cover !== isCover) {
        const r = await setCover(draft.cover ? asset.id : null, day.coverAssetId);
        if (r === 'error') return { ok: false, reason: 'error', message: S.sync.failed };
        if (r !== 'ok') {
          setCoverClash(r);
          return { ok: false, reason: 'conflict', latest: null };
        }
      }
      return { ok: true, row };
    });
    if (result.ok) onClose();
    else if (result.reason === 'error') toast.show(S.sync.failed, { tone: 'error' });
  };

  const remove = async () => {
    const result = await save.run(() => assets.remove(asset.id, draft.version));
    if (!result.ok) {
      if (result.reason === 'error') toast.show(S.sync.failed, { tone: 'error' });
      return;
    }
    onDeleted();
    onClose();
    // Best effort: the row is gone, so the files and the cover pointer are only tidy-up.
    try {
      await files.remove([asset.storagePath, asset.displayPath, asset.thumbPath].filter((p): p is string => !!p));
    } catch {
      // Left for the server-side cleanup rule (plan §8.2-8).
    }
    if (chosen) await setCover(null, asset.id); // a cover chosen elsewhere meanwhile stays
  };

  return (
    <Sheet
      open
      onClose={requestClose}
      title={S.journal.editPhotoTitle}
      description={S.journal.photoAlt(day.dayNumber, index)}
      headerExtra={<SaveStatus state={save.state} />}
      footer={
        discarding ? (
          <ConfirmDiscard onKeep={() => setDiscarding(false)} onDiscard={onClose} />
        ) : (
          <div className={form.footer}>
            <ConfirmDelete onConfirm={remove} busy={save.busy} label={S.journal.deletePhoto} question={S.journal.deletePhotoConfirm} />
            <div className={form.footerEnd}>
              <Button variant="ghost" onClick={requestClose}>
                {S.actions.cancel}
              </Button>
              <Button variant="primary" busy={save.busy} onClick={submit}>
                {S.actions.save}
              </Button>
            </div>
          </div>
        )
      }
    >
      <form
        className={form.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {coverClash ? (
          <ConflictNotice
            source={conflictSource(coverClash.updatedBy, me?.id)}
            partnerName={partner?.displayName}
            onReview={() => {
              // The day already carries the latest cover: start the choice again from there.
              setDraft((d) => ({ ...d, cover: isCover, coverTouched: false }));
              setCoverClash(null);
              save.clearConflict();
            }}
          />
        ) : (
          save.conflict && (
            <ConflictBlock
              key={save.conflict.latest?.version ?? 0}
              latest={save.conflict.latest}
              me={me}
              partner={partner}
              onRebase={(l) => setDraft((d) => ({ ...d, version: l.version }))}
              renderLatest={(l) => <p className={form.latestBody}>{l.caption}</p>}
              onUseLatest={(l) => {
                setDraft((d) => ({ ...d, version: l.version, caption: l.caption, captionTouched: false }));
                save.clearConflict();
              }}
            />
          )
        )}
        <div className={styles.sheetPhoto} style={{ '--ratio': asset.width && asset.height ? asset.width / asset.height : 0.75 } as CSSProperties}>
          <Photo
            photo={{ src: asset.url ?? '', thumb: asset.thumbUrl, width: asset.width, height: asset.height }}
            alt={S.journal.photoAlt(day.dayNumber, index)}
            sizes="(min-width: 1024px) 420px, 92vw"
            className={styles.printImg}
            eager
          />
        </div>
        <Field label={S.journal.note}>
          <TextArea
            rows={4}
            className={styles.noteField}
            placeholder={S.journal.notePrompt}
            value={draft.caption}
            onChange={(e) => edit({ caption: e.target.value, captionTouched: true })}
          />
        </Field>
        <CheckField
          label={S.journal.useAsCover}
          hint={S.journal.coverHint}
          checked={draft.cover}
          disabled={isCover && !chosen}
          onChange={(cover) => edit({ cover, coverTouched: true })}
        />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
