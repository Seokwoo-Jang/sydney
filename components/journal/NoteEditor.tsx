'use client';
// "My Notes" / "<Partner>’s Notes" (plan §7.6). Both are editable; saving is
// explicit; a conflict keeps the draft and shows the latest saved text.
import { useId } from 'react';
import { ConflictBlock } from '@/components/checklist/FormBits';
import { useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, SaveStatus, TextArea, type SaveState } from '@/components/ui';
import { newId, useJournal } from '@/lib/data';
import type { JournalEntry, Member } from '@/lib/types';
import { S } from '@/lib/strings';
import styles from './Journal.module.css';
import form from '@/components/checklist/Form.module.css';

/** Unsaved text, kept by the section so closing the sheet never loses it. */
export interface NoteDraft {
  text: string;
  baseVersion: number;
  newId: string;
}

export function NoteEditor({
  dayId,
  author,
  entry,
  heading,
  prompt,
  draft,
  me,
  partner,
  members,
  autoFocus,
  onDraft,
}: {
  dayId: string;
  author: Member;
  entry: JournalEntry | null;
  heading: string;
  prompt: string;
  draft: NoteDraft | undefined;
  me: Member | null;
  partner: Member | null;
  members: Member[];
  autoFocus?: boolean;
  onDraft: (d: NoteDraft | null) => void;
}) {
  const ops = useJournal();
  const save = useSaveFlow<JournalEntry>();
  const id = useId();
  const saved = entry?.body ?? '';
  const value = draft ? draft.text : saved;
  const dirty = !!draft && draft.text !== saved;
  const status: SaveState =
    save.state === 'saving' || save.state === 'error' ? save.state : dirty ? 'dirty' : save.state === 'saved' ? 'saved' : 'idle';

  const change = (text: string) => {
    onDraft({ text, baseVersion: draft?.baseVersion ?? entry?.version ?? 0, newId: draft?.newId ?? newId() });
    save.markDirty();
  };

  const submit = async () => {
    if (!draft) return;
    const body = draft.text.replace(/\s+$/, '');
    const result = await save.run(() =>
      entry ? ops.update(entry.id, { body }, draft.baseVersion) : ops.create({ id: draft.newId, dayId, authorId: author.id, body }),
    );
    if (result.ok) onDraft(null);
  };

  const name = (memberId: string | null) => members.find((m) => m.id === memberId)?.displayName;
  const writer = name(entry?.createdBy ?? null);
  const editor = name(entry?.updatedBy ?? null);
  const meta = entry
    ? [writer ? S.journal.writtenBy(writer) : '', editor && editor !== writer ? S.journal.editedBy(editor) : ''].filter(Boolean).join(', ')
    : '';

  return (
    <section className={styles.note} aria-labelledby={`${id}-h`} data-author={author.profileKey}>
      <div className={styles.noteHead}>
        <h3 id={`${id}-h`} className={styles.noteTitle}>
          {heading}
        </h3>
        <SaveStatus state={status} />
      </div>
      {save.conflict && (
        <ConflictBlock
          key={save.conflict.latest?.version ?? 0}
          latest={save.conflict.latest}
          me={me}
          partner={partner}
          onRebase={(l) => draft && onDraft({ ...draft, baseVersion: l.version })}
          renderLatest={(l) => <p className={form.latestBody}>{l.body}</p>}
          onUseLatest={() => {
            onDraft(null);
            save.clearConflict();
          }}
        />
      )}
      <label htmlFor={`${id}-t`} className="sr-only">
        {heading}
      </label>
      <TextArea
        id={`${id}-t`}
        rows={6}
        className={styles.noteText}
        placeholder={prompt}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => change(e.target.value)}
      />
      <div className={styles.noteFoot}>
        <span className={styles.noteMeta}>{meta}</span>
        <Button variant="primary" size="sm" busy={save.busy} disabled={!dirty} onClick={submit}>
          {S.journal.saveNotes}
        </Button>
      </div>
    </section>
  );
}
