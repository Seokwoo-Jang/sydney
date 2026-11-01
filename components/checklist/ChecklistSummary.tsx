'use client';
// Top of Before We Go: separate Packing / To-do progress (plan §7.4) and the
// next open to-dos, overdue first (max 4, plan §5.3).
import type { ChecklistItem, Resource } from '@/lib/types';
import { S } from '@/lib/strings';
import { ChecklistRow } from './ChecklistRow';
import { progress, upcomingTasks, type DueContext } from './due';
import styles from './Checklist.module.css';

function Bar({ label, value, done, total }: { label: string; value: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={styles.progressRow}>
      <div className={styles.progressHead}>
        <span>{label}</span>
        <span className={styles.progressValue}>{value}</span>
      </div>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={value}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ChecklistProgress({ items }: { items: ChecklistItem[] }) {
  const packing = progress(items, 'packing');
  const tasks = progress(items, 'task');
  return (
    <div className={styles.progress} aria-label={S.checklist.progressLabel} role="group">
      <Bar label={S.labels.checklistViews.packing} value={S.checklist.packingProgress(packing.done, packing.total)} {...packing} />
      <Bar label={S.labels.checklistViews.task} value={S.checklist.taskProgress(tasks.done, tasks.total)} {...tasks} />
    </div>
  );
}

export function ComingUp({
  items,
  resources,
  due,
  pending,
  onToggle,
  onEdit,
}: {
  items: ChecklistItem[];
  resources: ReadonlyMap<string, Resource>;
  due: DueContext | null;
  pending: ReadonlySet<string>;
  onToggle: (item: ChecklistItem) => void;
  onEdit: (item: ChecklistItem) => void;
}) {
  if (!due) return null;
  const next = upcomingTasks(items, due, 4);
  return (
    <section className={styles.comingUp} aria-labelledby="ready-coming-up">
      <h3 id="ready-coming-up" className={styles.subhead}>
        {S.checklist.comingUp}
      </h3>
      {next.length ? (
        <ul className={styles.rows}>
          {next.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              resource={item.resourceId ? resources.get(item.resourceId) : null}
              due={due}
              busy={pending.has(item.id)}
              onToggle={onToggle}
              onEdit={onEdit}
              compact
            />
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>{S.checklist.nothingComingUp}</p>
      )}
    </section>
  );
}
