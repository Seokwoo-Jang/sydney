'use client';
// Add / edit one Packing item or To-do (plan §7.4 A–B).
import { useMemo, useState } from 'react';
import { Button, Field, SaveStatus, SegmentedControl, Select, Sheet, TextArea, TextInput } from '@/components/ui';
import { newId, PACKING_CATEGORIES, TASK_CATEGORIES, useChecklist } from '@/lib/data';
import type { Booking, ChecklistItem, ChecklistKind, Member, Resource } from '@/lib/types';
import { S } from '@/lib/strings';
import { CheckField, ConfirmDelete, ConflictBlock } from './FormBits';
import { useDraft } from './useDraft';
import { useSaveFlow } from './useSaveFlow';
import form from './Form.module.css';

type Assignee = 'eren' | 'amy' | 'both';

interface Draft {
  id: string;
  version: number;
  title: string;
  category: string;
  assignee: Assignee;
  quantity: string;
  dueDate: string;
  priority: ChecklistItem['priority'];
  checked: boolean;
  isApplicable: boolean;
  notes: string;
}

function toDraft(item: ChecklistItem | null, kind: ChecklistKind, category: string | null, me: Member | null): Draft {
  return {
    id: item?.id ?? newId(),
    version: item?.version ?? 0,
    title: item?.title ?? '',
    category: item?.category ?? category ?? (kind === 'packing' ? PACKING_CATEGORIES[0] : TASK_CATEGORIES[0]),
    assignee: (item ? (item.assignee ?? 'both') : (me?.profileKey ?? 'both')) as Assignee,
    quantity: item?.quantity != null ? String(item.quantity) : '',
    dueDate: item?.dueDate ?? '',
    priority: item?.priority ?? 'normal',
    checked: item?.checked ?? false,
    isApplicable: item?.isApplicable ?? true,
    notes: item?.notes ?? '',
  };
}

export function ChecklistItemSheet({
  open,
  kind,
  item,
  category,
  me,
  partner,
  bookings,
  resources,
  onClose,
  onOpenBooking,
}: {
  open: boolean;
  kind: ChecklistKind;
  item: ChecklistItem | null;
  /** Default category for a new row. */
  category: string | null;
  me: Member | null;
  partner: Member | null;
  bookings: Booking[];
  resources: Resource[];
  onClose: () => void;
  onOpenBooking: (id: string) => void;
}) {
  const ops = useChecklist();
  const [draft, patch] = useDraft<Draft>(open, item?.id ?? null, () => toDraft(item, kind, category, me));
  const save = useSaveFlow<ChecklistItem>();
  const [tried, setTried] = useState(false);
  const isNew = !item;
  const k = item?.kind ?? kind;

  const categories = k === 'packing' ? PACKING_CATEGORIES : TASK_CATEGORIES;
  const labels: Record<string, string> = k === 'packing' ? S.labels.packingCategories : S.labels.taskCategories;
  const qty = draft.quantity.trim() ? Number(draft.quantity) : null;
  const errors = {
    title: draft.title.trim() ? null : S.checklist.titleRequired,
    quantity: qty === null || (Number.isInteger(qty) && qty >= 1) ? null : S.checklist.quantityInvalid,
  };
  const valid = !errors.title && !errors.quantity;

  const assigneeOptions = useMemo(() => {
    const name = (m: Member | null, fallback: 'eren' | 'amy') => (m ? m.displayName : S.people.participants[fallback]);
    const meKey = me?.profileKey ?? 'eren';
    const partnerKey = meKey === 'eren' ? 'amy' : 'eren';
    return [
      { value: meKey, label: `${name(me, meKey)} (${S.people.me})` },
      { value: partnerKey, label: name(partner, partnerKey) },
      { value: 'both', label: S.people.shared },
    ];
  }, [me, partner]);

  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  const submit = async () => {
    setTried(true);
    if (!valid) return;
    const fields = {
      title: draft.title.trim(),
      category: draft.category,
      assignee: draft.assignee,
      quantity: k === 'packing' ? qty : null,
      dueDate: k === 'task' ? draft.dueDate || null : null,
      priority: draft.priority,
      checked: draft.checked,
      isApplicable: draft.isApplicable,
      notes: draft.notes.trim(),
    };
    const result = await save.run(() =>
      isNew
        ? ops.create({
            id: draft.id,
            kind: k,
            ...fields,
            bookingId: null,
            documentId: null,
            resourceId: null,
            sortOrder: (ops.status === 'ready' ? Math.max(0, ...ops.data.map((r) => r.sortOrder)) : 0) + 10,
          })
        : ops.update(draft.id, fields, draft.version),
    );
    if (result.ok) onClose();
  };

  const remove = async () => {
    if (!item) return;
    const result = await save.run(() => ops.remove(item.id, draft.version));
    if (result.ok) onClose();
  };

  const booking = item?.bookingId ? bookings.find((b) => b.id === item.bookingId) : null;
  const resource = item?.resourceId ? resources.find((r) => r.id === item.resourceId) : null;
  const title = isNew
    ? k === 'packing'
      ? S.checklist.newPacking
      : S.checklist.newTask
    : k === 'packing'
      ? S.checklist.editPacking
      : S.checklist.editTask;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
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
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {save.conflict && (
          <ConflictBlock
            key={save.conflict.latest?.version ?? 0}
            latest={save.conflict.latest}
            me={me}
            partner={partner}
            onRebase={(latest) => patch({ version: latest.version })}
            renderLatest={(latest) => <p className={form.latestBody}>{latest.title}</p>}
            onUseLatest={(latest) => {
              patch({ ...toDraft(latest, k, null, me) });
            }}
          />
        )}
        <Field label={S.fields.title} error={tried ? errors.title : undefined}>
          <TextInput value={draft.title} onChange={(e) => edit({ title: e.target.value })} autoComplete="off" required />
        </Field>
        <div className={form.grid2}>
          <Field label={S.fields.category}>
            <Select
              value={draft.category}
              onChange={(e) => edit({ category: e.target.value })}
              options={categories.map((c) => ({ value: c, label: labels[c] }))}
            />
          </Field>
          <Field label={S.fields.assignee}>
            <Select value={draft.assignee} onChange={(e) => edit({ assignee: e.target.value as Assignee })} options={assigneeOptions} />
          </Field>
        </div>
        {k === 'packing' ? (
          <Field label={S.fields.quantity} optional error={tried ? errors.quantity : undefined}>
            <TextInput
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => edit({ quantity: e.target.value.replace(/[^\d]/g, '') })}
            />
          </Field>
        ) : (
          <div className={form.grid2}>
            <Field label={S.fields.dueDate} optional>
              <TextInput type="date" value={draft.dueDate} onChange={(e) => edit({ dueDate: e.target.value })} />
            </Field>
            <Field label={S.checklist.priority}>
              <SegmentedControl<Draft['priority']>
                label={S.checklist.priority}
                size="sm"
                fill
                value={draft.priority}
                onChange={(priority) => edit({ priority })}
                options={(['low', 'normal', 'high'] as const).map((p) => ({ value: p, label: S.checklist.priorities[p] }))}
              />
            </Field>
          </div>
        )}
        <Field label={S.fields.notes} optional>
          <TextArea rows={3} value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />
        </Field>
        <CheckField
          label={k === 'packing' ? S.labels.packed : S.labels.done}
          checked={draft.checked}
          onChange={(checked) => edit({ checked })}
        />
        <CheckField
          label={S.checklist.markNotNeeded}
          hint={S.checklist.notNeededHint}
          checked={!draft.isApplicable}
          onChange={(na) => edit({ isApplicable: !na })}
        />
        {(booking || resource) && (
          <div className={form.related}>
            {booking && (
              <Button variant="secondary" size="sm" iconStart="plane" onClick={() => onOpenBooking(booking.id)}>
                {S.checklist.relatedBooking}: {booking.title}
              </Button>
            )}
            {resource && (
              <a className={form.hint} href={resource.url} target="_blank" rel="noopener noreferrer">
                {S.checklist.relatedLink}: {resource.title}
                <span className="sr-only"> ({S.ui.externalLink})</span>
              </a>
            )}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
