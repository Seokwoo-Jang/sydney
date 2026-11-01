'use client';
// One Packing or To-do row: native checkbox (44px target) marks it done; the
// title opens the notes below it; chips for assignee / quantity / due date /
// priority (to-dos: High in red, Middle in ink, Low in grey); an edit button.
import { useId, useState } from 'react';
import { Icon, IconButton, MemberMarks } from '@/components/ui';
import type { ChecklistItem } from '@/lib/types';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { dueState, type DueContext } from './due';
import styles from './Checklist.module.css';

// No "(Me)" here: the meta line stays short enough for the priority on one line.
export function assigneeLabel(a: ChecklistItem['assignee']): string {
  if (a === 'both' || a === null) return S.people.shared;
  return S.people.participants[a];
}

export function ChecklistRow({
  item,
  due,
  busy,
  onToggle,
  onEdit,
  compact,
  highlighted,
}: {
  item: ChecklistItem;
  due: DueContext | null;
  busy: boolean;
  onToggle: (item: ChecklistItem) => void;
  onEdit: (item: ChecklistItem) => void;
  compact?: boolean;
  highlighted?: boolean;
}) {
  const metaId = useId();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const state = due ? dueState(item, due) : 'none';
  const meta: Array<{ key: string; text: string; tone?: 'overdue' | 'soon' | 'high' | 'normal' | 'low' }> = [];
  if (!item.isApplicable) meta.push({ key: 'na', text: S.checklist.notNeeded });
  if (item.dueDate && item.kind === 'task') {
    const label = formatDayLabel(item.dueDate);
    if (state === 'overdue') meta.push({ key: 'due', text: S.checklist.overdueSince(label), tone: 'overdue' });
    else if (due && item.dueDate === due.today && !item.checked) meta.push({ key: 'due', text: S.checklist.dueToday, tone: 'soon' });
    else meta.push({ key: 'due', text: S.checklist.due(label), tone: state === 'soon' ? 'soon' : undefined });
  }
  if (item.quantity && item.quantity > 1) meta.push({ key: 'qty', text: S.checklist.quantityShort(item.quantity) });
  if (item.kind === 'task') {
    // A finished to-do keeps its label but drops the colour.
    meta.push({ key: 'pri', text: S.checklist.priorityLabel[item.priority], tone: item.checked ? undefined : item.priority });
  }
  const who = item.assignee === 'both' || item.assignee === null ? 'together' : item.assignee;

  return (
    <li
      className={[
        styles.row,
        compact ? styles.rowCompact : '',
        item.isApplicable ? '' : styles.rowNa,
        item.checked ? styles.rowDone : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-check-id={item.id}
      data-highlight={highlighted || undefined}
    >
      <div className={styles.check}>
        <label className={styles.boxHit}>
          <input
            type="checkbox"
            className={styles.box}
            checked={item.checked}
            disabled={busy}
            aria-busy={busy || undefined}
            aria-label={`${item.kind === 'packing' ? S.labels.packed : S.labels.done}: ${item.title}`}
            aria-describedby={metaId}
            onChange={() => onToggle(item)}
          />
        </label>
        <button
          type="button"
          className={styles.titleButton}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.rowTitle}>{item.title}</span>
          <Icon name="chevron" size={16} rotate={open ? 180 : 0} className={styles.titleChevron} />
        </button>
      </div>
      <span id={metaId} className={styles.rowMeta}>
        <span className={styles.metaWho}>
          <span aria-hidden="true">
            <MemberMarks who={who} size="sm" />
          </span>
          <span>{assigneeLabel(item.assignee)}</span>
        </span>
        {meta.map((m) => (
          <span key={m.key} className={[m.tone ? styles[m.tone] : '', m.key === 'pri' ? styles.priority : ''].filter(Boolean).join(' ') || undefined}>
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
      <div id={detailsId} className={styles.rowDetails} hidden={!open}>
        {item.notes.trim() ? <p className={styles.rowNotes}>{item.notes}</p> : <p className={styles.rowNoNotes}>{S.checklist.noNotes}</p>}
      </div>
    </li>
  );
}
