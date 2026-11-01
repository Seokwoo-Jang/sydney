'use client';
// Settlement transfer (plan §7.5.0): kept apart from expenses, rate fixed on the record.
import { useState } from 'react';
import { ConfirmDelete, ConflictBlock } from '@/components/checklist/FormBits';
import { useDraft } from '@/components/checklist/useDraft';
import { useDueContext } from '@/components/checklist/useDueContext';
import { useSaveFlow } from '@/components/checklist/useSaveFlow';
import { Button, Field, SaveStatus, SegmentedControl, Select, Sheet, TextInput } from '@/components/ui';
import { newId, useBudget, useTrip } from '@/lib/data';
import { formatMoney, toMinor } from '@/lib/money';
import type { Currency, Settlement } from '@/lib/types';
import { S } from '@/lib/strings';
import form from '@/components/checklist/Form.module.css';

interface Draft {
  id: string;
  version: number;
  fromMember: string;
  amount: string;
  currency: Currency;
  date: string;
  rate: string;
  note: string;
}

export interface SettlementPrefill {
  fromMember: string;
  amountMinor: number;
  currency: Currency;
}

export function SettlementSheet({
  open,
  settlement,
  prefill,
  onClose,
}: {
  open: boolean;
  settlement: Settlement | null;
  prefill?: SettlementPrefill | null;
  onClose: () => void;
}) {
  const budget = useBudget();
  const trip = useTrip();
  const due = useDueContext();
  const members = trip.status === 'ready' ? trip.data.members : [];
  const me = trip.status === 'ready' ? trip.data.me : null;
  const partner = trip.status === 'ready' ? trip.data.partner : null;
  const latest = budget.status === 'ready' ? budget.data.latestFx : null;
  const today = due?.today ?? new Date().toISOString().slice(0, 10);

  const init = (s: Settlement | null): Draft => {
    const currency = s?.currency ?? prefill?.currency ?? 'AUD';
    const minor = s?.amountMinor ?? prefill?.amountMinor ?? null;
    return {
      id: s?.id ?? newId(),
      version: s?.version ?? 0,
      fromMember: s?.fromMember ?? prefill?.fromMember ?? me?.id ?? members[0]?.id ?? '',
      amount: minor == null ? '' : currency === 'AUD' ? (minor / 100).toFixed(2) : String(minor),
      currency,
      date: s?.date ?? today,
      rate: s?.fxRate ? String(s.fxRate) : latest ? latest.rate.toFixed(2) : '',
      note: s?.note ?? '',
    };
  };
  const [draft, patch] = useDraft<Draft>(open, settlement?.id ?? null, () => init(settlement));
  const save = useSaveFlow<Settlement>();
  const [tried, setTried] = useState(false);
  const isNew = !settlement;
  const edit = (p: Partial<Draft>) => {
    patch(p);
    save.markDirty();
  };

  let amount: number | null = null;
  try {
    amount = draft.amount.trim() ? toMinor(draft.amount, draft.currency) : null;
  } catch {
    amount = null;
  }
  const rate = draft.rate.trim() ? Number(draft.rate.replace(/,/g, '')) : null;
  const toMember = members.find((m) => m.id !== draft.fromMember);
  const errors = {
    amount: amount === null ? S.budget.amountInvalid : amount <= 0 ? S.budget.amountPositive : null,
    rate: rate !== null && !(rate > 0) ? S.budget.rateInvalid : null,
    people: toMember ? null : S.budget.samePerson,
  };
  const err = (k: keyof typeof errors) => (tried ? (errors[k] ?? undefined) : undefined);

  const submit = async () => {
    setTried(true);
    if (errors.amount || errors.rate || errors.people || amount === null || !toMember) return;
    const fields = {
      fromMember: draft.fromMember,
      toMember: toMember.id,
      amountMinor: amount,
      currency: draft.currency,
      date: draft.date || today,
      fxRate: rate ?? latest?.rate ?? null,
      note: draft.note.trim(),
    };
    const result = await save.run(() =>
      isNew ? budget.settlements.create({ id: draft.id, ...fields }) : budget.settlements.update(draft.id, fields, draft.version),
    );
    if (result.ok) onClose();
  };

  const remove = async () => {
    if (!settlement) return;
    const result = await save.run(() => budget.settlements.remove(settlement.id, draft.version));
    if (result.ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? S.budget.newSettlement : S.budget.editSettlement}
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
            renderLatest={(l) => <p className={form.latestBody}>{formatMoney(l.amountMinor, l.currency)}</p>}
          />
        )}
        <div className={form.grid2}>
          <Field label={S.budget.from} error={err('people')}>
            <Select
              value={draft.fromMember}
              onChange={(e) => edit({ fromMember: e.target.value })}
              options={members.map((m) => ({ value: m.id, label: m.displayName }))}
            />
          </Field>
          <Field label={S.budget.to}>
            <TextInput value={toMember?.displayName ?? ''} readOnly />
          </Field>
        </div>
        <div className={form.grid2}>
          <Field label={S.fields.amount} error={err('amount')}>
            <TextInput inputMode="decimal" value={draft.amount} onChange={(e) => edit({ amount: e.target.value })} />
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
          <Field label={S.fields.date}>
            <TextInput type="date" value={draft.date} onChange={(e) => edit({ date: e.target.value })} />
          </Field>
          <Field label={S.fx.rateUsed} hint={S.budget.rateHint} error={err('rate')}>
            <TextInput inputMode="decimal" value={draft.rate} onChange={(e) => edit({ rate: e.target.value })} />
          </Field>
        </div>
        <Field label={S.budget.note} optional>
          <TextInput value={draft.note} onChange={(e) => edit({ note: e.target.value })} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
