// Due-date rules for To-do items (plan §7.4 B). Pure, unit tested.
// - Only open, applicable tasks with a due date count.
// - Overdue (due before today) is counted apart from "due soon" (today … +7 days).
// - Once the trip is under way, anything due before the trip start no longer counts.
import type { ChecklistItem } from '@/lib/types';
import { diffDays } from '@/lib/time/zone';

export const DUE_SOON_DAYS = 7;

export type DueState = 'overdue' | 'soon' | 'later' | 'none';

export interface DueContext {
  /** Calendar date used as "today": home calendar before the trip, Sydney during it. */
  today: string;
  tripStart: string;
  /** True from departure until after the trip. */
  underway: boolean;
}

export function dueState(item: Pick<ChecklistItem, 'kind' | 'checked' | 'isApplicable' | 'dueDate'>, ctx: DueContext): DueState {
  if (item.kind !== 'task' || item.checked || !item.isApplicable || !item.dueDate) return 'none';
  if (ctx.underway && item.dueDate < ctx.tripStart) return 'none';
  const d = diffDays(item.dueDate, ctx.today);
  if (d < 0) return 'overdue';
  return d <= DUE_SOON_DAYS ? 'soon' : 'later';
}

export function countDue(items: ChecklistItem[], ctx: DueContext): { overdue: number; soon: number } {
  let overdue = 0;
  let soon = 0;
  for (const i of items) {
    const s = dueState(i, ctx);
    if (s === 'overdue') overdue++;
    else if (s === 'soon') soon++;
  }
  return { overdue, soon };
}

/** Open tasks for "Coming up": overdue first, then by due date; undated last. */
export function upcomingTasks(items: ChecklistItem[], ctx: DueContext, limit = 4): ChecklistItem[] {
  return items
    .filter((i) => i.kind === 'task' && i.isApplicable && !i.checked && !(ctx.underway && i.dueDate && i.dueDate < ctx.tripStart))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sortOrder - b.sortOrder)
    .slice(0, limit);
}

/** Packed/done progress over applicable items only (not-needed items are left out). */
export function progress(items: ChecklistItem[], kind: ChecklistItem['kind']): { done: number; total: number } {
  const live = items.filter((i) => i.kind === kind && i.isApplicable);
  return { done: live.filter((i) => i.checked).length, total: live.length };
}
