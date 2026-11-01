'use client';
// One collapsible timeline row (plan §7.2.4). The summary is a single toggle
// button; map/plan/edit actions live outside it so they never fight the toggle.
import { Badge, Button, ButtonLink, ExampleMark, Icon, IconButton, MemberMarks, type BadgeTone, type IconName } from '@/components/ui';
import { mapHref } from '@/lib/maps';
import { S } from '@/lib/strings';
import type { Booking, ItineraryStatus, PreludeActivity, Resource } from '@/lib/types';
import { shownStatus, timeLabel, type DayRow } from './logic';
import styles from './itinerary.module.css';

export type RowState = 'now' | 'upNext' | 'past' | null;

export interface RowLinks {
  booking: Booking | null;
  activity: PreludeActivity | null;
  resources: Resource[];
  expenses: number;
}

const BOOKING_ICON: Record<Booking['kind'], IconName> = { flight: 'plane', stay: 'bed', car: 'car' };

/** Idea dashed · Planned blue · Fixed solid Ink · Completed grey (plan §7.2). */
const STATUS_TONE: Record<ItineraryStatus, BadgeTone> = {
  idea: 'statusIdea',
  planned: 'statusPlanned',
  confirmed: 'statusFixed',
  completed: 'statusDone',
  cancelled: 'statusDone',
};

function bookingLine(b: Booking): string {
  const d = b.detail;
  const what = d.kind === 'flight' ? `${b.title} · ${S.itinerary.route(d.from, d.to)}` : b.title;
  return [what, S.labels.bookingStatus[b.status], S.labels.paymentStatus[b.paymentStatus]].join(' · ');
}

export function ItineraryRow({
  row,
  rowKey,
  layout,
  tripTz,
  state,
  open,
  links,
  onToggle,
  onEdit,
  onViewPlan,
  onOpenExpenses,
}: {
  row: DayRow;
  /** Unique per rendered instance (date:id). */
  rowKey: string;
  layout: 'board' | 'tabs';
  tripTz: string;
  state: RowState;
  open: boolean;
  links: RowLinks;
  onToggle: () => void;
  onEdit: () => void;
  onViewPlan: (activity: PreludeActivity) => void;
  onOpenExpenses: () => void;
}) {
  const { item, continuation } = row;
  const time = timeLabel(row, tripTz, layout);
  const map = mapHref(item);
  const detailText = item.detail.trim();
  const hasDetail = Boolean(detailText || map || links.booking || links.activity || links.resources.length || links.expenses);
  const detailId = `itin-detail-${rowKey}`;
  const summary = continuation
    ? S.time.continuesFromPreviousDay
    : item.summary.trim() || [S.labels.itineraryCategory[item.category], item.place.trim()].filter(Boolean).join(' · ');

  const shown = shownStatus(item.status, state === 'past');
  // Amy's Prelude: a Business plan or one linked to a Prelude activity gets a music note.
  const prelude = item.category === 'business' || !!links.activity;
  const badges = (
    <>
      {state === 'now' && <Badge tone="now">{S.time.now}</Badge>}
      {state === 'upNext' && <Badge tone="soft">{S.time.upNext}</Badge>}
      {!continuation && <Badge tone={STATUS_TONE[shown]}>{S.labels.itineraryStatus[shown]}</Badge>}
    </>
  );

  const timeCell = (
    <span className={styles.time}>
      {time.lines.map((l) => (
        <span key={l} className={styles.timeLine}>
          {l}
        </span>
      ))}
      {time.note && <span className={styles.zone}>{time.note}</span>}
    </span>
  );

  const inner =
    layout === 'board' ? (
      <>
        {timeCell}
        {prelude ? (
          <Icon name="note" size={14} className={styles.noteMark} label={S.itinerary.preludeMark} />
        ) : (
          <span className={styles.dot} aria-hidden="true" />
        )}
        <span className={styles.marks}>
          <MemberMarks who={item.participants} />
        </span>
        <span className={styles.text}>
          <span className={styles.titleLine}>
            <span className={styles.title}>{item.title}</span>
            {badges}
          </span>
          <span className={styles.sub}>{summary}</span>
        </span>
      </>
    ) : (
      <>
        {timeCell}
        <span className={styles.text}>
          <span className={styles.title}>
            {prelude && <Icon name="note" size={14} className={styles.noteInline} label={S.itinerary.preludeMark} />}
            {item.title}
          </span>
          <span className={styles.subLine}>
            <MemberMarks who={item.participants} size="sm" />
            <span className={styles.sub}>{summary}</span>
            {badges}
          </span>
        </span>
      </>
    );

  return (
    <li
      className={styles.row}
      data-row-key={rowKey}
      data-state={state ?? undefined}
      data-focus={state === 'now' || state === 'upNext' ? 'true' : undefined}
      data-business={item.category === 'business' || undefined}
      data-cancelled={item.status === 'cancelled' || undefined}
      data-continuation={continuation || undefined}
    >
      <div className={styles.head}>
        {hasDetail ? (
          <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
            {inner}
            <Icon name="chevron" size={16} className={styles.chevron} />
          </button>
        ) : (
          <div className={styles.toggle}>{inner}</div>
        )}
        {map?.kind === 'link' && (
          <a className={styles.mapIcon} href={map.href} target="_blank" rel="noopener noreferrer" aria-label={S.maps.openLabel(item.place || item.title)}>
            <Icon name="map-pin" size={18} />
          </a>
        )}
        {!hasDetail && <IconButton icon="edit" label={S.itinerary.editItem(item.title)} onClick={onEdit} className={styles.rowEdit} />}
      </div>
      {hasDetail && (
        <div id={detailId} className={styles.detail} hidden={!open}>
          {detailText && <p className={styles.detailText}>{detailText}</p>}
          {links.booking && (
            <p className={styles.metaLine}>
              <Icon name={BOOKING_ICON[links.booking.kind]} size={16} />
              <span>
                <span className={styles.metaLabel}>{S.itinerary.booking}</span> {bookingLine(links.booking)}
              </span>
            </p>
          )}
          {links.activity && (
            <p className={styles.metaLine} data-tone="brass">
              <Icon name="note" size={16} />
              <span>
                <span className={styles.metaLabel}>{S.itinerary.relatedPlan}</span> {links.activity.title}
              </span>
            </p>
          )}
          {links.resources.length > 0 && (
            <div className={styles.metaLine}>
              <Icon name="link" size={16} />
              <span>
                <span className={styles.metaLabel}>{S.itinerary.resources}</span>{' '}
                {links.resources.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ' · '}
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      {r.title}
                      <span className="sr-only"> ({S.ui.externalLink})</span>
                    </a>
                  </span>
                ))}
              </span>
            </div>
          )}
          <div className={styles.actions}>
            {map && (
              <ButtonLink href={map.href} external variant="link" size="sm" iconStart="map-pin">
                {map.kind === 'link' ? S.maps.open : S.maps.search}
                <span className="sr-only"> ({S.ui.externalLink})</span>
              </ButtonLink>
            )}
            {links.activity && (
              <Button variant="link" size="sm" iconStart="note" onClick={() => onViewPlan(links.activity!)}>
                {S.itinerary.viewPlan}
              </Button>
            )}
            {links.expenses > 0 && (
              <Button variant="link" size="sm" iconStart="budget" onClick={onOpenExpenses}>
                {S.itinerary.expensesCount(links.expenses)}
              </Button>
            )}
            <Button variant="link" size="sm" iconStart="edit" onClick={onEdit} aria-label={S.itinerary.editItem(item.title)}>
              {S.actions.edit}
            </Button>
            {item.isExample && <ExampleMark className={styles.example} />}
          </div>
        </div>
      )}
    </li>
  );
}
