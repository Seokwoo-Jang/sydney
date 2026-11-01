'use client';
// Library · The Travel Library (plan §7.7). Root id stays "section-links".
import { useMemo, useState } from 'react';
import { useSectionNav } from '@/components/checklist/useSectionNav';
import { MAX_PINNED, hostOf, nextPinSlot } from '@/components/library/libraryLogic';
import { ResourceCard, type LinkTag } from '@/components/library/ResourceCard';
import { RESOURCE_CATEGORIES, ResourceSheet } from '@/components/library/ResourceSheet';
import { useShellNav } from '@/components/shell/ShellNav';
import { Button, Chip, ChipGroup, EmptyState, ErrorState, Field, LoadingState, SectionHeading, TextInput, useToast } from '@/components/ui';
import { useChecklist, useDays, useItinerary, useLibrary, usePrelude, useTrip } from '@/lib/data';
import type { PreludeActivity, Resource, ResourceCategory } from '@/lib/types';
import { S } from '@/lib/strings';
import type { SectionKey, UrlPatch } from '@/lib/url';
import type { SectionProps } from './types';
import styles from '@/components/library/Library.module.css';

type CategoryView = 'all' | ResourceCategory;
const VIEWS: CategoryView[] = ['all', ...RESOURCE_CATEGORIES];
const BOARD_LIMIT = 4;

export default function LibrarySection({ layout }: SectionProps) {
  const lib = useLibrary();
  const itinerary = useItinerary();
  const prelude = usePrelude();
  const checklist = useChecklist();
  const days = useDays();
  const trip = useTrip();
  const toast = useToast();
  const { goToSection } = useShellNav();
  const nav = useSectionNav<CategoryView>('links', VIEWS, 'all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const board = layout === 'board';

  const me = trip.status === 'ready' ? trip.data.me : null;
  const partner = trip.status === 'ready' ? trip.data.partner : null;
  const members = trip.status === 'ready' ? trip.data.members : [];
  const resources = lib.status === 'ready' ? lib.data.resources : [];
  const links = lib.status === 'ready' ? lib.data.links : [];
  const items = itinerary.status === 'ready' ? itinerary.data : [];
  const activities = prelude.status === 'ready' ? prelude.data.activities : [];
  const checklistItems = checklist.status === 'ready' ? checklist.data : [];
  const dayNo = useMemo(() => new Map((days.status === 'ready' ? days.data : []).map((d) => [d.id, d.dayNumber])), [days]);

  // Library is the bottom layer: a link shows every place above it that uses it — its
  // itinerary items (and each item's Related plan), Prelude plans not on the itinerary
  // yet, and Checklist items. Links are made on those; here they are shown and followed.
  // A tag goes there and rings the row; the Library sheet (if open) closes first.
  const leave = (section: SectionKey, extra: Omit<UrlPatch, 'section'>) => {
    setAdding(false);
    nav.closeItem();
    goToSection(section, extra);
  };
  const tagsFor = (r: Resource): LinkTag[] => {
    const tags: LinkTag[] = [];
    const plans = new Set<string>();
    const planTag = (act: PreludeActivity, id: string) => {
      if (plans.has(act.id)) return;
      plans.add(act.id);
      tags.push({ id, label: S.library.preludeTag(act.title), onClick: () => leave('prelude', { item: act.id }) });
    };
    for (const l of links.filter((x) => x.resourceId === r.id)) {
      const item = l.itineraryItemId ? items.find((i) => i.id === l.itineraryItemId && !i.deletedAt) : undefined;
      if (item) {
        const n = dayNo.get(item.dayId);
        tags.push({
          id: l.id,
          label: `${n ? `${S.time.day(n)} · ` : ''}${item.title}`,
          onClick: () => leave('days', { day: item.date, item: item.id }),
        });
        const plan = activities.find((x) => !x.deletedAt && x.itineraryItemId === item.id);
        if (plan) planTag(plan, `${l.id}:plan`);
        continue;
      }
      const act = l.preludeActivityId ? activities.find((x) => x.id === l.preludeActivityId && !x.deletedAt) : undefined;
      if (act) planTag(act, l.id);
    }
    // Checklist items keep their links on the item (the ETA guide on "Apply for the ETA").
    for (const c of checklistItems) {
      if (!c.deletedAt && c.resourceIds.includes(r.id)) {
        tags.push({ id: c.id, label: S.library.checklistTag(c.title), onClick: () => leave('ready', { view: c.kind, mark: c.id }) });
      }
    }
    return tags;
  };

  const togglePin = async (r: Resource) => {
    let pinnedOrder: number | null = null;
    if (r.pinnedOrder == null) {
      pinnedOrder = nextPinSlot(resources);
      if (pinnedOrder == null) {
        toast.show(S.library.pinLimit, { tone: 'error' });
        return;
      }
    }
    const res = await lib.update(r.id, { pinnedOrder }, r.version);
    if (res.ok) toast.show(pinnedOrder ? S.library.pinnedDone : S.library.unpinnedDone);
    else toast.show(res.reason === 'conflict' ? S.sync.conflict : S.sync.failed, { tone: 'error' });
  };

  const openResource = nav.item ? (resources.find((r) => r.id === nav.item) ?? null) : null;
  const cardProps = (r: Resource) => ({ resource: r, tags: tagsFor(r), onOpen: (x: Resource) => nav.openItem(x.id), onTogglePin: togglePin });

  let body;
  if (lib.status === 'error') body = <ErrorState onRetry={lib.retry} />;
  else if (lib.status === 'loading') body = <LoadingState rows={3} />;
  else if (!resources.length)
    body = <EmptyState icon="library" title={S.empty.library} actionLabel={S.empty.libraryAction} onAction={() => setAdding(true)} />;
  else {
    const pinned = resources.filter((r) => r.pinnedOrder != null).sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
    const q = query.trim().toLowerCase();
    // Every link, pinned ones too (they carry their Pinned mark); the pinned row above is a shortcut.
    const rest = resources.filter(
      (r) =>
        (nav.view === 'all' || r.category === nav.view) &&
        (!q || [r.title, r.note, hostOf(r.url)].some((t) => t.toLowerCase().includes(q))),
    );
    // Pinned first (in their pinned order), then the rest by title.
    rest.sort((a, b) => (a.pinnedOrder ?? 99) - (b.pinnedOrder ?? 99) || a.title.localeCompare(b.title));
    const shown = board && !expanded ? rest.slice(0, BOARD_LIMIT) : rest;
    const counts = new Map(RESOURCE_CATEGORIES.map((c) => [c, resources.filter((r) => r.category === c).length]));
    body = (
      <>
        {pinned.length > 0 && (
          <section className={styles.pinned} aria-labelledby="links-pinned">
            <h3 id="links-pinned" className={styles.subhead}>
              {S.library.pinned} · {pinned.length}/{MAX_PINNED}
            </h3>
            <div className={styles.grid}>
              {pinned.map((r) => (
                <ResourceCard key={r.id} {...cardProps(r)} />
              ))}
            </div>
          </section>
        )}
        <div className={styles.filters}>
          {!board && (
            <Field label={S.library.search} hideLabel>
              <TextInput type="search" value={query} placeholder={S.library.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} />
            </Field>
          )}
          <ChipGroup label={S.library.categoryFilter}>
            {VIEWS.map((v) => (
              <Chip key={v} selected={nav.view === v} onClick={() => nav.setView(v)}>
                {v === 'all' ? S.library.all : S.labels.resourceCategory[v]}
                {v !== 'all' && <span className={styles.count}>{counts.get(v) ?? 0}</span>}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        {shown.length ? (
          <div className={styles.grid}>
            {shown.map((r) => (
              <ResourceCard key={r.id} {...cardProps(r)} />
            ))}
          </div>
        ) : (
          <p className={styles.muted}>{S.library.noMatches}</p>
        )}
        {board && rest.length > BOARD_LIMIT && (
          <Button variant="link" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? S.actions.showLess : S.library.showMore(rest.length - BOARD_LIMIT)}
          </Button>
        )}
      </>
    );
  }

  return (
    <section id="section-links" aria-labelledby="section-links-title" className={styles.root} data-layout={layout}>
      <SectionHeading
        id="section-links-title"
        eyebrow={S.sections.links.menu}
        title={S.sections.links.title}
        intro={S.sections.links.intro}
        layout={layout}
        actions={
          resources.length > 0 ? (
            <Button variant="secondary" size="sm" iconStart="plus" onClick={() => setAdding(true)}>
              {S.empty.libraryAction}
            </Button>
          ) : undefined
        }
      />
      <div className={styles.body}>{body}</div>
      <ResourceSheet
        open={!!openResource || adding}
        resource={openResource}
        category={!openResource && nav.view !== 'all' ? nav.view : null}
        resources={resources}
        tags={openResource ? tagsFor(openResource) : []}
        me={me}
        partner={partner}
        members={members}
        onClose={() => (adding ? setAdding(false) : nav.closeItem())}
        onOpenOther={(id) => {
          setAdding(false);
          nav.openItem(id);
        }}
      />
    </section>
  );
}
