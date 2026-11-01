'use client';
// Add / edit one itinerary item (plan §7.2, §7.2.5, §7.3, §8.2).
// Saves with the version the form was opened with; a conflict keeps the draft.
// Prelude links follow §7.3: Idea item → activity Idea, Planned/Confirmed →
// Planned, unlink/delete → Idea. Done is never overwritten.
// Every link starts here (owner, 2026-11-01): the Prelude plan and the Library
// links of this item. Amy's Prelude and the Library only show them.
import { useRef, useState, type FormEvent } from 'react';
import {
  Button,
  ConflictNotice,
  Field,
  IconButton,
  SaveStatus,
  SegmentedControl,
  Select,
  Sheet,
  TextArea,
  TextInput,
  useToast,
  type SaveState,
  type SelectOption,
} from '@/components/ui';
import { newId, useEntityOps, useLibrary, useMapLinkResolver, useServerManagesPreludeStatus, type ResolvedMapLink } from '@/lib/data';
import { needsLookup, parseMapUrl, type MapLinkResult } from '@/lib/maps';
import { formatWallTime, S } from '@/lib/strings';
import { addDays, formatDayLabel } from '@/lib/time/zone';
import type {
  ItineraryCategory,
  ItineraryItem,
  ItineraryStatus,
  MapSource,
  Member,
  Participants,
  PreludeActivity,
  Resource,
  ResourceLink,
  TimeKind,
  TripDay,
} from '@/lib/types';
import { activityPatchesForItem, itemResourceIds, libraryLinkChanges, type ActivityPatch } from './logic';
import styles from './ItemSheet.module.css';

export type SheetTarget = { kind: 'add'; date: string } | { kind: 'edit'; item: ItineraryItem };

/** Server lookup for the link in the form (short / place links only). */
type Lookup =
  | { url: string; status: 'resolving'; promise: Promise<ResolvedMapLink | null> }
  | { url: string; status: 'found'; lat: number; lng: number }
  | { url: string; status: 'none' };

interface Draft {
  title: string;
  date: string;
  timeKind: TimeKind;
  startTime: string;
  endTime: string;
  timezone: string;
  category: ItineraryCategory;
  participants: Participants;
  status: ItineraryStatus;
  place: string;
  mapUrl: string;
  detail: string;
  activityId: string;
  /** Library links, in the order they were added. */
  resourceIds: string[];
}

interface FormState {
  target: SheetTarget | null;
  draft: Draft;
  initial: Draft;
  row: ItineraryItem | null;
  baseVersion: number;
  createId: string;
  save: SaveState;
  conflict: { latest: ItineraryItem | null } | null;
  /** Set after "Review latest": the stored row (null = removed elsewhere). */
  reviewed: { item: ItineraryItem | null } | null;
  confirm: 'delete' | 'discard' | null;
  tried: boolean;
  /** The item's own Library links when the form opened (changes are written against these). */
  openedLinks: string[];
}

const CATEGORIES: ItineraryCategory[] = ['transport', 'explore', 'dining', 'rest', 'business'];
// Idea → Planned → Fixed. Completed comes from the clock (shownStatus) and a
// cancelled plan is deleted instead; an older row keeps its value as an option.
const STATUSES: ItineraryStatus[] = ['idea', 'planned', 'confirmed'];
const KINDS: TimeKind[] = ['timed', 'all_day', 'unscheduled'];

function draftFrom(target: SheetTarget, tripTz: string, activities: PreludeActivity[], links: ResourceLink[]): Draft {
  if (target.kind === 'add') {
    return {
      title: '',
      date: target.date,
      timeKind: 'timed',
      startTime: '',
      endTime: '',
      timezone: tripTz,
      category: 'explore',
      participants: 'together',
      status: 'planned',
      place: '',
      mapUrl: '',
      detail: '',
      activityId: '',
      resourceIds: [],
    };
  }
  const i = target.item;
  return {
    title: i.title,
    date: i.date,
    timeKind: i.timeKind,
    startTime: i.startTime ?? '',
    endTime: i.endTime ?? '',
    timezone: i.timezone,
    category: i.category,
    participants: i.participants,
    status: i.status,
    place: i.place,
    mapUrl: i.mapUrl ?? '',
    detail: i.detail,
    activityId: activities.find((a) => !a.deletedAt && a.itineraryItemId === i.id)?.id ?? '',
    resourceIds: itemResourceIds(i.id, links, activities),
  };
}

function initForm(target: SheetTarget | null, tripTz: string, activities: PreludeActivity[], links: ResourceLink[], fallbackDate: string): FormState {
  const draft = draftFrom(target ?? { kind: 'add', date: fallbackDate }, tripTz, activities, links);
  const row = target?.kind === 'edit' ? target.item : null;
  return {
    target,
    draft,
    initial: draft,
    row,
    baseVersion: row?.version ?? 0,
    createId: newId(),
    save: 'idle',
    conflict: null,
    reviewed: null,
    confirm: null,
    tried: false,
    openedLinks: row ? links.filter((l) => l.itineraryItemId === row.id).map((l) => l.resourceId) : [],
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as Array<keyof Draft>).every((k) => {
    const x = a[k];
    const y = b[k];
    return Array.isArray(x) && Array.isArray(y) ? x.join() === y.join() : x === y;
  });
}

export function ItemSheet({
  target,
  days,
  items,
  activities,
  resources,
  resourceLinks,
  tripTz,
  homeTz,
  me,
  partner,
  onClose,
  onSaved,
}: {
  target: SheetTarget | null;
  days: TripDay[];
  items: ItineraryItem[];
  activities: PreludeActivity[];
  /** Saved Library links, live ones. */
  resources: Resource[];
  resourceLinks: ResourceLink[];
  tripTz: string;
  homeTz: string;
  me: Member | null;
  partner: Member | null;
  onClose: () => void;
  onSaved: (row: ItineraryItem) => void;
}) {
  const itemOps = useEntityOps('itinerary');
  const activityOps = useEntityOps('prelude');
  const library = useLibrary();
  const serverManaged = useServerManagesPreludeStatus();
  const toast = useToast();
  const fallbackDate = days[0]?.date ?? '';
  const resolveLink = useMapLinkResolver();
  const [form, setForm] = useState<FormState>(() => initForm(target, tripTz, activities, resourceLinks, fallbackDate));
  const [lookup, setLookup] = useState<Lookup | null>(null);
  // Reset when a different target opens (derived state, no effect).
  if (form.target !== target && target !== null) {
    setForm(initForm(target, tripTz, activities, resourceLinks, fallbackDate));
    setLookup(null);
  }
  const formRef = useRef(form);
  formRef.current = form;
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { draft, row } = form;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((f) => ({ ...f, draft: { ...f.draft, [key]: value }, save: f.save === 'saved' ? 'idle' : f.save }));

  const busy = form.save === 'saving';
  const dirty = !sameDraft(draft, form.initial);
  const timed = draft.timeKind === 'timed';
  const mapCheck = draft.mapUrl.trim() ? parseMapUrl(draft.mapUrl) : null;
  const errors = {
    title: !draft.title.trim() ? S.itinerary.titleRequired : null,
    start: timed && !draft.startTime ? S.itinerary.startRequired : null,
    map: mapCheck && !mapCheck.ok ? S.maps.notAMapLink : null,
  };
  const invalid = Boolean(errors.title || errors.start || errors.map);
  const storedLink = row?.mapUrl ? parseMapUrl(row.mapUrl) : null;
  const mapHint = !mapCheck?.ok
    ? S.maps.linkHint
    : mapCheck.lat !== null
      ? S.maps.locatedFromLink
      : storedLink?.ok && storedLink.url === mapCheck.url && row?.mapLat != null
        ? S.maps.keptLocation
        : lookup?.url === mapCheck.url
          ? lookup.status === 'resolving'
            ? S.maps.locating
            : lookup.status === 'found'
              ? S.maps.located
              : S.maps.noLocation
          : needsLookup(mapCheck)
            ? lookupTimer.current
              ? S.maps.locating
              : S.maps.lookupOnSave
            : S.maps.noLocation;
  const endsNextDay = timed && draft.startTime && draft.endTime && draft.endTime <= draft.startTime;

  const requestClose = () => {
    if (busy) return;
    if (dirty && form.confirm !== 'discard') {
      setForm((f) => ({ ...f, confirm: 'discard' }));
      return;
    }
    onClose();
  };

  // ── map link → coordinates (plan §7.2.5, §7.2.7) ─────────────
  function startLookup(url: string): Promise<ResolvedMapLink | null> {
    const promise = resolveLink(url);
    setLookup({ url, status: 'resolving', promise });
    void promise.then((r) => {
      setLookup((l) => (l?.url !== url ? l : r ? { url, status: 'found', lat: r.lat, lng: r.lng } : { url, status: 'none' }));
      // Fill an empty Location with the place name the link points to.
      if (r?.name) {
        const name = r.name;
        setForm((f) => {
          const now = f.draft.mapUrl.trim() ? parseMapUrl(f.draft.mapUrl) : null;
          return now?.ok && now.url === url && !f.draft.place.trim() ? { ...f, draft: { ...f.draft, place: name } } : f;
        });
      }
    });
    return promise;
  }

  /** Waits briefly after typing, then looks up links whose address has no coordinates. */
  function scheduleLookup(value: string) {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const parsed = value.trim() ? parseMapUrl(value) : null;
    if (!parsed?.ok || !needsLookup(parsed)) {
      setLookup(null);
      return;
    }
    if (lookupRef.current?.url === parsed.url) return;
    const url = parsed.url;
    lookupTimer.current = setTimeout(() => void startLookup(url), 500);
  }

  /**
   * Coordinates for a saved link: from the address itself, else the row's own
   * (same link as stored), else a server lookup (awaited when still running).
   */
  async function linkCoords(
    link: Extract<MapLinkResult, { ok: true }>,
    current: ItineraryItem | null,
  ): Promise<{ lat: number; lng: number; source: MapSource; name: string | null } | null> {
    if (link.lat !== null && link.lng !== null) return { lat: link.lat, lng: link.lng, source: 'link', name: null };
    // Same link as stored: keep the stored spot and where it came from (link, pin or search).
    const stored = current?.mapUrl ? parseMapUrl(current.mapUrl) : null;
    if (stored?.ok && stored.url === link.url && current?.mapLat != null && current.mapLng != null) {
      return { lat: current.mapLat, lng: current.mapLng, source: current.mapSource ?? 'link', name: null };
    }
    if (!needsLookup(link)) return null;
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const l = lookupRef.current;
    if (l?.url === link.url && l.status === 'found') return { lat: l.lat, lng: l.lng, source: 'link', name: null };
    // 'resolving' is awaited; nothing yet or an earlier miss (maybe a network error) is tried again.
    const r = await (l?.url === link.url && l.status === 'resolving' ? l.promise : startLookup(link.url));
    return r ? { lat: r.lat, lng: r.lng, source: 'link', name: r.name } : null;
  }

  // ── writes ────────────────────────────────────────────────────
  // Library links are written so a failure never loses one: new links first, then the
  // Prelude plan's own link is cleared (it moved onto this item), then removals.
  const linkChanges = (itemId: string, opened: string[], wanted: string[]) => {
    const live = new Set(resources.map((r) => r.id));
    return libraryLinkChanges(itemId, opened, wanted.filter((id) => live.has(id)), resourceLinks);
  };

  async function addLibraryLinks(itemId: string, opened: string[], wanted: string[]): Promise<boolean> {
    for (const resourceId of linkChanges(itemId, opened, wanted).add) {
      const r = await library.linkResource({ resourceId, itineraryItemId: itemId, preludeActivityId: null, documentId: null });
      if (!r.ok) return false;
    }
    return true;
  }

  /** The chosen plan's own Library link has moved onto this item: clear it on the plan (latest version). */
  async function clearPlanLink(planId: string | null, latest: Map<string, PreludeActivity>): Promise<boolean> {
    const plan = planId ? (latest.get(planId) ?? activities.find((a) => a.id === planId && !a.deletedAt)) : undefined;
    if (!plan?.resourceId) return true;
    let res = await activityOps.update(plan.id, { resourceId: null }, plan.version);
    if (!res.ok && res.reason === 'conflict' && res.latest) {
      if (!res.latest.resourceId) return true;
      res = await activityOps.update(res.latest.id, { resourceId: null }, res.latest.version);
    }
    return res.ok;
  }

  /** Links the chosen plan (its status follows the item) and clears its own Library link, now on the item. */
  async function linkPlan(itemId: string, itemStatus: ItineraryStatus, selected: string | null): Promise<boolean> {
    const saved = await applyActivityPatches(activityPatchesForItem(itemId, itemStatus, activities, selected, serverManaged), itemId, itemStatus, selected);
    return saved !== null && (await clearPlanLink(selected, saved));
  }

  async function removeLibraryLinks(itemId: string, opened: string[], wanted: string[], planId: string | null): Promise<boolean> {
    const copies = planId ? resourceLinks.filter((l) => l.preludeActivityId === planId).map((l) => l.id) : [];
    for (const id of [...linkChanges(itemId, opened, wanted).remove, ...copies]) {
      const r = await library.unlinkResource(id);
      if (!r.ok) return false;
    }
    return true;
  }

  /** Writes the plan link changes; the rows as saved, or null when one failed. */
  async function applyActivityPatches(
    patches: ActivityPatch[],
    itemId: string,
    itemStatus: ItineraryStatus | null,
    selected: string | null,
  ): Promise<Map<string, PreludeActivity> | null> {
    const saved = new Map<string, PreludeActivity>();
    for (const { activity, patch } of patches) {
      let res = await activityOps.update(activity.id, patch, activity.version);
      if (!res.ok && res.reason === 'conflict' && res.latest) {
        // System-derived link change: re-derive on the latest row and apply once more.
        const retry = activityPatchesForItem(itemId, itemStatus, [res.latest], selected, serverManaged)[0];
        if (!retry) continue;
        res = await activityOps.update(res.latest.id, retry.patch, res.latest.version);
      }
      if (!res.ok) return null;
      saved.set(res.row.id, res.row);
    }
    return saved;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const f = formRef.current;
    if (busy) return;
    if (invalid) {
      setForm((s) => ({ ...s, tried: true }));
      return;
    }
    const d = f.draft;
    const day = days.find((x) => x.date === d.date) ?? days[0];
    const isTimed = d.timeKind === 'timed';
    const parsed = d.mapUrl.trim() ? parseMapUrl(d.mapUrl) : null;
    const link = parsed?.ok ? parsed : null;
    // Without a link, a spot set earlier by pin or place search stays.
    const keptSpot = !link && (f.row?.mapSource === 'pin' || f.row?.mapSource === 'search') && f.row.mapLat != null ? f.row : null;
    // The form is locked while saving (fieldset below), so `d` cannot go stale during the lookup.
    setForm((s) => ({ ...s, save: 'saving', tried: true, confirm: null }));
    const coords = link ? await linkCoords(link, f.row) : null;
    const fields = {
      dayId: day.id,
      date: day.date,
      timeKind: d.timeKind,
      startTime: isTimed ? d.startTime : null,
      endTime: isTimed && d.endTime ? d.endTime : null,
      endDate: isTimed && d.endTime && d.endTime <= d.startTime ? addDays(day.date, 1) : null,
      timezone: d.timezone,
      category: d.category,
      status: d.status,
      title: d.title.trim(),
      detail: d.detail.trim(),
      place: d.place.trim() || (coords?.name ?? ''),
      mapUrl: link?.url ?? null,
      mapLat: link ? (coords?.lat ?? null) : (keptSpot?.mapLat ?? null),
      mapLng: link ? (coords?.lng ?? null) : (keptSpot?.mapLng ?? null),
      mapSource: link ? (coords?.source ?? 'link') : (keptSpot?.mapSource ?? null),
      participants: d.participants,
    };
    const res = f.row
      ? await itemOps.update(f.row.id, fields, f.baseVersion)
      : await itemOps.create({
          ...fields,
          id: f.createId,
          summary: '',
          travelMode: null,
          bookingId: null,
          continuesFromPreviousDay: false,
          sortOrder: Math.max(0, ...items.filter((i) => i.date === day.date).map((i) => i.sortOrder)) + 10,
          isExample: false,
        });
    if (!res.ok) {
      setForm((s) => ({
        ...s,
        save: res.reason === 'conflict' ? 'dirty' : 'error',
        conflict: res.reason === 'conflict' ? { latest: res.latest } : s.conflict,
      }));
      return;
    }
    // The item is stored: further saves update this row.
    setForm((s) => ({ ...s, row: res.row, baseVersion: res.row.version, conflict: null, reviewed: null }));
    const selected = d.activityId || null;
    const itemId = res.row.id;
    const ok =
      (await addLibraryLinks(itemId, f.openedLinks, d.resourceIds)) &&
      (await linkPlan(itemId, res.row.status, selected)) &&
      (await removeLibraryLinks(itemId, f.openedLinks, d.resourceIds, selected));
    if (!ok) {
      setForm((s) => ({ ...s, save: 'error' }));
      return;
    }
    setForm((s) => ({ ...s, save: 'saved', initial: s.draft }));
    toast.show(S.sync.saved);
    onSaved(res.row);
  }

  async function remove() {
    const f = formRef.current;
    if (!f.row || busy) return;
    setForm((s) => ({ ...s, save: 'saving', confirm: null }));
    const res = await itemOps.remove(f.row.id, f.baseVersion);
    if (!res.ok) {
      setForm((s) => ({ ...s, save: res.reason === 'conflict' ? 'dirty' : 'error', conflict: res.reason === 'conflict' ? { latest: res.latest } : s.conflict }));
      return;
    }
    const ok = (await applyActivityPatches(activityPatchesForItem(f.row.id, null, activities, null, serverManaged), f.row.id, null, null)) !== null;
    if (!ok) {
      setForm((s) => ({ ...s, save: 'error' }));
      return;
    }
    toast.show(S.itinerary.deleted);
    onClose();
  }

  const review = () =>
    setForm((s) => {
      const latest = s.conflict?.latest ?? null;
      return { ...s, reviewed: { item: latest }, baseVersion: latest?.version ?? s.baseVersion, conflict: null, save: 'dirty' };
    });

  // ── options ───────────────────────────────────────────────────
  const dayNumberOf = (itemId: string | null) => {
    const it = itemId ? items.find((i) => i.id === itemId) : undefined;
    return it ? days.find((d) => d.date === it.date)?.dayNumber : undefined;
  };
  const planOptions = [
    { value: '', label: S.itinerary.none },
    ...activities
      .filter((a) => !a.deletedAt)
      .map((a) => {
        const elsewhere = a.itineraryItemId && a.itineraryItemId !== row?.id ? dayNumberOf(a.itineraryItemId) : undefined;
        return {
          value: a.id,
          label: [a.title, S.labels.preludeKind[a.kind], elsewhere ? S.itinerary.linkedElsewhere(elsewhere) : ''].filter(Boolean).join(' · '),
          disabled: elsewhere !== undefined,
        };
      }),
  ];
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const libraryOptions = [
    { value: '', label: resources.length ? S.itinerary.addLibraryLink : S.itinerary.libraryEmpty },
    ...resources.filter((r) => !draft.resourceIds.includes(r.id)).map((r) => ({ value: r.id, label: r.title })),
  ];
  const zoneOptions: SelectOption[] = [
    { value: tripTz, label: S.itinerary.timezones.sydney },
    ...(homeTz !== tripTz ? [{ value: homeTz, label: S.itinerary.timezones.seoul }] : []),
  ];
  if (!zoneOptions.some((o) => o.value === draft.timezone)) zoneOptions.push({ value: draft.timezone, label: draft.timezone });

  const conflictSource = form.conflict?.latest && me && form.conflict.latest.updatedBy === me.id ? 'ownDevice' : 'partner';
  const reviewed = form.reviewed;

  const footer =
    form.confirm === 'delete' ? (
      <div className={styles.confirm}>
        <p className={styles.confirmText}>{S.itinerary.deleteConfirm}</p>
        <Button variant="ghost" onClick={() => setForm((s) => ({ ...s, confirm: null }))}>
          {S.actions.cancel}
        </Button>
        <Button variant="danger" onClick={() => void remove()} busy={busy}>
          {S.actions.delete}
        </Button>
      </div>
    ) : form.confirm === 'discard' ? (
      <div className={styles.confirm}>
        <p className={styles.confirmText}>{S.itinerary.discardConfirm}</p>
        <Button variant="ghost" onClick={() => setForm((s) => ({ ...s, confirm: null }))}>
          {S.actions.keepEditing}
        </Button>
        <Button variant="danger" onClick={onClose}>
          {S.itinerary.discard}
        </Button>
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
        <Button variant="primary" type="submit" form="itin-item-form" busy={busy}>
          {busy ? S.actions.saving : S.actions.save}
        </Button>
      </div>
    );

  return (
    <Sheet
      open={target !== null}
      onClose={requestClose}
      title={row ? S.itinerary.editTitle : S.itinerary.addTitle}
      description={row ? row.title : undefined}
      headerExtra={<SaveStatus state={form.save === 'idle' && dirty ? 'dirty' : form.save} className={styles.status} />}
      footer={footer}
    >
      <form id="itin-item-form" className={styles.form} onSubmit={(e) => void save(e)} noValidate>
        <fieldset disabled={busy} className={styles.lock}>
        {form.conflict && (
          <ConflictNotice
            source={conflictSource}
            partnerName={partner?.displayName}
            onReview={review}
            onDismiss={() => setForm((s) => ({ ...s, conflict: null }))}
          />
        )}
        {reviewed && <LatestVersion item={reviewed.item} days={days} />}

        <Field label={S.fields.title} error={form.tried ? errors.title : null}>
          <TextInput value={draft.title} onChange={(e) => set('title', e.target.value)} autoComplete="off" required />
        </Field>

        <Field label={S.itinerary.day}>
          <SegmentedControl
            label={S.itinerary.day}
            fill
            columns={3}
            size="sm"
            value={draft.date}
            onChange={(v) => set('date', v)}
            options={days.map((d) => ({
              value: d.date,
              label: (
                <span className={styles.dayChoice}>
                  <span>{S.time.day(d.dayNumber)}</span>
                  <span className={styles.dayChoiceDate}>{formatDayLabel(d.date)}</span>
                </span>
              ),
            }))}
          />
        </Field>

        <div className={`${styles.pair} ${styles.stackNarrow}`}>
          <Field label={S.itinerary.timeKind}>
            <SegmentedControl
              label={S.itinerary.timeKind}
              fill
              columns={3}
              value={draft.timeKind}
              onChange={(v) => set('timeKind', v as TimeKind)}
              options={KINDS.map((k) => ({ value: k, label: S.labels.timeKind[k] }))}
            />
          </Field>
        </div>

        {timed && (
          <>
            <div className={styles.pair}>
              <Field label={S.fields.startTime} error={form.tried ? errors.start : null}>
                <TextInput type="time" step={300} value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
              </Field>
              <Field label={S.fields.endTime} optional hint={endsNextDay ? S.itinerary.endsNextDay : undefined}>
                <TextInput type="time" step={300} value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} />
              </Field>
            </div>
            {zoneOptions.length > 1 && (
              <Field label={S.itinerary.timezone}>
                <SegmentedControl
              label={S.itinerary.timezone}
              fill
              columns={2} value={draft.timezone} onChange={(v) => set('timezone', v)} options={zoneOptions} />
              </Field>
            )}
          </>
        )}

        {/* Who → Status → Category: every choice visible, one tap to pick (owner, 2026-11-01). */}
        <div className={styles.group}>
          <p className={styles.groupLabel} aria-hidden="true">
            {S.fields.participants}
          </p>
          <SegmentedControl
            label={S.fields.participants}
            fill
            value={draft.participants}
            onChange={(v) => set('participants', v)}
            options={(['together', 'eren', 'amy'] as const).map((p) => ({ value: p, label: S.people.participants[p] }))}
          />
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel} aria-hidden="true">
            {S.fields.status}
          </p>
          <SegmentedControl<ItineraryStatus>
            label={S.fields.status}
            fill
            value={draft.status}
            onChange={(v) => set('status', v)}
            options={(STATUSES.includes(draft.status) ? STATUSES : [...STATUSES, draft.status]).map((v) => ({ value: v, label: S.labels.itineraryStatus[v] }))}
          />
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel} aria-hidden="true">
            {S.fields.category}
          </p>
          <SegmentedControl<ItineraryCategory>
            label={S.fields.category}
            fill
            size="sm"
            className={styles.categories}
            value={draft.category}
            onChange={(v) => set('category', v)}
            options={CATEGORIES.map((c) => ({ value: c, label: S.labels.itineraryCategory[c] }))}
          />
        </div>

        <Field label={S.fields.location} optional>
          <TextInput value={draft.place} onChange={(e) => set('place', e.target.value)} autoComplete="off" />
        </Field>

        <Field label={S.maps.link} optional hint={mapHint} error={errors.map}>
          <TextInput
            type="url"
            inputMode="url"
            value={draft.mapUrl}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = value.trim() ? parseMapUrl(value) : null;
              scheduleLookup(value);
              setForm((f) => ({
                ...f,
                draft: {
                  ...f.draft,
                  mapUrl: value,
                  place: parsed?.ok && parsed.name && !f.draft.place.trim() ? parsed.name : f.draft.place,
                },
              }));
            }}
          />
        </Field>

        <Field label={S.itinerary.relatedPlan} optional hint={S.itinerary.relatedPlanHint}>
          <Select
            value={draft.activityId}
            options={planOptions}
            onChange={(e) => {
              const id = e.target.value;
              // The plan's own Library link comes along to this item; the previous plan's goes back.
              const carried = activities.find((a) => a.id === id)?.resourceId;
              setForm((f) => {
                const previous = activities.find((a) => a.id === f.draft.activityId)?.resourceId;
                let resourceIds = f.draft.resourceIds;
                if (previous && previous !== carried && !f.openedLinks.includes(previous)) resourceIds = resourceIds.filter((x) => x !== previous);
                if (carried && !resourceIds.includes(carried)) resourceIds = [...resourceIds, carried];
                return {
                  ...f,
                  // New item + plan chosen → Amy · Business by default (still editable).
                  draft: f.row || !id ? { ...f.draft, activityId: id, resourceIds } : { ...f.draft, activityId: id, resourceIds, participants: 'amy', category: 'business' },
                };
              });
            }}
          />
        </Field>

        <Field label={S.itinerary.libraryLinks} optional hint={S.itinerary.libraryLinksHint}>
          {draft.resourceIds.some((id) => resourceById.has(id)) && (
            <ul className={styles.links}>
              {draft.resourceIds.map((id) => {
                const r = resourceById.get(id);
                if (!r) return null;
                return (
                  <li key={id} className={styles.link}>
                    <span className={styles.linkTitle}>{r.title}</span>
                    <IconButton
                      icon="close"
                      label={S.itinerary.removeLibraryLink(r.title)}
                      onClick={() => set('resourceIds', draft.resourceIds.filter((x) => x !== id))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <Select
            value=""
            options={libraryOptions}
            disabled={libraryOptions.length < 2}
            onChange={(e) => {
              const id = e.target.value;
              if (id) set('resourceIds', [...draft.resourceIds, id]);
            }}
          />
        </Field>

        <Field label={S.itinerary.details} optional hint={S.itinerary.detailsHint}>
          <TextArea value={draft.detail} onChange={(e) => set('detail', e.target.value)} rows={4} />
        </Field>
        </fieldset>
      </form>
    </Sheet>
  );
}

function LatestVersion({ item, days }: { item: ItineraryItem | null; days: TripDay[] }) {
  if (!item) return <p className={styles.latest}>{S.itinerary.removedElsewhere}</p>;
  const day = days.find((d) => d.date === item.date);
  const when = [
    day ? S.itinerary.dayOption(day.dayNumber, formatDayLabel(day.date)) : item.date,
    item.timeKind === 'timed' && item.startTime
      ? [formatWallTime(item.startTime), item.endTime ? formatWallTime(item.endTime) : ''].filter(Boolean).join(' – ')
      : S.labels.timeKind[item.timeKind],
  ].join(' · ');
  return (
    <div className={styles.latest}>
      <p className={styles.latestLabel}>{S.itinerary.latestVersion}</p>
      <dl className={styles.latestList}>
        <dt>{S.fields.title}</dt>
        <dd>{item.title}</dd>
        <dt>{S.fields.date}</dt>
        <dd>{when}</dd>
        <dt>{S.fields.participants}</dt>
        <dd>{S.people.participants[item.participants]}</dd>
        <dt>{S.fields.status}</dt>
        <dd>{S.labels.itineraryStatus[item.status]}</dd>
        {item.place && (
          <>
            <dt>{S.fields.location}</dt>
            <dd>{item.place}</dd>
          </>
        )}
        {item.detail && (
          <>
            <dt>{S.itinerary.details}</dt>
            <dd>{item.detail}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
