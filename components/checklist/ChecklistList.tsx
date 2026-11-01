'use client';
// Packing or To-do list: person filter, "hide finished", four collapsible
// category groups (plan §4.3, §7.4). Progress ignores not-needed rows.
import { useEffect, useId, useState } from 'react';
import { Button, Chip, ChipGroup, EmptyState, Icon } from '@/components/ui';
import { PACKING_CATEGORIES, TASK_CATEGORIES } from '@/lib/data';
import type { ChecklistItem, ChecklistKind, Member, Resource } from '@/lib/types';
import { S } from '@/lib/strings';
import { ChecklistRow } from './ChecklistRow';
import type { DueContext } from './due';
import { PRIORITY_RANK } from './due';
import styles from './Checklist.module.css';

/** Everyone / one person = what is still to do; Finished = done or not needed (owner, 2026-11-01). */
type PersonFilter = 'all' | 'eren' | 'amy' | 'finished';

export function ChecklistList({
  kind,
  items,
  resources,
  me,
  due,
  pending,
  highlight,
  highlightSeq,
  defaultOpen,
  onToggle,
  onEdit,
  onAdd,
}: {
  kind: ChecklistKind;
  items: ChecklistItem[];
  /** Library entries by id, for each row's link. */
  resources: ReadonlyMap<string, Resource>;
  me: Member | null;
  due: DueContext | null;
  pending: ReadonlySet<string>;
  /** A row a Library tag points at: shown (filter, group) and ringed. */
  highlight?: string | null;
  /** Changes on every tag click, so the same row pointed at again is shown again. */
  highlightSeq?: number;
  defaultOpen: boolean;
  onToggle: (item: ChecklistItem) => void;
  onEdit: (item: ChecklistItem) => void;
  onAdd: (category: string | null) => void;
}) {
  const [person, setPerson] = useState<PersonFilter>('all');
  // Collapsed state is per session; groups not yet touched follow the layout default.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const baseId = useId();

  // Make the ringed row visible: a filter that shows it, its group open. Only when a
  // tag click; later edits to the row keep the user's choices.
  const target = highlight ? items.find((i) => i.id === highlight && i.kind === kind) : undefined;
  useEffect(() => {
    if (!target) return;
    const done = target.checked || !target.isApplicable;
    const mine = (p: PersonFilter) => p === 'all' || target.assignee === p || target.assignee === 'both' || target.assignee === null;
    setPerson((p) => (done ? 'finished' : p !== 'finished' && mine(p) ? p : 'all'));
    setOpenGroups((o) => ({ ...o, [target.category]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightSeq, target?.id]);

  const categories: readonly string[] = kind === 'packing' ? PACKING_CATEGORIES : TASK_CATEGORIES;
  const labels: Record<string, string> = kind === 'packing' ? S.labels.packingCategories : S.labels.taskCategories;
  const ofKind = items.filter((i) => i.kind === kind);
  const finished = (i: ChecklistItem) => i.checked || !i.isApplicable;
  const visible = ofKind.filter((i) =>
    person === 'finished'
      ? finished(i)
      : !finished(i) && (person === 'all' || i.assignee === person || i.assignee === 'both' || i.assignee === null),
  );

  if (!ofKind.length) {
    return (
      <EmptyState
        compact
        icon="checklist"
        title={kind === 'packing' ? S.checklist.emptyPacking : S.checklist.emptyTask}
        actionLabel={kind === 'packing' ? S.checklist.addPacking : S.checklist.addTask}
        onAction={() => onAdd(null)}
      />
    );
  }

  // Unknown categories (renamed later) still show, in an extra group at the end.
  const known = new Set(categories);
  const extra = [...new Set(ofKind.map((i) => i.category).filter((c) => !known.has(c)))];
  const groups = [...categories, ...extra];
  const meKey = me?.profileKey ?? 'eren';
  const people: Array<{ value: PersonFilter; label: string }> = [
    { value: 'all', label: S.checklist.everyone },
    { value: meKey, label: S.people.participants[meKey] },
    { value: meKey === 'eren' ? 'amy' : 'eren', label: S.people.participants[meKey === 'eren' ? 'amy' : 'eren'] },
    { value: 'finished', label: S.checklist.finished },
  ];

  return (
    <div className={styles.list}>
      <div className={styles.toolbar}>
        <ChipGroup label={S.checklist.assigneeFilter} className={styles.filters}>
          {people.map((p) => (
            <Chip
              key={p.value}
              selected={person === p.value}
              className={p.value === 'finished' ? styles.finishedChip : undefined}
              onClick={() => setPerson(p.value)}
            >
              {p.label}
            </Chip>
          ))}
        </ChipGroup>
        <Button variant="secondary" size="sm" iconStart="plus" onClick={() => onAdd(null)}>
          {kind === 'packing' ? S.checklist.addPacking : S.checklist.addTask}
        </Button>
      </div>
      {!visible.length && <p className={styles.muted}>{S.checklist.noMatches}</p>}
      {groups.map((cat, gi) => {
        const all = ofKind.filter((i) => i.category === cat);
        // High, Normal, Low (items marked not needed last); the saved order within each.
        const rows = visible
          .filter((i) => i.category === cat)
          .sort((a, b) => Number(!a.isApplicable) - Number(!b.isApplicable) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortOrder - b.sortOrder);
        if (!all.length && extra.includes(cat)) return null;
        if (!rows.length && person !== 'all') return null;
        const live = all.filter((i) => i.isApplicable);
        const done = live.filter((i) => i.checked).length;
        const open = openGroups[cat] ?? defaultOpen;
        const bodyId = `${baseId}-g${gi}`;
        return (
          <section key={cat} className={styles.group}>
            <h3 className={styles.groupHeading}>
              <button
                type="button"
                className={styles.groupHead}
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpenGroups((o) => ({ ...o, [cat]: !open }))}
              >
                <span className={styles.groupTitle}>{labels[cat] ?? cat}</span>
                <span className={styles.groupCount}>{S.checklist.groupCount(done, live.length)}</span>
                <Icon name="chevron" size={18} rotate={open ? 180 : 0} className={styles.chev} />
              </button>
            </h3>
            <div id={bodyId} hidden={!open} className={styles.groupBody}>
              {cat === 'toiletries' && <p className={styles.groupHint}>{S.checklist.liquidsHint}</p>}
              {rows.length ? (
                <ul className={styles.rows}>
                  {rows.map((item) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      resources={item.resourceIds.map((id) => resources.get(id)).filter((r): r is Resource => !!r)}
                      due={due}
                      busy={pending.has(item.id)}
                      highlighted={item.id === highlight}
                      onToggle={onToggle}
                      onEdit={onEdit}
                    />
                  ))}
                </ul>
              ) : (
                <div className={styles.groupEmpty}>
                  <p className={styles.muted}>{all.some((i) => i.isApplicable) ? S.checklist.allDoneGroup : S.checklist.emptyGroup}</p>
                  <Button variant="link" size="sm" iconStart="plus" onClick={() => onAdd(cat)}>
                    {kind === 'packing' ? S.checklist.addPacking : S.checklist.addTask}
                  </Button>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
