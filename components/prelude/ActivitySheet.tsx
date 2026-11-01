'use client';
// Add / edit a Prelude plan (plan §7.3): kind, title, notes, who to meet,
// Library link, status. Date, time and place belong to the linked itinerary
// item and are only shown here. No "Add to itinerary" by design.
import { useRef, useState, type FormEvent } from 'react';
import {
  Button,
  ConflictNotice,
  Field,
  SaveStatus,
  SegmentedControl,
  Select,
  Sheet,
  TextArea,
  TextInput,
  useToast,
  type SaveState,
} from '@/components/ui';
import { newId, useEntityOps, useLibrary } from '@/lib/data';
import { S } from '@/lib/strings';
import type { ItineraryItem, Member, PreludeActivity, PreludeKind, PreludeStatus, Resource, ResourceLink, TripDay } from '@/lib/types';
import { whenLine } from './logic';
import styles from './prelude.module.css';

export type ActivityTarget = { kind: 'add' } | { kind: 'edit'; activity: PreludeActivity };

interface Draft {
  kind: PreludeKind;
  title: string;
  notes: string;
  peopleNote: string;
  resourceId: string;
  status: PreludeStatus;
}

interface FormState {
  target: ActivityTarget | null;
  draft: Draft;
  initial: Draft;
  row: PreludeActivity | null;
  baseVersion: number;
  createId: string;
  save: SaveState;
  conflict: { latest: PreludeActivity | null } | null;
  confirm: 'delete' | 'discard' | null;
  tried: boolean;
}

const KINDS: PreludeKind[] = ['networking', 'performance', 'venue_visit', 'lesson', 'other'];
const STATUSES: PreludeStatus[] = ['idea', 'planned', 'done'];

function draftOf(a: PreludeActivity | null): Draft {
  return a
    ? { kind: a.kind, title: a.title, notes: a.notes, peopleNote: a.peopleNote, resourceId: a.resourceId ?? '', status: a.status }
    : { kind: 'performance', title: '', notes: '', peopleNote: '', resourceId: '', status: 'idea' };
}

function initForm(target: ActivityTarget | null): FormState {
  const row = target?.kind === 'edit' ? target.activity : null;
  const draft = draftOf(row);
  return {
    target,
    draft,
    initial: draft,
    row,
    baseVersion: row?.version ?? 0,
    createId: newId(),
    save: 'idle',
    conflict: null,
    confirm: null,
    tried: false,
  };
}

const same = (a: Draft, b: Draft) => (Object.keys(a) as Array<keyof Draft>).every((k) => a[k] === b[k]);

export function ActivitySheet({
  target,
  activities,
  items,
  days,
  resources,
  links,
  tripTz,
  me,
  partner,
  onClose,
  onViewItinerary,
}: {
  target: ActivityTarget | null;
  activities: PreludeActivity[];
  items: Map<string, ItineraryItem>;
  days: TripDay[];
  resources: Resource[];
  links: ResourceLink[];
  tripTz: string;
  me: Member | null;
  partner: Member | null;
  onClose: () => void;
  onViewItinerary: (item: ItineraryItem) => void;
}) {
  const ops = useEntityOps('prelude');
  const library = useLibrary();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initForm(target));
  if (form.target !== target && target !== null) setForm(initForm(target));
  const formRef = useRef(form);
  formRef.current = form;

  const { draft, row } = form;
  const busy = form.save === 'saving';
  const dirty = !same(draft, form.initial);
  const titleError = !draft.title.trim() ? S.prelude.titleRequired : null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((f) => ({ ...f, draft: { ...f.draft, [key]: value }, save: f.save === 'saved' ? 'idle' : f.save }));

  const requestClose = () => {
    if (busy) return;
    if (dirty && form.confirm !== 'discard') {
      setForm((f) => ({ ...f, confirm: 'discard' }));
      return;
    }
    onClose();
  };

  /** Keeps resource_links in step with the single Library link on the plan. */
  async function syncLibraryLink(activityId: string, before: string | null, after: string | null) {
    if (before === after) return true;
    for (const l of links) {
      if (l.preludeActivityId === activityId && l.resourceId === before) {
        const r = await library.unlinkResource(l.id);
        if (!r.ok) return false;
      }
    }
    if (after && !links.some((l) => l.preludeActivityId === activityId && l.resourceId === after)) {
      const r = await library.linkResource({ resourceId: after, preludeActivityId: activityId, itineraryItemId: null, documentId: null });
      if (!r.ok) return false;
    }
    return true;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const f = formRef.current;
    if (busy) return;
    if (titleError) {
      setForm((s) => ({ ...s, tried: true }));
      return;
    }
    const d = f.draft;
    const fields = {
      kind: d.kind,
      title: d.title.trim(),
      notes: d.notes.trim(),
      peopleNote: d.peopleNote.trim(),
      resourceId: d.resourceId || null,
      status: d.status,
    };
    setForm((s) => ({ ...s, save: 'saving', tried: true, confirm: null }));
    const res = f.row
      ? await ops.update(f.row.id, fields, f.baseVersion)
      : await ops.create({
          ...fields,
          id: f.createId,
          itineraryItemId: null,
          sortOrder: Math.max(0, ...activities.map((a) => a.sortOrder)) + 10,
          isExample: false,
        });
    if (!res.ok) {
      setForm((s) => ({ ...s, save: res.reason === 'conflict' ? 'dirty' : 'error', conflict: res.reason === 'conflict' ? { latest: res.latest } : s.conflict }));
      return;
    }
    setForm((s) => ({ ...s, row: res.row, baseVersion: res.row.version, conflict: null }));
    if (!(await syncLibraryLink(res.row.id, f.row?.resourceId ?? null, res.row.resourceId))) {
      setForm((s) => ({ ...s, save: 'error' }));
      return;
    }
    setForm((s) => ({ ...s, save: 'saved', initial: s.draft }));
    toast.show(S.sync.saved);
    onClose();
  }

  async function remove() {
    const f = formRef.current;
    if (!f.row || busy) return;
    setForm((s) => ({ ...s, save: 'saving', confirm: null }));
    const res = await ops.remove(f.row.id, f.baseVersion);
    if (!res.ok) {
      setForm((s) => ({ ...s, save: res.reason === 'conflict' ? 'dirty' : 'error', conflict: res.reason === 'conflict' ? { latest: res.latest } : s.conflict }));
      return;
    }
    await syncLibraryLink(f.row.id, f.row.resourceId, null);
    toast.show(S.prelude.deleted);
    onClose();
  }

  const review = () =>
    setForm((s) => {
      const latest = s.conflict?.latest ?? null;
      return { ...s, baseVersion: latest?.version ?? s.baseVersion, conflict: null, save: 'dirty' };
    });

  const item = row?.itineraryItemId ? items.get(row.itineraryItemId) : undefined;
  const resourceOptions = [
    { value: '', label: S.prelude.none },
    ...resources.filter((r) => !r.deletedAt).map((r) => ({ value: r.id, label: r.title })),
  ];
  const conflictSource = form.conflict?.latest && me && form.conflict.latest.updatedBy === me.id ? 'ownDevice' : 'partner';

  const footer =
    form.confirm ? (
      <div className={styles.confirm}>
        <p className={styles.confirmText}>{form.confirm === 'delete' ? S.prelude.deleteConfirm : S.itinerary.discardConfirm}</p>
        <Button variant="ghost" onClick={() => setForm((s) => ({ ...s, confirm: null }))}>
          {form.confirm === 'delete' ? S.actions.cancel : S.actions.keepEditing}
        </Button>
        {form.confirm === 'delete' ? (
          <Button variant="danger" onClick={() => void remove()} busy={busy}>
            {S.actions.delete}
          </Button>
        ) : (
          <Button variant="danger" onClick={onClose}>
            {S.itinerary.discard}
          </Button>
        )}
      </div>
    ) : (
      <div className={styles.footerRow}>
        {row && (
          <Button variant="ghost" className={styles.deleteButton} onClick={() => setForm((s) => ({ ...s, confirm: 'delete' }))} disabled={busy}>
            {S.actions.delete}
          </Button>
        )}
        <Button variant="ghost" onClick={requestClose} disabled={busy}>
          {S.actions.cancel}
        </Button>
        <Button variant="primary" type="submit" form="prelude-plan-form" busy={busy}>
          {busy ? S.actions.saving : S.actions.save}
        </Button>
      </div>
    );

  return (
    <Sheet
      open={target !== null}
      onClose={requestClose}
      title={row ? S.prelude.editTitle : S.prelude.addTitle}
      description={row ? row.title : S.sections.prelude.intro}
      headerExtra={<SaveStatus state={form.save === 'idle' && dirty ? 'dirty' : form.save} className={styles.status} />}
      footer={footer}
    >
      <form id="prelude-plan-form" className={styles.form} onSubmit={(e) => void save(e)} noValidate>
        {form.conflict && (
          <ConflictNotice
            source={conflictSource}
            partnerName={partner?.displayName}
            onReview={review}
            onDismiss={() => setForm((s) => ({ ...s, conflict: null }))}
          />
        )}

        <div className={styles.onItinerary}>
          <p className={styles.onItineraryText}>
            {item ? whenLine(item, days, tripTz) : S.prelude.notOnItinerary}
            {item?.place ? <span className={styles.place}>{item.place}</span> : null}
          </p>
          <p className={styles.hint}>{S.prelude.itineraryHint}</p>
          {item && (
            <Button variant="link" size="sm" iconStart="itinerary" onClick={() => onViewItinerary(item)}>
              {S.prelude.viewItinerary}
            </Button>
          )}
        </div>

        <Field label={S.fields.title} error={form.tried ? titleError : null}>
          <TextInput value={draft.title} onChange={(e) => set('title', e.target.value)} autoComplete="off" required />
        </Field>

        <Field label={S.prelude.kind}>
          <Select
            value={draft.kind}
            onChange={(e) => set('kind', e.target.value as PreludeKind)}
            options={KINDS.map((k) => ({ value: k, label: S.labels.preludeKind[k] }))}
          />
        </Field>

        <div className={styles.group}>
          <p className={styles.groupLabel} aria-hidden="true">
            {S.fields.status}
          </p>
          <SegmentedControl
            label={S.fields.status}
            fill
            value={draft.status}
            onChange={(v) => set('status', v)}
            options={STATUSES.map((s) => ({ value: s, label: S.labels.preludeStatus[s] }))}
          />
          <p className={styles.hint}>{S.prelude.statusHint}</p>
        </div>

        <Field label={S.prelude.notes} optional hint={S.prelude.notesHint}>
          <TextArea value={draft.notes} onChange={(e) => set('notes', e.target.value)} rows={4} />
        </Field>

        <Field label={S.prelude.people} optional hint={S.prelude.peopleHint}>
          <TextInput value={draft.peopleNote} onChange={(e) => set('peopleNote', e.target.value)} autoComplete="off" />
        </Field>

        <Field label={S.prelude.library} optional>
          <Select value={draft.resourceId} onChange={(e) => set('resourceId', e.target.value)} options={resourceOptions} />
        </Field>
      </form>
    </Sheet>
  );
}
