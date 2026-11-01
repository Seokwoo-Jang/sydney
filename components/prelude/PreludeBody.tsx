'use client';
// Amy's Prelude (plan §7.3). Board: a 4-column piano card with the goal and the
// next two plans. Tabs: the Itinerary tab's second view with every plan.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShellNav } from '@/components/shell/ShellNav';
import { Button, EmptyState, Icon, IconButton, SaveStatus, TextInput, type SaveState } from '@/components/ui';
import { usePrelude } from '@/lib/data';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { S } from '@/lib/strings';
import type { ItineraryItem, Member, PreludeActivity, Resource, ResourceLink, Trip, TripDay } from '@/lib/types';
import { PIANO_IMAGE, publicAsset, useUrlState } from '@/lib/url';
import { ActivitySheet, type ActivityTarget } from './ActivitySheet';
import { sortActivities, whenLine } from './logic';
import styles from './prelude.module.css';

export interface PreludeViewData {
  trip: Trip;
  me: Member | null;
  partner: Member | null;
  goal: string;
  activities: PreludeActivity[];
  items: ItineraryItem[];
  days: TripDay[];
  resources: Resource[];
  links: ResourceLink[];
}

const BOARD_LIMIT = 2;

export function PreludeBody({ layout, data }: { layout: 'board' | 'tabs'; data: PreludeViewData }) {
  const { goToSection } = useShellNav();
  const { state: url, nav, replace } = useUrlState();
  const reduced = useReducedMotion();
  const tz = data.trip.timezone;
  const itemsById = useMemo(() => new Map(data.items.filter((i) => !i.deletedAt).map((i) => [i.id, i])), [data.items]);
  const resourcesById = useMemo(() => new Map(data.resources.filter((r) => !r.deletedAt).map((r) => [r.id, r])), [data.resources]);
  const { open, done } = useMemo(() => sortActivities(data.activities, itemsById), [data.activities, itemsById]);

  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [sheet, setSheet] = useState<ActivityTarget | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const viewItinerary = (item: ItineraryItem) => goToSection('days', { day: item.date, item: item.id });

  // "View plan" from the itinerary: ?section=prelude&item=<activity id> → reveal and mark that card.
  const handledSeq = useRef(-1);
  const [scrollTarget, setScrollTarget] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (handledSeq.current === nav.seq) return;
    handledSeq.current = nav.seq;
    if (nav.kind === 'replace' || url.section !== 'prelude' || !url.item) return;
    const a = data.activities.find((x) => x.id === url.item && !x.deletedAt);
    if (!a) return;
    if (a.status === 'done') setShowDone(true);
    else if (open.indexOf(a) >= BOARD_LIMIT) setShowAll(true);
    if (layout === 'board' && a.status === 'done') setShowAll(true);
    setHighlight(a.id);
    setScrollTarget({ id: a.id });
    replace({ item: null });
  }, [nav, url.section, url.item, data.activities, open, layout, replace]);

  useEffect(() => {
    if (!scrollTarget) return;
    const { id } = scrollTarget;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-plan-id="${id}"]`);
        el?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        el?.focus({ preventScroll: true });
      });
    });
    // The ring marks where "View plan" landed, then steps back.
    const fade = window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 4000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fade);
    };
  }, [scrollTarget, reduced]);

  const visibleOpen = layout === 'board' && !showAll ? open.slice(0, BOARD_LIMIT) : open;
  const doneVisible = layout === 'board' ? showAll : showDone;
  const total = open.length + done.length;
  const tone = layout === 'board' ? 'dark' : 'light';

  const card = (a: PreludeActivity) => (
    <PlanCard
      key={a.id}
      activity={a}
      item={a.itineraryItemId ? (itemsById.get(a.itineraryItemId) ?? null) : null}
      resource={a.resourceId ? (resourcesById.get(a.resourceId) ?? null) : null}
      days={data.days}
      tripTz={tz}
      tone={tone}
      highlighted={highlight === a.id}
      onEdit={() => setSheet({ kind: 'edit', activity: a })}
      onViewItinerary={viewItinerary}
    />
  );

  const list = (
    <>
      {open.length === 0 && done.length === 0 ? (
        <EmptyState
          title={S.prelude.empty}
          actionLabel={S.prelude.addPlan}
          onAction={() => setSheet({ kind: 'add' })}
          compact
          className={styles.empty}
        />
      ) : (
        <ul role="list" className={styles.plans} aria-label={S.prelude.listLabel}>
          {visibleOpen.map(card)}
        </ul>
      )}
      {done.length > 0 && layout === 'tabs' && (
        <Button variant="link" size="sm" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className={styles.doneToggle}>
          {S.prelude.doneGroup(done.length)}
        </Button>
      )}
      {done.length > 0 && doneVisible && (
        <ul role="list" className={styles.plans} aria-label={S.prelude.doneGroup(done.length)}>
          {done.map(card)}
        </ul>
      )}
      <div className={styles.listActions}>
        {layout === 'board' && total > BOARD_LIMIT && (
          <Button variant="onDark" size="sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? S.prelude.showFewer : S.prelude.viewAll(total)}
          </Button>
        )}
        {total > 0 && (
          <Button variant={layout === 'board' ? 'onDark' : 'secondary'} size="sm" iconStart="plus" onClick={() => setSheet({ kind: 'add' })}>
            {S.prelude.addPlan}
          </Button>
        )}
      </div>
      {data.activities.some((a) => a.isExample && !a.deletedAt) && <p className={styles.footnote}>{S.data.exampleNote}</p>}
    </>
  );

  const hero = (
    <div className={styles.hero}>
      <img
        className={styles.heroImg}
        src={publicAsset(PIANO_IMAGE.path)}
        width={PIANO_IMAGE.width}
        height={PIANO_IMAGE.height}
        alt=""
        decoding="async"
        loading="lazy"
      />
      <span className={styles.heroShade} aria-hidden="true" />
      <div className={styles.heroText}>
        <p className={`eyebrow ${styles.eyebrow}`}>{S.sections.prelude.title}</p>
        <h2 id="section-prelude-title" className={styles.title}>
          {S.sections.prelude.tagline}
        </h2>
        <p className={styles.intro}>{S.sections.prelude.intro}</p>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={styles.root} data-layout={layout}>
      {hero}
      <div className={styles.body}>
        <GoalLine goal={data.goal} tone={tone} />
        {list}
      </div>
      <ActivitySheet
        target={sheet}
        activities={data.activities}
        items={itemsById}
        days={data.days}
        resources={data.resources}
        links={data.links}
        tripTz={tz}
        me={data.me}
        partner={data.partner}
        onClose={() => setSheet(null)}
        onViewItinerary={(item) => {
          setSheet(null);
          viewItinerary(item);
        }}
      />
    </div>
  );
}

function PlanCard({
  activity,
  item,
  resource,
  days,
  tripTz,
  tone,
  highlighted,
  onEdit,
  onViewItinerary,
}: {
  activity: PreludeActivity;
  item: ItineraryItem | null;
  resource: Resource | null;
  days: TripDay[];
  tripTz: string;
  tone: 'dark' | 'light';
  highlighted: boolean;
  onEdit: () => void;
  onViewItinerary: (item: ItineraryItem) => void;
}) {
  const meta = [S.labels.preludeKind[activity.kind], S.labels.preludeStatus[activity.status]].join(' · ');
  // Place, notes, who to meet and the Library link fold under the title (PC and phones alike);
  // a plan with none of them gets no chevron.
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const place = item?.place.trim() ?? '';
  const hasDetails = Boolean(place || activity.notes.trim() || activity.peopleNote.trim() || resource);
  return (
    <li className={styles.plan} data-tone={tone} data-status={activity.status} data-highlight={highlighted || undefined} data-plan-id={activity.id} tabIndex={-1}>
      <div className={styles.planHead}>
        <h3 className={styles.planTitle}>
          {hasDetails ? (
            <button type="button" className={styles.planToggle} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
              <span>{activity.title}</span>
              <Icon name="chevron" size={16} rotate={open ? 180 : 0} className={styles.planChevron} />
            </button>
          ) : (
            activity.title
          )}
        </h3>
        <IconButton icon="edit" label={S.prelude.editPlan(activity.title)} onClick={onEdit} variant={tone === 'dark' ? 'onDark' : 'ghost'} className={styles.planEdit} />
      </div>
      <p className={styles.planMeta}>{meta}</p>
      <p className={styles.planWhen}>
        <Icon name="itinerary" size={14} />
        <span>{item ? whenLine(item, days, tripTz) : S.prelude.notOnItinerary}</span>
      </p>
      {hasDetails && (
        <div id={detailsId} className={styles.planDetails} hidden={!open}>
          {place && (
            <p className={styles.planLine}>
              <Icon name="map-pin" size={14} />
              <span>{place}</span>
            </p>
          )}
          {activity.notes.trim() && <p className={styles.planNotes}>{activity.notes}</p>}
          {activity.peopleNote.trim() && (
            <p className={styles.planLine}>
              <Icon name="user" size={14} />
              <span>{activity.peopleNote}</span>
            </p>
          )}
          {resource && (
            <p className={styles.planLine}>
              <Icon name="link" size={14} />
              <a href={resource.url} target="_blank" rel="noopener noreferrer">
                {resource.title}
                <span className="sr-only"> ({S.ui.externalLink})</span>
              </a>
            </p>
          )}
        </div>
      )}
      {item && (
        <Button variant="link" size="sm" className={styles.planAction} onClick={() => onViewItinerary(item)} iconEnd="arrow">
          {S.prelude.viewItinerary}
        </Button>
      )}
    </li>
  );
}

function GoalLine({ goal, tone }: { goal: string; tone: 'dark' | 'light' }) {
  const prelude = usePrelude();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(goal);
  const [save, setSave] = useState<SaveState>('idle');
  const busy = save === 'saving';

  const start = () => {
    setValue(goal);
    setSave('idle');
    setEditing(true);
  };
  const submit = async () => {
    if (busy) return;
    setSave('saving');
    const res = await prelude.setGoal(value.trim());
    if (!res.ok) {
      setSave('error');
      return;
    }
    setSave('saved');
    setEditing(false);
  };

  return (
    <div className={styles.goal} data-tone={tone}>
      <p className={`eyebrow ${styles.goalLabel}`} id="prelude-goal-label">
        {S.prelude.goalLabel}
      </p>
      {editing ? (
        <form
          className={styles.goalForm}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextInput
            aria-labelledby="prelude-goal-label"
            value={value}
            placeholder={S.prelude.goalPlaceholder}
            onChange={(e) => {
              setValue(e.target.value);
              if (save !== 'saving') setSave('dirty');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
          <div className={styles.goalActions}>
            <Button variant={tone === 'dark' ? 'onDark' : 'primary'} size="sm" type="submit" busy={busy}>
              {busy ? S.actions.saving : S.actions.save}
            </Button>
            <Button variant={tone === 'dark' ? 'onDark' : 'ghost'} size="sm" onClick={() => setEditing(false)} disabled={busy}>
              {S.actions.cancel}
            </Button>
            <SaveStatus state={save} className={styles.goalStatus} />
          </div>
        </form>
      ) : (
        <div className={styles.goalRow}>
          <p className={styles.goalText} data-empty={!goal || undefined}>
            {goal || S.prelude.goalEmpty}
          </p>
          <IconButton icon="edit" label={S.prelude.editGoal} onClick={start} variant={tone === 'dark' ? 'onDark' : 'ghost'} />
          {save === 'saved' && <SaveStatus state="saved" className={styles.goalStatus} />}
        </div>
      )}
    </div>
  );
}
