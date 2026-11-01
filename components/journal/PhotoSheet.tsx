'use client';
// Edit one journal photo (plan §7.6.1): your comment on it, whether it is the
// day's cover, change the photo itself, and delete. Each of us has one comment
// per photo and edits only our own (owner, 2026-11-01): the other's shows read
// only with their mark. Cover, change and delete are open to both of us. The
// comment saves with the usual version check; the cover is a field of the day.
// Mounted per photo, so every open starts fresh.
import { useRef, useState, type CSSProperties } from 'react';
import { CheckField, ConfirmDelete, ConfirmDiscard, ConflictBlock } from '@/components/checklist/FormBits';
import { conflictSource, useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, ConflictNotice, Field, MemberMarks, SaveStatus, Sheet, TextArea, useToast } from '@/components/ui';
import { newId, useAssets, useDays, useFiles, useJournal } from '@/lib/data';
import { PHOTO_MIME, fileProblem } from '@/lib/files';
import type { FileAsset, JournalEntry, Member, SaveResult, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { Photo } from './Photo';
import { moveCover, storePhoto } from './photoKit';
import styles from './Journal.module.css';
import form from '@/components/checklist/Form.module.css';

interface Draft {
  /** Photo row version (Change photo). */
  version: number;
  comment: string;
  commentTouched: boolean;
  /** Version of my comment row, when I have one. */
  commentVersion: number;
  cover: boolean;
  coverTouched: boolean;
}

export function PhotoSheet({
  asset,
  index,
  day,
  coverId,
  comments,
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
  /** Live comments on this photo, oldest first. */
  comments: JournalEntry[];
  me: Member | null;
  partner: Member | null;
  /** The row is gone: the day sheet says so and moves focus (this sheet closes). */
  onDeleted: () => void;
  onClose: () => void;
}) {
  const assets = useAssets();
  const journal = useJournal();
  const days = useDays();
  const files = useFiles();
  const toast = useToast();
  const save = useSaveFlow<JournalEntry>();
  const isCover = asset.id === coverId;
  const chosen = day.coverAssetId === asset.id;
  const mine = me ? (comments.find((c) => c.authorId === me.id) ?? null) : null;
  const theirs = comments.filter((c) => c.authorId !== me?.id);
  const newCommentId = useRef(newId()).current;
  const [draft, setDraft] = useState<Draft>(() => ({
    version: asset.version,
    comment: mine?.body ?? '',
    commentTouched: false,
    commentVersion: mine?.version ?? 0,
    cover: isCover,
    coverTouched: false,
  }));
  /** The day's cover changed elsewhere before ours saved (the day row now shows it). */
  const [coverClash, setCoverClash] = useState<TripDay | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [changing, setChanging] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const edit = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    save.markDirty();
  };
  const dirty = (draft.commentTouched && draft.comment.trim() !== (mine?.body.trim() ?? '')) || (draft.coverTouched && draft.cover !== isCover);

  const requestClose = () => {
    if (dirty && !discarding) {
      setDiscarding(true);
      return;
    }
    onClose();
  };

  /** My comment: added, changed, or (emptied) deleted. Null when there was nothing to write. */
  const writeComment = async (): Promise<SaveResult<JournalEntry> | null> => {
    const text = draft.comment.trim();
    if (!me || !draft.commentTouched || text === (mine?.body.trim() ?? '')) return null;
    if (mine) return text ? journal.update(mine.id, { body: text }, draft.commentVersion) : journal.remove(mine.id, draft.commentVersion);
    return journal.create({ id: newCommentId, dayId: day.id, assetId: asset.id, authorId: me.id, body: text });
  };

  const submit = async () => {
    setCoverClash(null);
    const result = await save.run(async (): Promise<SaveResult<JournalEntry>> => {
      const c = await writeComment();
      if (c && !c.ok) return c;
      if (c?.ok) setDraft((d) => ({ ...d, commentVersion: c.row.version, commentTouched: false }));
      if (draft.coverTouched && draft.cover !== isCover) {
        const r = await moveCover(days, day, draft.cover ? asset.id : null, day.coverAssetId);
        if (r === 'error') return { ok: false, reason: 'error', message: S.sync.failed };
        if (r !== 'ok') {
          setCoverClash(r);
          return { ok: false, reason: 'conflict', latest: null };
        }
      }
      // Nothing else to report: the sheet only needs to know it all went through.
      return { ok: true, row: c?.ok ? c.row : (mine as JournalEntry) };
    });
    if (result.ok) onClose();
    else if (result.reason === 'error') toast.show(S.sync.failed, { tone: 'error' });
  };

  /**
   * Swaps the picture and keeps the photo (comments, order, cover): new files in a
   * fresh folder, then the row points at them; the old files go afterwards.
   */
  const changePhoto = async (file: File) => {
    const problem = fileProblem(file, 'photo');
    if (problem) {
      setPhotoError(problem);
      return;
    }
    setPhotoError(null);
    setChanging(true);
    try {
      const { paths, width, height } = await storePhoto(files, file);
      const r = await assets.update(
        asset.id,
        { storagePath: paths[0], displayPath: paths[1], thumbPath: paths[2], width, height, mime: file.type, bytes: file.size },
        draft.version,
      );
      if (!r.ok) {
        // A conflict is a clear "not saved": drop the new files. Other failures may have saved.
        if (r.reason === 'conflict') await files.remove(paths).catch(() => undefined);
        toast.show(r.reason === 'conflict' ? S.sync.conflict : S.sync.failed, { tone: 'error' });
        return;
      }
      setDraft((d) => ({ ...d, version: r.row.version }));
      toast.show(S.journal.photoChanged);
      await files.remove([asset.storagePath, asset.displayPath, asset.thumbPath].filter((p): p is string => !!p)).catch(() => undefined);
    } catch {
      setPhotoError(S.files.failed);
    } finally {
      setChanging(false);
    }
  };

  const remove = async () => {
    const r = await assets.remove(asset.id, draft.version);
    if (!r.ok) {
      toast.show(r.reason === 'conflict' ? S.sync.conflict : S.sync.failed, { tone: 'error' });
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
    if (chosen) await moveCover(days, day, null, asset.id); // a cover chosen elsewhere meanwhile stays
  };

  const nameOf = (c: JournalEntry) => (c.authorId === partner?.id ? partner.displayName : S.journal.someone);
  const keyOf = (c: JournalEntry) => (c.authorId === partner?.id ? partner.profileKey : me?.profileKey);

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
              onRebase={(l) => setDraft((d) => ({ ...d, commentVersion: l.version }))}
              renderLatest={(l) => <p className={form.latestBody}>{l.body}</p>}
              onUseLatest={(l) => {
                setDraft((d) => ({ ...d, commentVersion: l.version, comment: l.body, commentTouched: false }));
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
        <div className={styles.changeRow}>
          <input
            ref={picker}
            type="file"
            accept={PHOTO_MIME.join(',')}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void changePhoto(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            iconStart="image"
            busy={changing}
            disabled={changing || save.busy || !files.available}
            onClick={() => picker.current?.click()}
          >
            {changing ? S.journal.changingPhoto : S.journal.changePhoto}
          </Button>
          {photoError && (
            <p className={form.hint} role="alert">
              {photoError}
            </p>
          )}
        </div>
        {theirs.map((c) => (
          <div key={c.id} className={styles.readText}>
            <p className={styles.commentHead}>
              <MemberMarks who={keyOf(c) ?? 'together'} size="sm" />
              <span>{S.journal.theirComment(nameOf(c))}</span>
            </p>
            <p className={styles.readBody}>{c.body}</p>
          </div>
        ))}
        {me && (
          <Field label={S.journal.myComment}>
            <TextArea
              rows={4}
              className={styles.noteField}
              placeholder={S.journal.textPrompt}
              value={draft.comment}
              onChange={(e) => edit({ comment: e.target.value, commentTouched: true })}
            />
          </Field>
        )}
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
