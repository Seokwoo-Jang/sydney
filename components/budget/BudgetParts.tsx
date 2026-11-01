'use client';
// Budget building blocks (plan §7.5, §7.5.1): summary in two currencies,
// ECB line, expense table (PC) / receipt list (mobile), category bars, settlements.
import { Fragment } from 'react';
import { Button, MemberMarks } from '@/components/ui';
import { balances, formatMoney, summarizeBudget } from '@/lib/money';
import type { Booking, Currency, Expense, FxRate, ItineraryItem, Member, Settlement, TripBudget, TripDay } from '@/lib/types';
import { S } from '@/lib/strings';
import { diffDays, formatDayLabel } from '@/lib/time/zone';
import { approxFlags, categoryTotals, convertedAmount, hasBudget, paidByMember, trimCents, type ScopeView } from './budgetCalc';
import styles from './Budget.module.css';

const other = (c: Currency): Currency => (c === 'AUD' ? 'KRW' : 'AUD');
const key = (c: Currency) => (c === 'AUD' ? 'aud' : 'krw') as 'aud' | 'krw';
const money = (minor: number, c: Currency, approx = false) => trimCents(formatMoney(minor, c, { approx }));
/** Summary figures in whole units ('A$6,000', '≈ ₩5,474,000'), like plan §7.5.1. */
const whole = (minor: number, c: Currency, approx = false) => money(c === 'AUD' ? Math.round(minor / 100) * 100 : minor, c, approx);

// ── summary ──────────────────────────────────────────────────────
export function BudgetSummary({
  budgets,
  expenses,
  latest,
  scope,
  first,
}: {
  budgets: TripBudget[];
  expenses: Expense[];
  latest: FxRate | null;
  scope: ScopeView;
  first: Currency;
}) {
  const sum = summarizeBudget({ budgets, expenses, latest, scope });
  const second = other(first);
  const flagsFirst = approxFlags({ budgets, expenses, latest, scope, display: first });
  const flagsSecond = approxFlags({ budgets, expenses, latest, scope, display: second });
  const any = hasBudget(budgets, scope);
  const showSecond = !sum.missingRate;

  type CellKey = 'budget' | 'spent' | 'planned' | 'remaining' | 'afterPlanned';
  const cells: Array<{ k: CellKey; label: string; needsBudget: boolean }> = [
    { k: 'budget', label: S.budgetWords.budget, needsBudget: true },
    { k: 'spent', label: S.budgetWords.spent, needsBudget: false },
    { k: 'planned', label: S.budgetWords.planned, needsBudget: false },
    { k: 'remaining', label: S.budgetWords.remaining, needsBudget: true },
    { k: 'afterPlanned', label: S.budgetWords.afterPlanned, needsBudget: true },
  ];

  return (
    <dl className={styles.summary} aria-label={S.budget.summaryLabel}>
      {cells.map(({ k, label, needsBudget }) => {
        const pair = sum[k];
        const empty = needsBudget && !any;
        const over = !empty && (k === 'remaining' || k === 'afterPlanned') && pair.aud < 0;
        const fmt = (c: Currency, approx: boolean) => {
          const v = Math.abs(pair[key(c)]);
          const text = whole(v, c, approx);
          return over ? `${S.budgetWords.overBy} ${text}` : text;
        };
        return (
          <div key={k} className={[styles.cell, over ? styles.cellOver : ''].join(' ')}>
            <dt>{label}</dt>
            <dd>
              {empty ? (
                <span className={styles.cellEmpty}>{k === 'budget' ? S.overview.noBudget : '—'}</span>
              ) : (
                <>
                  <span className={styles.primary}>{fmt(first, flagsFirst[k])}</span>
                  {showSecond && <span className={styles.secondary}>{fmt(second, flagsSecond[k])}</span>}
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function FxLine({ latest, today }: { latest: FxRate | null; today: string | null }) {
  if (!latest) return <p className={styles.fx}>{S.budget.noRate}</p>;
  const date = formatDayLabel(latest.rateDate);
  const stale = today ? diffDays(today, latest.rateDate) > 3 : false;
  const rate = `₩${latest.rate.toFixed(2)}`;
  return (
    <div className={styles.fxBlock}>
      <p className={[styles.fx, stale ? styles.fxStale : ''].join(' ')}>{S.fx.rateLine(rate, stale ? S.fx.rateFrom(date) : date)}</p>
      <p className={styles.fxNote}>{S.budget.rateNote}</p>
    </div>
  );
}

// ── expenses ─────────────────────────────────────────────────────
export interface RowContext {
  members: Member[];
  latest: FxRate | null;
  items: ItineraryItem[];
  days: TripDay[];
  bookings: Booking[];
  onOpen: (e: Expense) => void;
  onRelated: (target: { kind: 'item'; item: ItineraryItem } | { kind: 'booking'; booking: Booking }) => void;
}

function StatusDot({ e }: { e: Expense }) {
  return (
    <span className={[styles.status, styles[`st_${e.status}`]].join(' ')}>
      {e.kind === 'refund' ? S.budget.refund : S.labels.expenseStatus[e.status]}
    </span>
  );
}

function Amount({ e, latest }: { e: Expense; latest: FxRate | null }) {
  const sign = e.kind === 'refund' ? -1 : 1;
  const conv = convertedAmount(e, latest);
  return (
    <span className={styles.amount}>
      <span>{formatMoney(sign * e.amountMinor, e.currency)}</span>
      {conv && <small>{formatMoney(sign * conv.minor, conv.currency, { approx: conv.approx })}</small>}
    </span>
  );
}

function related(e: Expense, ctx: RowContext) {
  const item = e.itineraryItemId ? ctx.items.find((i) => i.id === e.itineraryItemId) : undefined;
  if (item) {
    const day = ctx.days.find((d) => d.id === item.dayId);
    return { label: day ? S.time.day(day.dayNumber) : formatDayLabel(item.date), target: { kind: 'item' as const, item } };
  }
  const booking = e.bookingId ? ctx.bookings.find((b) => b.id === e.bookingId) : undefined;
  if (booking) {
    const label = booking.detail.kind === 'flight' ? booking.detail.flightNumber : booking.title;
    return { label, target: { kind: 'booking' as const, booking } };
  }
  return null;
}

const payerName = (e: Expense, members: Member[]) => members.find((m) => m.id === e.payerId)?.displayName ?? '—';

/** PC: Status / Date / Item·Category / Paid by / Amount / Related. Stacks below 560px of width. */
export function ExpenseTable({ rows, ctx }: { rows: Expense[]; ctx: RowContext }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{S.budget.expensesLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{S.budget.columns.status}</th>
            <th scope="col">{S.budget.columns.date}</th>
            <th scope="col">{S.budget.columns.item}</th>
            <th scope="col">{S.budget.columns.paidBy}</th>
            <th scope="col" className={styles.amt}>
              {S.budget.columns.amount}
            </th>
            <th scope="col">{S.budget.columns.related}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const rel = related(e, ctx);
            return (
              <tr key={e.id} className={e.status === 'cancelled' ? styles.rowCancelled : undefined}>
                <td data-label={S.budget.columns.status}>
                  <StatusDot e={e} />
                </td>
                <td data-label={S.budget.columns.date} className={styles.date}>
                  {formatDayLabel(e.date)}
                </td>
                <td data-label={S.budget.columns.item}>
                  <button type="button" className={styles.itemButton} onClick={() => ctx.onOpen(e)}>
                    <span className={styles.itemTitle}>{e.title}</span>
                    <span className={styles.itemCat}>{S.labels.expenseCategory[e.category]}</span>
                  </button>
                </td>
                <td data-label={S.budget.columns.paidBy}>{payerName(e, ctx.members)}</td>
                <td data-label={S.budget.columns.amount} className={styles.amt}>
                  <Amount e={e} latest={ctx.latest} />
                </td>
                <td data-label={S.budget.columns.related}>
                  {rel ? (
                    <button type="button" className={styles.relButton} onClick={() => ctx.onRelated(rel.target)}>
                      {rel.label}
                    </button>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Mobile: receipt-like list grouped by date. */
export function ExpenseReceipt({ rows, ctx }: { rows: Expense[]; ctx: RowContext }) {
  const groups: Array<{ date: string; rows: Expense[] }> = [];
  for (const e of rows) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.rows.push(e);
    else groups.push({ date: e.date, rows: [e] });
  }
  return (
    <div className={styles.receipt}>
      {groups.map((g) => (
        <Fragment key={g.date}>
          <h4 className={styles.receiptDate}>{formatDayLabel(g.date)}</h4>
          <ul className={styles.receiptList}>
            {g.rows.map((e) => {
              const rel = related(e, ctx);
              return (
                <li key={e.id} className={e.status === 'cancelled' ? styles.rowCancelled : undefined}>
                  <button type="button" className={styles.receiptRow} onClick={() => ctx.onOpen(e)}>
                    <span className={styles.receiptText}>
                      <span className={styles.itemTitle}>{e.title}</span>
                      <span className={styles.receiptMeta}>
                        <StatusDot e={e} />
                        <span>{S.labels.expenseCategory[e.category]}</span>
                        <span>{payerName(e, ctx.members)}</span>
                        {rel && <span className={styles.relText}>{rel.label}</span>}
                      </span>
                    </span>
                    <Amount e={e} latest={ctx.latest} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}

// ── category bars ────────────────────────────────────────────────
export function CategoryBars({ expenses, latest, scope, first }: { expenses: Expense[]; latest: FxRate | null; scope: ScopeView; first: Currency }) {
  const rows = categoryTotals(expenses, latest, scope);
  if (!rows.length) return null;
  const k = key(first);
  const max = Math.max(...rows.map((r) => r[k]), 1);
  return (
    <section className={styles.block} aria-labelledby="budget-by-category">
      <div className={styles.blockHead}>
        <h3 id="budget-by-category" className={styles.blockTitle}>
          {S.budget.byCategory}
        </h3>
        <span className={styles.muted}>{S.budget.byCategoryNote}</span>
      </div>
      <ul className={styles.bars}>
        {rows.map((r) => (
          <li key={r.category} className={styles.barRow}>
            <span className={styles.barLabel}>{S.labels.expenseCategory[r.category]}</span>
            <span className={styles.barValue}>
              {money(r[k], first)}
              <small>{money(r[key(other(first))], other(first), true)}</small>
            </span>
            <span className={styles.bar} aria-hidden="true">
              <i style={{ width: `${Math.max(2, Math.round((r[k] / max) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── settlements ──────────────────────────────────────────────────
export function Settlements({
  expenses,
  settlements,
  members,
  latest,
  first,
  onAdd,
  onSettleUp,
  onOpen,
}: {
  expenses: Expense[];
  settlements: Settlement[];
  members: Member[];
  latest: FxRate | null;
  first: Currency;
  onAdd: () => void;
  onSettleUp: (fromMember: string, amountAud: number) => void;
  onOpen: (s: Settlement) => void;
}) {
  const { erenOwesAmyAud } = balances(expenses, settlements, members, latest);
  const eren = members.find((m) => m.profileKey === 'eren');
  const amy = members.find((m) => m.profileKey === 'amy');
  const owes = Math.abs(erenOwesAmyAud) >= 1 && eren && amy;
  const debtor = erenOwesAmyAud > 0 ? eren : amy;
  const creditor = erenOwesAmyAud > 0 ? amy : eren;
  const abs = Math.abs(erenOwesAmyAud);
  const krw = latest ? Math.round((abs / 100) * latest.rate) : null;
  const name = (id: string) => members.find((m) => m.id === id)?.displayName ?? '';
  const paid = paidByMember(expenses, members, latest);

  const amountText = first === 'AUD' || krw == null ? formatMoney(abs, 'AUD') : formatMoney(krw, 'KRW', { approx: true });
  const otherText = first === 'AUD' ? (krw != null ? formatMoney(krw, 'KRW', { approx: true }) : null) : formatMoney(abs, 'AUD');

  return (
    <section className={styles.block} aria-labelledby="budget-settlements">
      <div className={styles.blockHead}>
        <h3 id="budget-settlements" className={styles.blockTitle}>
          {S.budgetWords.settlements}
        </h3>
      </div>
      <div className={styles.balance} role="status">
        {owes && debtor && creditor ? (
          <>
            <span className={styles.balanceWho}>
              <span aria-hidden="true">
                <MemberMarks who={debtor.profileKey} size="sm" />
              </span>
              {S.budget.owes(debtor.displayName, creditor.displayName)}
            </span>
            <span className={styles.balanceAmount}>
              {amountText}
              {otherText && <small>{otherText}</small>}
            </span>
          </>
        ) : (
          <span className={styles.balanceWho}>{S.budget.allSettled}</span>
        )}
      </div>
      <p className={styles.paidTotals}>
        {paid.map((p) => (
          <span key={p.member.id}>
            {S.budget.paidTotal(p.member.displayName)} · {money(p.aud, 'AUD')}
          </span>
        ))}
      </p>
      {settlements.length > 0 && (
        <ul className={styles.settleList}>
          {settlements.map((s) => (
            <li key={s.id}>
              <button type="button" className={styles.settleRow} onClick={() => onOpen(s)}>
                <span className={styles.receiptText}>
                  <span className={styles.itemTitle}>{S.budget.paidTo(name(s.fromMember), name(s.toMember))}</span>
                  <span className={styles.receiptMeta}>
                    <span>{formatDayLabel(s.date)}</span>
                    {s.note && <span className={styles.note}>{s.note}</span>}
                  </span>
                </span>
                <span className={styles.amount}>
                  <span>{formatMoney(s.amountMinor, s.currency)}</span>
                  {s.fxRate && (
                    <small>
                      {s.currency === 'AUD'
                        ? formatMoney(Math.round((s.amountMinor / 100) * s.fxRate), 'KRW')
                        : formatMoney(Math.round((s.amountMinor / s.fxRate) * 100), 'AUD')}
                    </small>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.blockActions}>
        {owes && debtor && (
          <Button variant="secondary" size="sm" onClick={() => onSettleUp(debtor.id, abs)}>
            {S.budget.settleUp}
          </Button>
        )}
        <Button variant="ghost" size="sm" iconStart="plus" onClick={onAdd}>
          {S.budget.addSettlement}
        </Button>
      </div>
    </section>
  );
}
