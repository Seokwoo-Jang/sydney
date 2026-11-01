'use client';
// Travel documents (plan §7.4 C): name, who it is for, status, check-by date,
// reference link and one private file. No identity numbers are stored.
import { useState } from 'react';
import { Button, Field, SaveStatus, SegmentedControl, Sheet, TextInput } from '@/components/ui';
import { newId, useEntityOps } from '@/lib/data';
import type { Member, TripDocument } from '@/lib/types';
import { S } from '@/lib/strings';
import { isHttpUrl } from '@/components/library/libraryLogic';
import { DocumentFile } from './DocumentFile';
import { ConfirmDelete, ConflictBlock } from './FormBits';
import { useDraft } from './useDraft';
import { useSaveFlow } from './useSaveFlow';
import form from './Form.module.css';

interface Draft {
  id: string;
  version: number;
  title: string;
  subjectMemberId: string;
  status: TripDocument['status'];
  expiryOrDueDate: string;
  referenceUrl: string;
}

const toDraft = (d: TripDocument | null): Draft => ({
  id: d?.id ?? newId(),
  version: d?.version ?? 0,
  title: d?.title ?? '',
  subjectMemberId: d?.subjectMemberId ?? '',
  status: d?.status ?? 'needed',
  expiryOrDueDate: d?.expiryOrDueDate ?? '',
  referenceUrl: d?.referenceUrl ?? '',
});

export function DocumentSheet({
  open,
  doc,
  members,
  me,
  partner,
  onClose,
}: {
  open: boolean;
  doc: TripDocument | null;
  members: Member[];
  me: Member | null;
  partner: Member | null;
  onClose: () => void;
}) {
  const ops = useEntityOps('documents');
  const [draft, patch] = useDraft<Draft>(open, doc?.id ?? null, () => toDraft(doc));
  const save = useSaveFlow<TripDocument>();
  const [tried, setTried] = useState(false);
  const isNew = !doc;
  const errors = {
    title: draft.title.trim() ? null : S.checklist.titleRequired,
    url: !draft.referenceUrl.trim() || isHttpUrl(draft.referenceUrl) ? null : S.checklist.urlInvalid,
  };
  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  const submit = async () => {
    setTried(true);
    if (errors.title || errors.url) return;
    const fields = {
      title: draft.title.trim(),
      subjectMemberId: draft.subjectMemberId || null,
      status: draft.status,
      expiryOrDueDate: draft.expiryOrDueDate || null,
      referenceUrl: draft.referenceUrl.trim() || null,
    };
    const result = await save.run(() =>
      isNew ? ops.create({ id: draft.id, ...fields, assetId: null }) : ops.update(draft.id, fields, draft.version),
    );
    if (result.ok) onClose();
  };

  const remove = async () => {
    if (!doc) return;
    const result = await save.run(() => ops.remove(doc.id, draft.version));
    if (result.ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? S.checklist.newTitle.document : doc.title}
      headerExtra={<SaveStatus state={save.state} />}
      footer={
        <div className={form.footer}>
          {!isNew && <ConfirmDelete onConfirm={remove} busy={save.busy} />}
          <div className={form.footerEnd}>
            <Button variant="ghost" onClick={onClose}>
              {S.actions.cancel}
            </Button>
            <Button variant="primary" busy={save.busy} onClick={submit}>
              {S.actions.save}
            </Button>
          </div>
        </div>
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
        {save.conflict && (
          <ConflictBlock
            key={save.conflict.latest?.version ?? 0}
            latest={save.conflict.latest}
            me={me}
            partner={partner}
            onRebase={(latest) => patch({ version: latest.version })}
            renderLatest={(latest) => <p className={form.latestBody}>{latest.title}</p>}
            onUseLatest={(latest) => patch(toDraft(latest))}
          />
        )}
        <Field label={S.fields.title} error={tried ? errors.title : undefined} hint={S.checklist.sensitiveNote}>
          <TextInput value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
        </Field>
        <div className={form.grid2}>
          <Field label={S.checklist.subject}>
            <SegmentedControl
              label={S.checklist.subject}
              fill
              columns={3}
              value={draft.subjectMemberId}
              onChange={(v) => edit({ subjectMemberId: v })}
              options={[{ value: '', label: S.checklist.nobody }, ...members.map((m) => ({ value: m.id, label: m.displayName }))]}
            />
          </Field>
          <Field label={S.checklist.checkBy} optional>
            <TextInput type="date" value={draft.expiryOrDueDate} onChange={(e) => edit({ expiryOrDueDate: e.target.value })} />
          </Field>
        </div>
        <Field label={S.fields.status}>
          <SegmentedControl
            label={S.fields.status}
            fill
            size="sm"
            value={draft.status}
            onChange={(v) => edit({ status: v })}
            options={(['needed', 'in_progress', 'ready'] as const).map((v) => ({ value: v, label: S.labels.documentStatus[v] }))}
          />
        </Field>
        <Field label={S.checklist.referenceUrl} optional error={tried ? errors.url : undefined}>
          <TextInput type="url" inputMode="url" value={draft.referenceUrl} onChange={(e) => edit({ referenceUrl: e.target.value })} />
        </Field>
        <DocumentFile doc={doc} version={draft.version} onSaved={(row) => patch({ version: row.version })} />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
