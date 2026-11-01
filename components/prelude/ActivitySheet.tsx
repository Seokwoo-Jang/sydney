'use client';
// Add / edit a Prelude plan (plan §7.3): kind, title, notes, who to meet,
// Library links (several), status. Date, time and place belong to the linked
// itinerary item. Library links can be added here too (owner, 2026-11-01): on the
// itinerary they are saved onto its item (one set for both); before that, on the
// plan, moving to the item when it is linked. No "Add to itinerary" by design.
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
import { itemResourceIds, planResourceIds } from '@/components/itinerary/logic';
import { PickedList } from '@/components/checklist/FormBits';
import { whenLine } from './logic';
import styles from './prelude.module.css';

export type ActivityTarget = { kind: 'add' } | { kind: 'edit'; activity: PreludeActivity };

interface Draft {
  kind: PreludeKind;
  title: string;
  notes: string;
  peopleNote: string;
  resourceIds: string[];
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

/** The plan's Library links as the form shows them: its item's (on the itinerary) or its own. */
function linksOf(a: PreludeActivity | null, links: ResourceLink[], activities: PreludeActivity[], items: Map<string, ItineraryItem>): string[] {
  if (!a) return [];
  return a.itineraryItemId && items.has(a.itineraryItemId) ? itemResourceIds(a.itineraryItemId, links, activities) : planResourceIds(a.id, links);
}

function draftOf(a: PreludeActivity | null, resourceIds: string[]): Draft {
  return a
    ? { kind: a.kind, title: a.title, notes: a.notes, peopleNote: a.peopleNote, resourceIds, status: a.status }
    : { kind: 'performance', title: '', notes: '', peopleNote: '', resourceIds: [], status: 'idea' };
}

function initForm(target: ActivityTarget | null, opened: string[]): FormState {
  const row = target?.kind === 'edit' ? target.activity : null;
  const draft = draftOf(row, opened);
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

const same = (a: Draft, b: Draft) =>
  (Object.keys(a) as Array<keyof Draft>).every((k) => (k === 'resourceIds' ? a[k].join() === b[k].join() : a[k] === b[k]));

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
  const openedFor = (t: ActivityTarget | null) => linksOf(t?.kind === 'edit' ? t.activity : null, links, activities, items);
  const [form, setForm] = useState<FormState>(() => initForm(target, openedFor(target)));
  if (form.target !== target && target !== null) setForm(initForm(target, openedFor(target)));
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

  /**
   * Writes the Library links the form changed. On the itinerary they go onto the item
   * (and any the plan still held itself move there); otherwise they stay on the plan.
   * Only what changed since the form opened is written, so the other person's edits stand.
   */
  async function syncLibraryLinks(planId: string, itemId: string | null, opened: string[], wanted: string[]) {
    const live = new Set(resources.filter((r) => !r.deletedAt).map((r) => r.id));
    const want = wanted.filter((id) => live.has(id));
    const mine = links.filter((l) => l.preludeActivityId === planId);
    if (itemId) {
      const onItem = (id: string) => links.some((l) => l.itineraryItemId === itemId && l.resourceId === id);
      // New to the form, or still held by the plan itself (it moves onto the item now).
      for (const resourceId of want) {
        if (onItem(resourceId) || (opened.includes(resourceId) && !mine.some((l) => l.resourceId === resourceId))) continue;
        const r = await library.linkResource({ resourceId, itineraryItemId: itemId, preludeActivityId: null, documentId: null });
        if (!r.ok) return false;
      }
      // The item's links the user took out, and the plan's own rows that moved or were taken out.
      // Rows the other person added after the form opened are left alone.
      const drop = [
        ...links.filter((l) => l.itineraryItemId === itemId && opened.includes(l.resourceId) && !want.includes(l.resourceId)),
        ...mine.filter((l) => want.includes(l.resourceId) || opened.includes(l.resourceId)),
      ];
      for (const l of drop) {
        const r = await library.unlinkResource(l.id);
        if (!r.ok) return false;
      }
      return true;
    }
    for (const resourceId of want) {
      if (opened.includes(resourceId) || mine.some((l) => l.resourceId === resourceId)) continue;
      const r = await library.linkResource({ resourceId, preludeActivityId: planId, itineraryItemId: null, documentId: null });
      if (!r.ok) return false;
    }
    for (const l of mine) {
      if (!opened.includes(l.resourceId) || want.includes(l.resourceId)) continue;
      const r = await library.unlinkResource(l.id);
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
    // On the itinerary its Library links are saved onto the item: the one the saved row points at.
    const itemOf = (a: PreludeActivity | null) => (a?.itineraryItemId && items.has(a.itineraryItemId) ? a.itineraryItemId : null);
    const fields = {
      kind: d.kind,
      title: d.title.trim(),
      notes: d.notes.trim(),
      peopleNote: d.peopleNote.trim(),
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
    // The saved row says where the links go (it may have been linked or unlinked meanwhile);
    // only what the user changed since the form opened is written there.
    const itemId = itemOf(res.row);
    if (!(await syncLibraryLinks(res.row.id, itemId, f.initial.resourceIds, d.resourceIds))) {
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
    // Its own links: on the itinerary they move to its item (they were shown as the item's);
    // otherwise they go with it. Rows already on the item stay.
    const itemId = f.row.itineraryItemId && items.has(f.row.itineraryItemId) ? f.row.itineraryItemId : null;
    let linksOk = true;
    for (const l of links.filter((x) => x.preludeActivityId === f.row!.id)) {
      if (itemId && !links.some((x) => x.itineraryItemId === itemId && x.resourceId === l.resourceId)) {
        const r = await library.linkResource({ resourceId: l.resourceId, itineraryItemId: itemId, preludeActivityId: null, documentId: null });
        if (!r.ok) {
          linksOk = false;
          continue;
        }
      }
      if (!(await library.unlinkResource(l.id)).ok) linksOk = false;
    }
    if (!linksOk) toast.show(S.sync.failed, { tone: 'error' });
    toast.show(S.prelude.deleted);
    onClose();
  }

  const review = () =>
    setForm((s) => {
      const latest = s.conflict?.latest ?? null;
      return { ...s, baseVersion: latest?.version ?? s.baseVersion, conflict: null, save: 'dirty' };
    });

  const item = row?.itineraryItemId ? items.get(row.itineraryItemId) : undefined;
  const liveResources = resources.filter((r) => !r.deletedAt);
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
          <SegmentedControl
              label={S.prelude.kind}
              fill
              columns={3}
            value={draft.kind}
            onChange={(v) => set('kind', v as PreludeKind)}
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

        <Field label={S.prelude.library} optional hint={item ? S.prelude.libraryOnItem : undefined}>
          <PickedList
            ids={draft.resourceIds}
            label={(id) => liveResources.find((r) => r.id === id)?.title ?? null}
            removeLabel={S.budget.removeLink}
            onRemove={(id) =>
              set(
                'resourceIds',
                draft.resourceIds.filter((x) => x !== id),
              )
            }
          />
          <Select
            value=""
            disabled={!liveResources.some((r) => !draft.resourceIds.includes(r.id))}
            onChange={(e) => e.target.value && set('resourceIds', [...draft.resourceIds, e.target.value])}
            options={[
              { value: '', label: liveResources.length ? S.prelude.addLibraryLink : S.prelude.none },
              ...liveResources.filter((r) => !draft.resourceIds.includes(r.id)).map((r) => ({ value: r.id, label: r.title })),
            ]}
          />
        </Field>
      </form>
    </Sheet>
  );
}
