'use client';
// Save / edit a link (plan §7.7): http(s) only, duplicate URLs point to the
// saved item, up to four pinned. Where it is used shows as tags; the links
// themselves are made on an itinerary plan (owner, 2026-11-01).
import { useState } from 'react';
import { CheckField, ConfirmDelete, ConflictBlock } from '@/components/checklist/FormBits';
import { useDraft } from '@/components/checklist/useDraft';
import { useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, Field, SaveStatus, Sheet, TextArea, TextInput, SegmentedControl } from '@/components/ui';
import { newId, useLibrary } from '@/lib/data';
import type { Member, Resource, ResourceCategory } from '@/lib/types';
import { S } from '@/lib/strings';
import type { LinkTag } from './ResourceCard';
import { findDuplicate, isHttpUrl, MAX_PINNED, nextPinSlot } from './libraryLogic';
import form from '@/components/checklist/Form.module.css';
import styles from './Library.module.css';

export const RESOURCE_CATEGORIES: ResourceCategory[] = ['maps_transport', 'places_dining', 'booking_guides', 'music_connections', 'other'];

interface Draft {
  id: string;
  version: number;
  url: string;
  title: string;
  category: ResourceCategory;
  note: string;
  pinned: boolean;
}

const toDraft = (r: Resource | null, category: ResourceCategory | null): Draft => ({
  id: r?.id ?? newId(),
  version: r?.version ?? 0,
  url: r?.url ?? '',
  title: r?.title ?? '',
  category: r?.category ?? category ?? 'other',
  note: r?.note ?? '',
  pinned: r ? r.pinnedOrder != null : false,
});

export function ResourceSheet({
  open,
  resource,
  category,
  resources,
  tags,
  me,
  partner,
  members,
  onClose,
  onOpenOther,
}: {
  open: boolean;
  resource: Resource | null;
  category: ResourceCategory | null;
  resources: Resource[];
  /** Where this resource is linked. */
  tags: LinkTag[];
  me: Member | null;
  partner: Member | null;
  members: Member[];
  onClose: () => void;
  onOpenOther: (id: string) => void;
}) {
  const lib = useLibrary();
  const [draft, patch] = useDraft<Draft>(open, resource?.id ?? null, () => toDraft(resource, category));
  const save = useSaveFlow<Resource>();
  const [tried, setTried] = useState(false);
  const isNew = !resource;

  const duplicate = isHttpUrl(draft.url) ? findDuplicate(draft.url, resources, resource?.id ?? null) : null;
  const pinnedOthers = resources.filter((r) => r.pinnedOrder != null && r.id !== resource?.id).length;
  const errors = {
    url: !isHttpUrl(draft.url) ? S.library.urlInvalid : null,
    title: draft.title.trim() ? null : S.library.titleRequired,
    pin: draft.pinned && pinnedOthers >= MAX_PINNED && resource?.pinnedOrder == null ? S.library.pinLimit : null,
  };
  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  const submit = async () => {
    setTried(true);
    if (errors.url || errors.title || errors.pin || duplicate) return;
    const others = resources.filter((r) => r.id !== resource?.id);
    const pinnedOrder = draft.pinned ? (resource?.pinnedOrder ?? nextPinSlot(others)) : null;
    const fields = { url: draft.url.trim(), title: draft.title.trim(), category: draft.category, note: draft.note.trim(), pinnedOrder };
    const result = await save.run(() => (isNew ? lib.create({ id: draft.id, ...fields }) : lib.update(draft.id, fields, draft.version)));
    if (result.ok) onClose();
  };

  const remove = async () => {
    if (!resource) return;
    const result = await save.run(() => lib.remove(resource.id, draft.version));
    if (result.ok) onClose();
  };

  const savedBy = resource?.createdBy ? members.find((m) => m.id === resource.createdBy)?.displayName : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? S.library.newLink : S.library.editLink}
      description={savedBy ? S.library.savedBy(savedBy) : undefined}
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
            onRebase={(l) => patch({ version: l.version })}
            renderLatest={(l) => <p className={form.latestBody}>{l.title}</p>}
            onUseLatest={(l) => patch(toDraft(l, null))}
          />
        )}
        <Field label={S.fields.url} error={tried || (draft.url && !isHttpUrl(draft.url) && draft.url.length > 8) ? (errors.url ?? undefined) : undefined}>
          <TextInput
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={draft.url}
            onChange={(e) => edit({ url: e.target.value })}
          />
        </Field>
        {duplicate && (
          <div className={form.latest} role="alert">
            <p>{S.library.duplicate(duplicate.title)}</p>
            <Button variant="secondary" size="sm" onClick={() => onOpenOther(duplicate.id)}>
              {S.library.openExisting}
            </Button>
          </div>
        )}
        <Field label={S.fields.title} error={tried ? (errors.title ?? undefined) : undefined}>
          <TextInput value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
        </Field>
        <Field label={S.fields.category}>
          <SegmentedControl
              label={S.fields.category}
              fill
              columns={3}
            value={draft.category}
            onChange={(v) => edit({ category: v as ResourceCategory })}
            options={RESOURCE_CATEGORIES.map((c) => ({ value: c, label: S.labels.resourceCategory[c] }))}
          />
        </Field>
        <Field label={S.fields.notes} optional hint={S.library.noteHint}>
          <TextArea rows={3} value={draft.note} onChange={(e) => edit({ note: e.target.value })} />
        </Field>
        <CheckField label={S.library.pinToTop} checked={draft.pinned} onChange={(pinned) => edit({ pinned })} />
        {tried && errors.pin && (
          <p className={form.error} role="alert">
            {errors.pin}
          </p>
        )}
        {!isNew && (
          <fieldset className={form.fieldset}>
            <legend className={form.legend}>{S.library.linkedTo}</legend>
            {tags.length > 0 && (
              <ul className={styles.sheetTags}>
                {tags.map((t) => (
                  <li key={t.id} className={styles.sheetTag}>
                    <button type="button" className={styles.tag} onClick={t.onClick}>
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className={form.hint}>{tags.length ? S.library.linkedHint : S.library.notLinked}</p>
          </fieldset>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
