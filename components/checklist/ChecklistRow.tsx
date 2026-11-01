'use client';
// One Packing or To-do row: native checkbox (44px target), title, chips for
// assignee / quantity / due date, and an edit button.
import { useId } from 'react';
import { IconButton, MemberMarks } from '@/components/ui';
import type { ChecklistItem, Member } from '@/lib/types';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { dueState, type DueContext } from './due';
import styles from './Checklist.module.css';

export function assigneeLabel(a: ChecklistItem['assignee'], me: Member | null): string {
  if (a === 'both' || a === null) return S.people.shared;
  const name = S.people.participants[a];
  return me?.profileKey === a ? `${name} (${S.people.me})` : name;
}

export function ChecklistRow({
  item,
  me,
  due,
  busy,
  onToggle,
  onEdit,
  compact,
}: {
  item: ChecklistItem;
  me: Member | null;
  due: DueContext | null;
  busy: boolean;
  onToggle: (item: ChecklistItem) => void;
  onEdit: (item: ChecklistItem) => void;
  compact?: boolean;
}) {
  const metaId = useId();
  const state = due ? dueState(item, due) : 'none';
  const meta: Array<{ key: string; text: string; tone?: 'overdue' | 'soon' }> = [];
  if (!item.isApplicable) meta.push({ key: 'na', text: S.checklist.notNeeded });
  if (item.dueDate && item.kind === 'task') {
    const label = formatDayLabel(item.dueDate);
    if (state === 'overdue') meta.push({ key: 'due', text: S.checklist.overdueSince(label), tone: 'overdue' });
    else if (due && item.dueDate === due.today && !item.checked) meta.push({ key: 'due', text: S.checklist.dueToday, tone: 'soon' });
    else meta.push({ key: 'due', text: S.checklist.due(label), tone: state === 'soon' ? 'soon' : undefined });
  }
  if (item.quantity && item.quantity > 1) meta.push({ key: 'qty', text: S.checklist.quantityShort(item.quantity) });
  if (item.priority === 'high' && !item.checked) meta.push({ key: 'pri', text: S.checklist.highPriority });
  const who = item.assignee === 'both' || item.assignee === null ? 'together' : item.assignee;

  return (
    <li
      className={[styles.row, compact ? styles.rowCompact : '', item.isApplicable ? '' : styles.rowNa, item.checked ? styles.rowDone : '']
        .filter(Boolean)
        .join(' ')}
    >
      <label className={styles.check}>
        <input
          type="checkbox"
          className={styles.box}
          checked={item.checked}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-describedby={metaId}
          onChange={() => onToggle(item)}
        />
        <span className={styles.rowTitle}>{item.title}</span>
      </label>
      <span id={metaId} className={styles.rowMeta}>
        <span className={styles.metaWho}>
          <span aria-hidden="true">
            <MemberMarks who={who} size="sm" />
          </span>
          <span>{assigneeLabel(item.assignee, me)}</span>
        </span>
        {meta.map((m) => (
          <span key={m.key} className={m.tone ? styles[m.tone] : undefined}>
            {m.text}
          </span>
        ))}
      </span>
      <IconButton
        icon="edit"
        label={`${S.actions.edit}: ${item.title}`}
        className={styles.rowEdit}
        onClick={() => onEdit(item)}
      />
    </li>
  );
}
