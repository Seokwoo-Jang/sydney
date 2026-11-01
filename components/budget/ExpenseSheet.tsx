'use client';
// Add / edit an expense (plan §7.5, §7.5.1). Amounts are parsed to integer
// minor units; the split must add up; rates lock on payment or by hand.
import { useMemo, useState } from 'react';
import { ConfirmDelete, ConflictBlock } from '@/components/checklist/FormBits';
import { useDraft } from '@/components/checklist/useDraft';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, Field, SaveStatus, SegmentedControl, Select, Sheet, TextInput } from '@/components/ui';
import { newId, useBookings, useBudget, useDays, useItinerary, useTrip } from '@/lib/data';
import { formatMoney, rateForExpense, splitAmount, toMinor } from '@/lib/money';
import type { BudgetScope, Currency, Expense, ExpenseCategory, ExpenseStatus, SplitMode } from '@/lib/types';
import { S } from '@/lib/strings';
import { formatDayLabel } from '@/lib/time/zone';
import { rateForDate, scopeForSplit, splitForParticipants } from './budgetCalc';
import form from '@/components/checklist/Form.module.css';

const CATEGORIES: ExpenseCategory[] = ['flights', 'stays', 'food', 'transport', 'sightseeing', 'business', 'shopping', 'other'];
const SPLITS: SplitMode[] = ['equal', 'eren', 'amy', 'custom'];

interface Draft {
  id: string;
  version: number;
  date: string;
  title: string;
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  payerId: string;
  splitMode: SplitMode;
  customEren: string;
  customAmy: string;
  budgetScope: BudgetScope;
  scopeTouched: boolean;
  splitTouched: boolean;
  status: ExpenseStatus;
  krwCharged: string;
  rate: string;
  itineraryItemId: string;
  bookingId: string;
}

const minorToInput = (minor: number, c: Currency) => (c === 'AUD' ? (minor / 100).toFixed(2) : String(minor));

function parse(amount: string, c: Currency): number | null {
  try {
    return amount.trim() ? toMinor(amount, c) : null;
  } catch {
    return null;
  }
}

function toDraft(e: Expense | null, prefill: Partial<Expense>, today: string, meId: string): Draft {
  const src = { ...prefill, ...(e ?? {}) } as Partial<Expense>;
  const currency = src.currency ?? 'AUD';
  const splitMode = src.splitMode ?? 'equal';
  return {
    id: e?.id ?? newId(),
    version: e?.version ?? 0,
    date: src.date ?? today,
    title: src.title ?? '',
    amount: src.amountMinor != null ? minorToInput(src.amountMinor, currency) : '',
    currency,
    category: src.category ?? 'other',
    payerId: src.payerId ?? (e ? '' : meId),
    splitMode,
    customEren: src.splitEren != null ? minorToInput(src.splitEren, currency) : '',
    customAmy: src.splitAmy != null ? minorToInput(src.splitAmy, currency) : '',
    budgetScope: src.budgetScope ?? scopeForSplit(splitMode),
    scopeTouched: !!e,
    splitTouched: !!e || prefill.splitMode != null,
    status: src.status ?? 'planned',
    krwCharged: src.krwChargedMinor != null ? String(src.krwChargedMinor) : '',
    rate: e?.fxManual && e.fxRate ? String(e.fxRate) : '',
    itineraryItemId: src.itineraryItemId ?? '',
    bookingId: src.bookingId ?? '',
  };
}

export function ExpenseSheet({
  open,
  expense,
  prefill = {},
  onClose,
}: {
  open: boolean;
  expense: Expense | null;
  /** Defaults for a new expense (e.g. from a booking). */
  prefill?: Partial<Expense>;
  onClose: () => void;
}) {
  const budget = useBudget();
  const itinerary = useItinerary();
  const bookings = useBookings();
  const days = useDays();
  const trip = useTrip();
  const dueCtx = useDueContext();
  const me = trip.status === 'ready' ? trip.data.me : null;
  const partner = trip.status === 'ready' ? trip.data.partner : null;
  const members = trip.status === 'ready' ? trip.data.members : [];
  const fxRates = budget.status === 'ready' ? budget.data.fxRates : [];
  const latest = budget.status === 'ready' ? budget.data.latestFx : null;
  const today = dueCtx?.today ?? new Date().toISOString().slice(0, 10);

  const [draft, patch] = useDraft<Draft>(open, expense?.id ?? null, () => toDraft(expense, prefill, today, me?.id ?? ''));
  const save = useSaveFlow<Expense>();
  const [tried, setTried] = useState(false);
  const isNew = !expense;

  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  const items = itinerary.status === 'ready' ? itinerary.data : [];
  const dayNumber = useMemo(() => new Map((days.status === 'ready' ? days.data : []).map((d) => [d.id, d.dayNumber])), [days]);
  const linkedItem = items.find((i) => i.id === draft.itineraryItemId) ?? null;

  // ── validation ──
  const total = parse(draft.amount, draft.currency);
  const custom = { eren: parse(draft.customEren, draft.currency), amy: parse(draft.customAmy, draft.currency) };
  const krw = draft.currency === 'AUD' ? parse(draft.krwCharged, 'KRW') : null;
  const rate = draft.rate.trim() ? Number(draft.rate.replace(/,/g, '')) : null;
  const errors = {
    title: draft.title.trim() ? null : S.checklist.titleRequired,
    amount: total === null ? S.budget.amountInvalid : total <= 0 ? S.budget.amountPositive : null,
    split:
      draft.splitMode === 'custom' && total !== null && total > 0
        ? custom.eren === null || custom.amy === null || custom.eren < 0 || custom.amy < 0 || custom.eren + custom.amy !== total
          ? S.budget.splitMismatch(formatMoney(total, draft.currency))
          : null
        : null,
    payer: draft.status === 'paid' && !draft.payerId ? S.budget.payerRequired : null,
    krw: draft.krwCharged.trim() && (krw === null || krw < 0) ? S.budget.amountInvalid : null,
    rate: rate !== null && !(rate > 0) ? S.budget.rateInvalid : null,
    date: draft.date ? null : S.checklist.timeRequired,
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? (errors[k] ?? undefined) : undefined);

  const setSplit = (mode: SplitMode) => {
    const p: Partial<Draft> = { splitMode: mode, splitTouched: true };
    if (!draft.scopeTouched) p.budgetScope = scopeForSplit(mode);
    if (mode === 'custom' && total && !draft.customEren && !draft.customAmy) {
      const eq = splitAmount(total, 'equal');
      p.customEren = minorToInput(eq.eren, draft.currency);
      p.customAmy = minorToInput(eq.amy, draft.currency);
    }
    edit(p);
  };

  const setItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    const p: Partial<Draft> = { itineraryItemId: id };
    if (item && !draft.splitTouched) {
      p.splitMode = splitForParticipants(item.participants);
      if (!draft.scopeTouched) p.budgetScope = scopeForSplit(p.splitMode);
    }
    if (item && !draft.date) p.date = item.date;
    edit(p);
  };

  const submit = async () => {
    setTried(true);
    if (invalid || total === null) return;
    const split = splitAmount(total, draft.splitMode, draft.splitMode === 'custom' ? { eren: custom.eren ?? 0, amy: custom.amy ?? 0 } : undefined);
    let fx: Pick<Expense, 'fxRate' | 'fxRateDate' | 'fxLocked' | 'fxManual'> = { fxRate: null, fxRateDate: null, fxLocked: false, fxManual: false };
    if (rate !== null) fx = { fxRate: rate, fxRateDate: draft.date, fxLocked: true, fxManual: true };
    else if (draft.status === 'paid') {
      const keep =
        expense && expense.status === 'paid' && !expense.fxManual && expense.fxRate && expense.date === draft.date && expense.currency === draft.currency;
      if (keep) fx = { fxRate: expense.fxRate, fxRateDate: expense.fxRateDate, fxLocked: expense.fxLocked, fxManual: false };
      else {
        const r = rateForDate(fxRates, draft.date);
        if (r) fx = { fxRate: r.rate, fxRateDate: r.rateDate, fxLocked: r.exact, fxManual: false };
      }
    }
    const fields = {
      date: draft.date,
      kind: expense?.kind ?? prefill.kind ?? ('expense' as const),
      status: draft.status,
      title: draft.title.trim(),
      amountMinor: total,
      currency: draft.currency,
      payerId: draft.payerId || null,
      splitMode: draft.splitMode,
      splitEren: split.eren,
      splitAmy: split.amy,
      budgetScope: draft.budgetScope,
      ...fx,
      krwChargedMinor: draft.currency === 'AUD' ? krw : null,
      category: draft.category,
      bookingId: draft.bookingId || null,
      itineraryItemId: draft.itineraryItemId || null,
      refundOfId: expense?.refundOfId ?? prefill.refundOfId ?? null,
    };
    const result = await save.run(() => (isNew ? budget.create({ id: draft.id, ...fields }) : budget.update(draft.id, fields, draft.version)));
    if (result.ok) onClose();
  };

  const remove = async () => {
    if (!expense) return;
    const result = await save.run(() => budget.remove(expense.id, draft.version));
    if (result.ok) onClose();
  };

  const used = expense ? rateForExpense(expense, latest) : null;
  const rateLine =
    used?.rate && used.rateDate ? S.budget.rateUsedLine(used.rate.toFixed(2), formatDayLabel(used.rateDate)) : null;
  const memberName = (key: 'eren' | 'amy') => members.find((m) => m.profileKey === key)?.displayName ?? S.people.participants[key];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? S.budget.newExpense : S.budget.editExpense}
      description={!isNew ? expense.title : undefined}
      headerExtra={<SaveStatus state={save.state} />}
      footer={
        <div className={form.footer}>
          {!isNew && <ConfirmDelete onConfirm={remove} busy={save.busy} />}
          <div className={form.footerEnd}>
            <Button variant="ghost" onClick={onClose}>
              {S.actions.cancel}
            </Button>
            <Button variant="primary" busy={save.busy} onClick={submit}>
              {S.actions.save}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className={form.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {save.conflict && (
          <ConflictBlock
            key={save.conflict.latest?.version ?? 0}
            latest={save.conflict.latest}
            me={me}
            partner={partner}
            onRebase={(l) => patch({ version: l.version })}
            renderLatest={(l) => (
              <p className={form.latestBody}>
                {l.title} · {formatMoney(l.amountMinor, l.currency)} · {S.labels.expenseStatus[l.status]}
              </p>
            )}
            onUseLatest={(l) => patch(toDraft(l, {}, today, me?.id ?? ''))}
          />
        )}
        <div className={form.grid2}>
          <Field label={S.fields.date} error={err('date')}>
            <TextInput type="date" value={draft.date} onChange={(e) => edit({ date: e.target.value })} />
          </Field>
          <Field label={S.fields.status}>
            <Select
              value={draft.status}
              onChange={(e) => edit({ status: e.target.value as ExpenseStatus })}
              options={(['planned', 'paid', 'cancelled'] as const).map((s) => ({ value: s, label: S.labels.expenseStatus[s] }))}
            />
          </Field>
        </div>
        <Field label={S.fields.title} error={err('title')}>
          <TextInput value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
        </Field>
        <div className={form.grid2}>
          <Field label={S.fields.amount} error={err('amount')}>
            <TextInput inputMode="decimal" autoComplete="off" value={draft.amount} onChange={(e) => edit({ amount: e.target.value })} />
          </Field>
          <Field label={S.fields.currency}>
            <SegmentedControl<Currency>
              label={S.fields.currency}
              fill
              size="sm"
              value={draft.currency}
              onChange={(c) => edit({ currency: c })}
              options={[
                { value: 'AUD', label: 'AUD' },
                { value: 'KRW', label: 'KRW' },
              ]}
            />
          </Field>
        </div>
        <div className={form.grid2}>
          <Field label={S.fields.category}>
            <Select
              value={draft.category}
              onChange={(e) => edit({ category: e.target.value as ExpenseCategory })}
              options={CATEGORIES.map((c) => ({ value: c, label: S.labels.expenseCategory[c] }))}
            />
          </Field>
          <Field label={S.fields.paidBy} error={err('payer')}>
            <Select
              value={draft.payerId}
              onChange={(e) => edit({ payerId: e.target.value })}
              options={[{ value: '', label: S.budget.noPayer }, ...members.map((m) => ({ value: m.id, label: m.displayName }))]}
            />
          </Field>
        </div>
        <Field label={S.budget.split} hint={draft.splitMode === 'equal' ? S.budget.oddCent : undefined} error={err('split')}>
          <Select
            value={draft.splitMode}
            onChange={(e) => setSplit(e.target.value as SplitMode)}
            options={SPLITS.map((m) => ({ value: m, label: S.labels.splitMode[m] }))}
          />
        </Field>
        {draft.splitMode === 'custom' && (
          <div className={form.grid2}>
            <Field label={S.budget.shareOf(memberName('eren'))}>
              <TextInput inputMode="decimal" value={draft.customEren} onChange={(e) => edit({ customEren: e.target.value })} />
            </Field>
            <Field label={S.budget.shareOf(memberName('amy'))}>
              <TextInput inputMode="decimal" value={draft.customAmy} onChange={(e) => edit({ customAmy: e.target.value })} />
            </Field>
          </div>
        )}
        <div className={form.grid2}>
          <Field label={S.budget.scope}>
            <Select
              value={draft.budgetScope}
              onChange={(e) => edit({ budgetScope: e.target.value as BudgetScope, scopeTouched: true })}
              options={(['shared', 'eren', 'amy'] as const).map((s) => ({ value: s, label: S.budgetWords.scopes[s] }))}
            />
          </Field>
          <Field label={S.budget.linkedBooking} optional>
            <Select
              value={draft.bookingId}
              onChange={(e) => edit({ bookingId: e.target.value })}
              options={[
                { value: '', label: S.budget.none },
                ...(bookings.status === 'ready' ? bookings.data : []).map((b) => ({ value: b.id, label: b.title })),
              ]}
            />
          </Field>
        </div>
        <Field label={S.budget.linkedItem} optional hint={linkedItem && !expense ? S.budget.splitFromPlan : undefined}>
          <Select
            value={draft.itineraryItemId}
            onChange={(e) => setItem(e.target.value)}
            options={[
              { value: '', label: S.budget.none },
              ...items.map((i) => ({
                value: i.id,
                label: `${dayNumber.has(i.dayId) ? `${S.time.day(dayNumber.get(i.dayId)!)} · ` : ''}${i.title}`,
              })),
            ]}
          />
        </Field>
        {draft.currency === 'AUD' && (
          <Field label={S.budget.krwCharged} optional hint={S.budget.krwChargedHint} error={err('krw')}>
            <TextInput inputMode="numeric" value={draft.krwCharged} onChange={(e) => edit({ krwCharged: e.target.value })} />
          </Field>
        )}
        <Field label={S.fx.rateUsed} optional hint={rateLine ? `${rateLine}. ${S.budget.rateHint}` : S.budget.rateHint} error={err('rate')}>
          <TextInput
            inputMode="decimal"
            value={draft.rate}
            placeholder={latest ? latest.rate.toFixed(2) : undefined}
            onChange={(e) => edit({ rate: e.target.value })}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
