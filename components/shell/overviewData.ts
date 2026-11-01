'use client';
// Derived numbers for the overview strip and Prelude teaser. Computed from the
// source rows, never stored (plan §10).
import { useMemo } from 'react';
import { hasBudget } from '@/components/budget/budgetCalc';
import { countDue } from '@/components/checklist/due';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useAssets, useBudget, useChecklist, useDays, useItinerary, useLibrary, usePrelude, useServerNow, useTrip } from '@/lib/data';
import { useCountdown } from '@/lib/hooks/useCountdown';
import { useCurrencyFirst } from '@/lib/hooks/useCurrencyFirst';
import { formatMoney, summarizeBudget } from '@/lib/money';
import { formatWallTime, S } from '@/lib/strings';
import { SYDNEY_TZ, formatDayLabel, zonedDate } from '@/lib/time/zone';
import type { Currency, ItineraryItem, PreludeActivity, TripDay } from '@/lib/types';
import { countdownText } from './countdownText';

/** Whole units for the strip: 'A$1,111', '₩1,013,750' (no '≈', like the Budget section). */
function compactMoney(minor: number, c: Currency): string {
  const rounded = c === 'AUD' ? Math.round(minor / 100) * 100 : minor;
  return formatMoney(rounded, c).replace(/\.00$/, '');
}

export interface SummaryCell {
  value: string;
  sub: string;
}

export interface OverviewSummary {
  ready: SummaryCell | null;
  days: SummaryCell | null;
  wallet: SummaryCell | null;
  links: SummaryCell | null;
  journal: SummaryCell | null;
}

export function useOverviewSummary(): OverviewSummary {
  const checklist = useChecklist();
  const budget = useBudget();
  const library = useLibrary();
  const assets = useAssets();
  const days = useDays();
  const trip = useTrip();
  const countdown = useCountdown();
  const dueCtx = useDueContext();
  const [first] = useCurrencyFirst(trip.status === 'ready' ? trip.data.trip.displayCurrencyFirst : 'AUD');

  const ready = useMemo<SummaryCell | null>(() => {
    if (checklist.status !== 'ready' || !dueCtx) return null;
    const live = checklist.data.filter((i) => i.isApplicable);
    const done = live.filter((i) => i.checked).length;
    const due = countDue(live, dueCtx);
    if (!live.length) return { value: '0', sub: S.overview.nothingYet };
    return {
      value: S.overview.checklistValue(done, live.length),
      sub: [
        S.overview.checklistSub,
        due.overdue ? S.checklist.overdue(due.overdue) : '',
        due.soon ? S.overview.dueSoon(due.soon) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }, [checklist, dueCtx]);

  const daysCell = useMemo<SummaryCell | null>(() => {
    if (!countdown || days.status !== 'ready') return null;
    const t = countdownText(countdown);
    if (countdown.state.kind === 'during') {
      const today = zonedDate(countdown.now, SYDNEY_TZ);
      const day = days.data.find((d) => d.date === today);
      return { value: t.value, sub: day?.title ?? '' };
    }
    if (countdown.state.kind === 'after') return { value: t.value, sub: t.label };
    return { value: t.value, sub: t.flight ?? S.overview.noFlight };
  }, [countdown, days]);

  const wallet = useMemo<SummaryCell | null>(() => {
    if (budget.status !== 'ready') return null;
    const sum = summarizeBudget({
      budgets: budget.data.budgets,
      expenses: budget.data.expenses,
      latest: budget.data.latestFx,
      scope: 'all',
    });
    const key = first === 'AUD' ? 'aud' : 'krw';
    if (!hasBudget(budget.data.budgets, 'all')) {
      return { value: compactMoney(sum.spent[key], first), sub: S.overview.noBudget };
    }
    // Three lines like every summary: Budget / what is left / Remaining (or Over budget).
    const left = sum.remaining[key];
    return {
      value: compactMoney(Math.abs(left), first),
      sub: left < 0 ? S.overview.budgetOver : S.overview.budgetRemaining,
    };
  }, [budget, first]);

  const links = useMemo<SummaryCell | null>(() => {
    if (library.status !== 'ready') return null;
    const pinned = library.data.resources.filter((r) => r.pinnedOrder != null).length;
    return { value: S.overview.librarySaved(library.data.resources.length), sub: S.overview.libraryPinned(pinned) };
  }, [library]);

  const journalCell = useMemo<SummaryCell | null>(() => {
    if (assets.status !== 'ready' || days.status !== 'ready') return null;
    // Days with at least one photo post (the Journal is photos with their text).
    const dayIds = new Set(days.data.map((d) => d.id));
    // The day's own Nine Notes photo is not one of ours.
    const withPhotos = new Set(assets.data.filter((a) => a.kind === 'photo' && !a.isDefault && a.dayId && dayIds.has(a.dayId)).map((a) => a.dayId)).size;
    return {
      value: S.overview.journalValue(withPhotos, days.data.length),
      sub: withPhotos ? S.overview.journalSome(withPhotos) : S.overview.journalEmpty,
    };
  }, [assets, days]);

  return { ready, days: daysCell, wallet, links, journal: journalCell };
}

// ── Prelude ──────────────────────────────────────────────────────
export interface NextPlan {
  activity: PreludeActivity;
  item: ItineraryItem | null;
  /** 'Day 2 · Fri, 27 Dec · 2:30 pm' or null when not on the itinerary. */
  when: string | null;
}

/** Nearest Planned activity by its itinerary date, else the first Idea (plan §7.3). */
export function pickNextPlan(activities: PreludeActivity[], items: ItineraryItem[], days: TripDay[]): NextPlan | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const withItem = activities
    .filter((a) => a.status !== 'done')
    .map((a) => ({ activity: a, item: a.itineraryItemId ? (byId.get(a.itineraryItemId) ?? null) : null }));
  const key = (x: { item: ItineraryItem | null }) => (x.item ? `${x.item.date} ${x.item.startTime ?? '99:99'}` : '9999');
  const planned = withItem.filter((x) => x.activity.status === 'planned').sort((a, b) => key(a).localeCompare(key(b)));
  const pick = planned[0] ?? withItem.filter((x) => x.activity.status === 'idea').sort((a, b) => a.activity.sortOrder - b.activity.sortOrder)[0];
  if (!pick) return null;
  const day = pick.item ? days.find((d) => d.id === pick.item!.dayId) : undefined;
  const when = pick.item
    ? [day ? S.time.day(day.dayNumber) : '', formatDayLabel(pick.item.date), pick.item.startTime ? formatWallTime(pick.item.startTime) : '']
        .filter(Boolean)
        .join(' · ')
    : null;
  return { activity: pick.activity, item: pick.item, when };
}

export function useNextPlan(): NextPlan | null | undefined {
  const prelude = usePrelude();
  const itinerary = useItinerary();
  const days = useDays();
  return useMemo(() => {
    if (prelude.status !== 'ready' || itinerary.status !== 'ready' || days.status !== 'ready') return undefined;
    return pickNextPlan(prelude.data.activities, itinerary.data, days.data);
  }, [prelude, itinerary, days]);
}

/** Today (Sydney) has a Planned Prelude activity → dot on the sub-tab (plan §4.4). */
export function usePreludeDotToday(): boolean {
  const prelude = usePrelude();
  const itinerary = useItinerary();
  const now = useServerNow(60_000);
  return useMemo(() => {
    if (prelude.status !== 'ready' || itinerary.status !== 'ready' || !now) return false;
    const today = zonedDate(now, SYDNEY_TZ);
    const dates = new Map(itinerary.data.map((i) => [i.id, i.date]));
    return prelude.data.activities.some((a) => a.status === 'planned' && a.itineraryItemId && dates.get(a.itineraryItemId) === today);
  }, [prelude, itinerary, now]);
}
