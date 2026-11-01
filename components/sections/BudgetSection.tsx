'use client';
// Budget · Our Travel Budget (plan §7.5). Root id stays "section-wallet".
import { useState } from 'react';
import { BudgetsSheet } from '@/components/budget/BudgetsSheet';
import { BudgetSummary, CategoryBars, ExpenseReceipt, ExpenseTable, FxLine, Settlements, type RowContext } from '@/components/budget/BudgetParts';
import { visibleExpenses, type ScopeView, type StatusView } from '@/components/budget/budgetCalc';
import { ExpenseSheet } from '@/components/budget/ExpenseSheet';
import { SettlementSheet, type SettlementPrefill } from '@/components/budget/SettlementSheet';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSectionNav } from '@/components/checklist/useSectionNav';
import { useShellNav } from '@/components/shell/ShellNav';
import { Button, Card, EmptyState, ErrorState, LoadingState, SectionHeading, SegmentedControl } from '@/components/ui';
import { useBookings, useBudget, useDays, useItinerary, useTrip } from '@/lib/data';
import { useCurrencyFirst } from '@/lib/hooks/useCurrencyFirst';
import type { Currency, Settlement } from '@/lib/types';
import { S } from '@/lib/strings';
import type { SectionProps } from './types';
import styles from '@/components/budget/Budget.module.css';

const VIEWS = ['all', 'paid', 'planned'] as const;
const SCOPES: ScopeView[] = ['all', 'shared', 'eren', 'amy'];
const RECENT = 5;

export default function BudgetSection({ layout }: SectionProps) {
  const budget = useBudget();
  const itinerary = useItinerary();
  const days = useDays();
  const bookings = useBookings();
  const trip = useTrip();
  const due = useDueContext();
  const { goToSection } = useShellNav();
  const nav = useSectionNav<StatusView>('wallet', VIEWS, 'all');
  const [first, setFirst] = useCurrencyFirst(trip.status === 'ready' ? trip.data.trip.displayCurrencyFirst : 'AUD');
  const [scope, setScope] = useState<ScopeView>('all');
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [settle, setSettle] = useState<{ row: Settlement | null; prefill: SettlementPrefill | null } | null>(null);
  const board = layout === 'board';

  const members = trip.status === 'ready' ? trip.data.members : [];
  const data = budget.status === 'ready' ? budget.data : null;
  const openExpense = nav.item && data ? (data.expenses.find((e) => e.id === nav.item) ?? null) : null;

  const scopeSwitch = (
    <SegmentedControl<ScopeView>
      label={S.budget.scopeLabel}
      size="sm"
      fill={!board}
      value={scope}
      onChange={setScope}
      options={SCOPES.map((s) => ({ value: s, label: S.budgetWords.scopes[s] }))}
    />
  );

  let body;
  if (budget.status === 'error') body = <ErrorState onRetry={budget.retry} />;
  else if (!data) body = <LoadingState variant="block" />;
  else {
    const rows = visibleExpenses(data.expenses, scope, nav.view);
    const limited = board && !showAll ? rows.slice(0, RECENT) : rows;
    const ctx: RowContext = {
      members,
      latest: data.latestFx,
      items: itinerary.status === 'ready' ? itinerary.data : [],
      days: days.status === 'ready' ? days.data : [],
      bookings: bookings.status === 'ready' ? bookings.data : [],
      onOpen: (e) => nav.openItem(e.id),
      onRelated: (t) =>
        t.kind === 'item'
          ? goToSection('days', { day: t.item.date, item: t.item.id })
          : goToSection('ready', { view: 'bookings', item: t.booking.id }),
    };
    const today = due?.today ?? null;
    body = (
      <>
        <BudgetSummary budgets={data.budgets} expenses={data.expenses} latest={data.latestFx} scope={scope} first={first} />
        <div className={styles.fxRow}>
          <FxLine latest={data.latestFx} today={today} />
          <div className={styles.fxActions}>
            {/* Same per-device preference as the profile menu: which currency is the large figure. */}
            <SegmentedControl<Currency>
              label={S.budget.showFirst}
              size="sm"
              value={first}
              onChange={setFirst}
              options={[
                { value: 'AUD', label: 'AUD' },
                { value: 'KRW', label: 'KRW' },
              ]}
            />
            <Button variant="link" size="sm" iconStart="edit" onClick={() => setBudgetsOpen(true)}>
              {S.budget.editBudgets}
            </Button>
          </div>
        </div>
        <div className={styles.toolbar}>
          <SegmentedControl<StatusView>
            label={S.budget.statusLabel}
            size="sm"
            value={nav.view}
            onChange={nav.setView}
            options={VIEWS.map((v) => ({ value: v, label: S.budget.statusFilter[v] }))}
          />
          <Button variant="secondary" size="sm" iconStart="plus" onClick={() => setAdding(true)}>
            {S.budget.addExpense}
          </Button>
        </div>
        {!data.expenses.length ? (
          <EmptyState compact icon="budget" title={S.budget.noExpenses} actionLabel={S.budget.addExpense} onAction={() => setAdding(true)} />
        ) : !rows.length ? (
          <p className={styles.muted}>{S.budget.noMatches}</p>
        ) : board ? (
          <ExpenseTable rows={limited} ctx={ctx} />
        ) : (
          <ExpenseReceipt rows={limited} ctx={ctx} />
        )}
        {board && rows.length > RECENT && (
          <Button variant="link" size="sm" className={styles.viewAll} aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? S.budget.showRecent : S.budget.viewAll(rows.length)}
          </Button>
        )}
        <div className={styles.lower}>
          <CategoryBars expenses={data.expenses} latest={data.latestFx} scope={scope} first={first} />
          <Settlements
            expenses={data.expenses}
            settlements={data.settlements}
            members={members}
            latest={data.latestFx}
            first={first}
            onAdd={() => setSettle({ row: null, prefill: null })}
            onSettleUp={(fromMember, amountAud) => setSettle({ row: null, prefill: { fromMember, amountMinor: amountAud, currency: 'AUD' } })}
            onOpen={(s) => setSettle({ row: s, prefill: null })}
          />
        </div>
      </>
    );
  }

  return (
    <section id="section-wallet" aria-labelledby="section-wallet-title" className={styles.root} data-layout={layout}>
      <SectionHeading
        id="section-wallet-title"
        eyebrow={S.sections.wallet.menu}
        title={S.sections.wallet.title}
        intro={S.sections.wallet.intro}
        layout={layout}
        actions={scopeSwitch}
      />
      <Card className={styles.card}>{body}</Card>

      <ExpenseSheet open={!!openExpense || adding} expense={openExpense} onClose={() => (adding ? setAdding(false) : nav.closeItem())} />
      <BudgetsSheet open={budgetsOpen} onClose={() => setBudgetsOpen(false)} />
      <SettlementSheet open={!!settle} settlement={settle?.row ?? null} prefill={settle?.prefill} onClose={() => setSettle(null)} />
    </section>
  );
}
